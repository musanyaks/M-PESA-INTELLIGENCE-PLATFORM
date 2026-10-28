import { NextRequest, NextResponse } from "next/server";
import { HttpError, getSession, writeAudit, can, type SessionPayload } from "./auth";
import { maskMsisdn, maskName } from "./core";

export const API_VERSION = "v1.4.0";

/* --------------------------- rate limiting ------------------------ */

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 240, windowMs = 60_000): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.reset - now) / 1000) };
  }
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

/* --------------------------- PII masking -------------------------- */

export function maskCustomer<T extends { msisdn?: string | null; name?: string | null }>(row: T, session: SessionPayload | null): T {
  const maySeePii = session ? can(session.role, "view:pii") : false;
  if (maySeePii) return row;
  return {
    ...row,
    msisdn: row.msisdn ? maskMsisdn(row.msisdn) : row.msisdn,
    name: row.name ? maskName(row.name) : row.name,
  };
}

/* ------------------------------ envelope -------------------------- */

export function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return NextResponse.json({
    status: "ok",
    version: API_VERSION,
    data,
    meta: { generated_at: new Date().toISOString(), ...meta },
  });
}

export function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { status: "error", version: API_VERSION, error: { code, message, ...extra } },
    { status },
  );
}

export type HandlerCtx = { req: NextRequest; params?: Record<string, string | string[]> };

/** Wraps a route handler with auth, RBAC, rate limiting, audit + error mapping. */
export function api(
  permission: string | null,
  fn: (ctx: { req: NextRequest; session: SessionPayload; search: URLSearchParams; params: Record<string, string> }) => Promise<NextResponse>,
  opts: { audit?: string; limit?: number; methods?: string[] } = {},
) {
  return async (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => {
    const started = Date.now();
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
    const rl = rateLimit(`${ip}:${req.nextUrl.pathname}`, opts.limit ?? 300);
    if (!rl.ok) {
      return errorResponse(429, "rate_limited", `Rate limit exceeded. Retry in ${rl.retryAfter}s.`, { retry_after: rl.retryAfter });
    }
    let session: SessionPayload | null = null;
    try {
      session = await getSession();
      if (permission) {
        if (!session) throw new HttpError(401, "authentication_required", "Missing or expired JWT session cookie.");
        if (!can(session.role, permission)) {
          await writeAudit({ session, action: opts.audit ?? permission, resource: req.nextUrl.pathname, result: "DENY" });
          throw new HttpError(403, "insufficient_scope", `Role '${session.role}' is not authorised for scope '${permission}'.`);
        }
      }
      const params = ctx?.params ? await ctx.params : {};
      const res = await fn({ req, session: session ?? ({} as SessionPayload), search: req.nextUrl.searchParams, params });
      await writeAudit({ session, action: opts.audit ?? `${req.method}:${req.nextUrl.pathname}`, resource: req.nextUrl.pathname, detail: { took: Date.now() - started } });
      return res;
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      const message = err instanceof Error ? err.message : "unexpected_error";
      return errorResponse(500, "internal_error", message);
    }
  };
}

export { getSession, writeAudit, HttpError };
