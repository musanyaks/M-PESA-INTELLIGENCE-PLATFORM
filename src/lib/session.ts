import { SignJWT, jwtVerify } from "jose";
import { ROLES, ROLE_PERMISSIONS, type Role } from "./core";

/* Edge-safe session primitives (no node:crypto) so middleware can verify
 * the same JWT that the API layer issues. */

const SECRET_SOURCE = process.env.AUTH_SECRET ?? process.env.DATABASE_URL ?? "mpesa-intelligence-platform-dev-key";
export const sessionSecret = new TextEncoder().encode(`mpesa-intel::${SECRET_SOURCE}`);
export const TOKEN_COOKIE = "mpx_session";
/**
 * Non-httpOnly mirror of the same signed JWT.
 *
 * The platform preview renders the app inside a cross-origin iframe, where a
 * SameSite=Lax cookie is never sent back on the following navigation — the user
 * logs in successfully and is immediately bounced to /login again. This mirror
 * is written with SameSite=None + Partitioned (CHIPS) so the session survives
 * third-party-cookie blocking, and it is also re-written from client JS in case
 * an intermediary proxy strips Set-Cookie headers.
 */
export const TOKEN_COOKIE_MIRROR = "mpx_token";
export const TOKEN_TTL_SECONDS = 60 * 60 * 8;

export function buildSessionCookies(token: string, secure: boolean): string[] {
  const tail = `Path=/; Max-Age=${TOKEN_TTL_SECONDS}`;
  if (!secure) {
    // Plain-HTTP context: Partitioned/None are rejected by browsers without Secure.
    return [
      `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Lax; ${tail}`,
      `${TOKEN_COOKIE_MIRROR}=${token}; SameSite=Lax; ${tail}`,
    ];
  }
  return [
    `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Secure; ${tail}`,
    `${TOKEN_COOKIE_MIRROR}=${token}; SameSite=None; Secure; Partitioned; ${tail}`,
  ];
}

export function clearSessionCookies(): string[] {
  const expired = "Path=/; Max-Age=0";
  return [
    `${TOKEN_COOKIE}=; HttpOnly; SameSite=Lax; ${expired}`,
    `${TOKEN_COOKIE}=; HttpOnly; SameSite=None; Secure; ${expired}`,
    `${TOKEN_COOKIE_MIRROR}=; SameSite=Lax; ${expired}`,
    `${TOKEN_COOKIE_MIRROR}=; SameSite=None; Secure; Partitioned; ${expired}`,
  ];
}

/** Best-effort HTTPS detection behind a terminating proxy. */
export function requestIsSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? "";
  if (proto) return proto.split(",")[0].trim() !== "http";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/** Read the JWT from the cookie jar (either channel) or a Bearer header. */
export function extractToken(req: { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } }): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  const primary = req.cookies?.get(TOKEN_COOKIE)?.value;
  if (primary) return primary;
  return req.cookies?.get(TOKEN_COOKIE_MIRROR)?.value ?? null;
}

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: Role;
  scopes: string[];
};

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role, scopes: payload.scopes })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("mpesa-intelligence-platform")
    .setAudience("mpx-api")
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(sessionSecret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret, {
      issuer: "mpesa-intelligence-platform",
      audience: "mpx-api",
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: (ROLES as readonly string[]).includes(String(payload.role)) ? (String(payload.role) as Role) : "CUSTOMER",
      scopes: Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [],
    };
  } catch {
    return null;
  }
}

export function can(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[(role as Role) ?? "CUSTOMER"] ?? [];
  return perms.includes("write:all") || perms.includes(permission) || perms.includes("read:all");
}
