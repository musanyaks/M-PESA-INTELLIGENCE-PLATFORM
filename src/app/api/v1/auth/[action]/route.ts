import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";
import { DEMO_ACCOUNTS, verifyPassword, hashPassword, writeAudit, HttpError } from "@/lib/auth";
import {
  signSession, verifySession, TOKEN_COOKIE, TOKEN_TTL_SECONDS,
  buildSessionCookies, clearSessionCookies, requestIsSecure,
} from "@/lib/session";
import { ROLE_PERMISSIONS } from "@/lib/core";
import { api, envelope, errorResponse, API_VERSION } from "@/lib/api";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

async function handle(action: string, req: NextRequest) {
  if (action === "accounts") {
    return envelope({
      accounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, password: a.password, name: a.name, role: a.role, title: a.title, scopes: ROLE_PERMISSIONS[a.role] })),
      note: "Synthetic demonstration identities. No production M-PESA credentials are used anywhere in this platform.",
    });
  }

  if (action === "login" && req.method === "POST") {
    // The identity store is provisioned by the bootstrap job; make sure it exists
    // before authenticating so a cold database can never lock everybody out.
    await ensureReady();

    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    if (!body.email || !body.password) throw new HttpError(400, "invalid_payload", "email and password are required.");
    const email = body.email.toLowerCase().trim();

    let rows = await db.select().from(users).where(sql`${users.email} = ${email}`).limit(1);
    let user = rows[0];

    // Self-heal: if the principals table was wiped but the credentials match a
    // documented demo identity, re-provision it instead of failing closed.
    if (!user) {
      const demo = DEMO_ACCOUNTS.find((a) => a.email === email);
      if (demo && demo.password === body.password) {
        const idx = DEMO_ACCOUNTS.indexOf(demo);
        await db.insert(users).values({
          id: `usr_${idx + 1}`, email: demo.email, name: demo.name,
          passwordHash: hashPassword(demo.password), role: demo.role, status: "ACTIVE",
          scopes: ROLE_PERMISSIONS[demo.role], lastLoginAt: new Date(),
        }).onConflictDoNothing();
        rows = await db.select().from(users).where(sql`${users.email} = ${email}`).limit(1);
        user = rows[0];
      }
    }

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      await writeAudit({ session: null, action: "auth.login", resource: email, result: "DENY" });
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    if (user.status !== "ACTIVE") throw new HttpError(403, "account_disabled", "This account has been disabled.");

    const scopes = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] ?? [];
    const token = await signSession({
      sub: user.id, email: user.email, name: user.name, role: user.role as never, scopes,
    });
    await db.update(users).set({ lastLoginAt: new Date() }).where(sql`${users.id} = ${user.id}`);
    await writeAudit({
      session: { sub: user.id, email: user.email, name: user.name, role: user.role as never, scopes },
      action: "auth.login", resource: user.email,
    });

    const secure = requestIsSecure(req);
    const res = NextResponse.json({
      status: "ok",
      version: API_VERSION,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, scopes },
        access_token: token,
        token_type: "Bearer",
        expires_in: TOKEN_TTL_SECONDS,
        cookie_channels: secure ? ["mpx_session (httpOnly, Lax, Secure)", "mpx_token (Partitioned, SameSite=None)"] : ["mpx_session", "mpx_token"],
      },
      meta: { generated_at: new Date().toISOString() },
    });
    for (const cookie of buildSessionCookies(token, secure)) res.headers.append("Set-Cookie", cookie);
    return res;
  }

  if (action === "logout") {
    const res = envelope({ logged_out: true });
    for (const cookie of clearSessionCookies()) res.headers.append("Set-Cookie", cookie);
    return res;
  }

  if (action === "me") {
    const token =
      req.cookies.get(TOKEN_COOKIE)?.value ??
      req.cookies.get("mpx_token")?.value ??
      (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") ??
      null;
    if (!token) return errorResponse(401, "authentication_required", "No session cookie or bearer token present.");
    const session = await verifySession(token);
    if (!session) return errorResponse(401, "token_invalid", "Session token could not be verified.");
    return envelope({ user: session, scopes: session.scopes, expires_in: TOKEN_TTL_SECONDS });
  }

  return errorResponse(404, "unknown_action", `No auth action '${action}'.`);
}

export const GET = api(null, async ({ req, params }) => handle(params.action, req), { audit: "auth.read" });
export const POST = api(null, async ({ req, params }) => handle(params.action, req), { audit: "auth.write", limit: 60 });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,POST,OPTIONS" } });
}
