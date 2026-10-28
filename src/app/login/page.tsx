"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Badge, StatusDot } from "@/components/ui";

type Account = { email: string; password: string; name: string; role: string; title: string; scopes: string[] };

export default function LoginPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState("admin@mpx.co.ke");
  const [password, setPassword] = useState("Mpx!Admin2026");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: string; lakehouse_materialised: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/accounts")
      .then((r) => r.json())
      .then((j) => setAccounts((j.data?.accounts ?? []) as Account[]))
      .catch(() => undefined);
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealth(j.data))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent, override?: Account) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: override?.email ?? email, password: override?.password ?? password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Authentication failed.");
        return;
      }

      const token = json.data?.access_token as string | undefined;
      if (token) {
        // Mirror the signed JWT into a Partitioned cookie from the client too, so the
        // session still establishes when the preview runs inside a cross-origin iframe
        // or when an intermediary proxy strips Set-Cookie from the API response.
        const secure = window.location.protocol === "https:";
        const attrs = secure ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax";
        document.cookie = `mpx_token=${token}; Path=/; Max-Age=${60 * 60 * 8}; ${attrs}`;
        try {
          window.localStorage.setItem("mpx_token", token);
        } catch {
          /* storage disabled */
        }

        // Confirm the session actually round-trips before navigating, otherwise the
        // app would bounce straight back here with no explanation.
        const check = await fetch("/api/v1/auth/me", { credentials: "include", cache: "no-store" });
        if (!check.ok) {
          setError(
            "Signed in, but the session cookie was not returned by your browser. This usually means third-party cookies are blocked for this embedded preview — open the preview in its own tab to continue.",
          );
          return;
        }
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the authentication service.");
    } finally {
      setBusy(false);
    }
  };

  const ready = health?.lakehouse_materialised;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink lg:flex-row">
      {/* left: narrative */}
      <div className="relative flex flex-1 flex-col justify-between border-b border-line px-6 py-8 lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "radial-gradient(700px 380px at 18% 12%, rgba(47,208,122,0.13), transparent 60%), radial-gradient(600px 400px at 88% 78%, rgba(70,200,220,0.10), transparent 62%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[3px] border border-signal/40 bg-signal/10 text-signal">
              <Icon name="bolt" className="h-4 w-4" />
            </span>
            <div>
              <div className="font-display text-[15px] font-semibold tracking-[0.18em] text-chalk">M-PESA INTELLIGENCE</div>
              <div className="label-xs">project 03 · real-time financial intelligence platform</div>
            </div>
          </div>
        </div>

        <div className="relative my-10 max-w-xl">
          <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] text-chalk sm:text-[38px]">
            Event streaming, lakehouse engineering and ensemble machine learning —{" "}
            <span className="text-signal">operationalised</span> for a mobile money ecosystem.
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-fog">
            Ingest → Kafka → Flink/Spark → Bronze/Silver/Gold → ML inference → intelligence → alerting → API.
            Fraud detection blends six trained models with a ten-policy deterministic rule engine and ships
            occlusion-based attribution for every decision.
          </p>

          <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60 sm:grid-cols-4">
            {[
              { k: "detectors", v: "6 ML + rules" },
              { k: "features", v: "18 engineered" },
              { k: "counties", v: "47 modelled" },
              { k: "twin scale", v: "1:50" },
            ].map((s) => (
              <div key={s.k} className="bg-ink-2 px-3 py-2.5">
                <div className="label-xs">{s.k}</div>
                <div className="num mt-1 text-[13px] text-chalk">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] text-fog/60">
          <span className="flex items-center gap-1.5">
            <StatusDot tone={health?.status === "ok" ? "signal" : "amber"} /> {health?.status === "ok" ? "PLATFORM ONLINE" : "PLATFORM DEGRADED"}
          </span>
          <span className={ready ? "text-signal/70" : "text-amber/70"}>
            LAKEHOUSE {ready ? "MATERIALISED" : "BOOTSTRAPPING"}
          </span>
          <span>SYNTHETIC DATA ONLY · NO LIVE TELCO CONNECTION</span>
        </div>
      </div>

      {/* right: auth */}
      <div className="flex w-full flex-col justify-center bg-ink-2/60 px-6 py-10 lg:w-[460px] lg:px-10">
        <div className="mx-auto w-full max-w-[340px]">
          <div className="label-xs mb-2">secure access</div>
          <h2 className="font-display text-[22px] font-semibold text-chalk">Authenticate</h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-fog">
            JWT session · HS256 · 8h expiry · role-based scopes · full audit trail.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="email" className="label-xs mb-1.5 block">email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[3px] border border-line bg-black/40 px-3 py-2 font-mono text-[12px] text-chalk outline-none transition-colors focus:border-signal/60"
                placeholder="analyst@mpx.co.ke"
              />
            </div>
            <div>
              <label htmlFor="password" className="label-xs mb-1.5 block">password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[3px] border border-line bg-black/40 px-3 py-2 font-mono text-[12px] text-chalk outline-none transition-colors focus:border-signal/60"
                placeholder="••••••••••"
              />
            </div>
            {error && (
              <div className="rounded-[3px] border border-alert/40 bg-alert/10 px-3 py-2 text-[11.5px] leading-relaxed text-alert">
                <span className="flex items-start gap-2">
                  <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </span>
                {typeof window !== "undefined" && error.includes("third-party cookies") && (
                  <a
                    href={window.location.origin + "/"}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-[3px] border border-alert/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-alert hover:bg-alert/20"
                  >
                    <Icon name="right" className="h-3 w-3" /> open preview in a new tab
                  </a>
                )}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-[3px] border border-signal/50 bg-signal/15 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-signal transition-all hover:bg-signal/25 disabled:opacity-50"
            >
              <Icon name="right" className="h-3.5 w-3.5" />
              {busy ? "authenticating…" : "sign in"}
            </button>
          </form>

          <div className="mt-7">
            <div className="label-xs mb-2">demonstration identities · click to sign in</div>
            <div className="space-y-1.5">
              {(accounts.length ? accounts : []).map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={(e) => submit(e as unknown as React.FormEvent, a)}
                  disabled={busy}
                  className="group flex w-full items-center gap-3 rounded-[3px] border border-line bg-panel px-3 py-2 text-left transition-colors hover:border-signal/40 hover:bg-signal/[0.06] disabled:opacity-50"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 bg-black/40 font-mono text-[10px] text-signal">
                    {a.name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-chalk">{a.title}</span>
                    <span className="num block truncate text-[10px] text-fog">{a.email}</span>
                  </span>
                  <Badge tone={a.role === "ADMIN" ? "iris" : a.role === "FRAUD_ANALYST" ? "alert" : a.role === "AUDITOR" ? "amber" : "cyan"}>{a.role.replace("_", " ")}</Badge>
                </button>
              ))}
              {accounts.length === 0 && (
                <div className="rounded-[3px] border border-line bg-panel px-3 py-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
                  loading identities…
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
