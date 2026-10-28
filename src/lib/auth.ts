import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { ROLES, type Role } from "./core";
import { TOKEN_COOKIE, TOKEN_COOKIE_MIRROR, verifySession, can, type SessionPayload } from "./session";

export {
  signSession, verifySession, sessionSecret, TOKEN_COOKIE, TOKEN_COOKIE_MIRROR, TOKEN_TTL_SECONDS, can,
  buildSessionCookies, clearSessionCookies, requestIsSecure, extractToken, type SessionPayload,
} from "./session";

/* ---------------------------- passwords --------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const candidate = Buffer.from(scryptSync(password, salt, 32).toString("hex"), "hex");
  const expected = Buffer.from(digest, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* ---------------------------- session ----------------------------- */

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const hdrs = await headers();
  const bearer = hdrs.get("authorization") ?? "";
  const token =
    (bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "") ||
    jar.get(TOKEN_COOKIE)?.value ||
    jar.get(TOKEN_COOKIE_MIRROR)?.value ||
    null;
  if (!token) return null;
  return verifySession(token);
}

/** Server-component guard: redirects unauthenticated visitors to /login. */
export async function requirePage(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permission: string): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "authentication_required", "A valid JWT session is required.");
  if (!can(session.role, permission)) {
    throw new HttpError(403, "insufficient_scope", `Role ${session.role} lacks scope '${permission}'.`);
  }
  return session;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function writeAudit(entry: {
  session: SessionPayload | null;
  action: string;
  resource: string;
  result?: "ALLOW" | "DENY";
  detail?: Record<string, unknown>;
}) {
  try {
    const hdrs = await headers();
    await db.insert(auditLogs).values({
      id: `aud_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase(),
      actor: entry.session?.email ?? "anonymous",
      role: entry.session?.role ?? "ANONYMOUS",
      action: entry.action,
      resource: entry.resource,
      result: entry.result ?? "ALLOW",
      detail: entry.detail ?? {},
      ip: hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "127.0.0.1",
    });
  } catch {
    /* audit failures must never break the request path */
  }
}

export const DEMO_ACCOUNTS: { email: string; password: string; name: string; role: Role; title: string }[] = [
  { email: "admin@mpx.co.ke", password: "Mpx!Admin2026", name: "Wanjiru Kamau", role: "ADMIN", title: "Platform administrator" },
  { email: "analyst@mpx.co.ke", password: "Mpx!Analyst2026", name: "Otieno Omondi", role: "ANALYST", title: "Financial intelligence analyst" },
  { email: "fraud@mpx.co.ke", password: "Mpx!Fraud2026", name: "Amina Hassan", role: "FRAUD_ANALYST", title: "Fraud operations lead" },
  { email: "merchant@mpx.co.ke", password: "Mpx!Merchant2026", name: "Kipchoge Rotich", role: "MERCHANT", title: "Merchant principal" },
  { email: "auditor@mpx.co.ke", password: "Mpx!Audit2026", name: "Grace Muthoni", role: "AUDITOR", title: "Internal audit" },
];

export const ALL_ROLES = ROLES;
