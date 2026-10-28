import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Empty } from "@/components/ui";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getPipeline } from "@/lib/dashboard-data";
import { ROLE_PERMISSIONS, ROLES } from "@/lib/core";
import { API_VERSION } from "@/lib/api";

export const dynamic = "force-dynamic";

const ENDPOINTS: { method: "GET" | "POST" | "PATCH"; path: string; scope: string; description: string; example?: string }[] = [
  { method: "GET", path: "/api/health", scope: "public", description: "Liveness, database latency, lakehouse materialisation and producer telemetry." },
  { method: "POST", path: "/api/v1/auth/login", scope: "public", description: "Exchange credentials for an HS256 JWT session cookie (8h TTL)." },
  { method: "GET", path: "/api/v1/auth/me", scope: "session", description: "Resolve the current session, role and granted scopes." },
  { method: "GET", path: "/api/v1/auth/accounts", scope: "public", description: "Demonstration identities available in the synthetic deployment." },
  { method: "POST", path: "/api/v1/auth/logout", scope: "session", description: "Revoke the session cookie." },
  { method: "GET", path: "/api/v1/transactions", scope: "read:all", description: "Conformed transaction facts with type, county, channel, customer and risk filters.", example: "?days=30&type=PAYBILL&min_risk=65&limit=50" },
  { method: "POST", path: "/api/v1/transactions", scope: "write:all", description: "Inject an M-PESA-shaped event onto the bronze topic; returns the scored verdict synchronously." },
  { method: "GET", path: "/api/v1/customers", scope: "read:all", description: "Customer register with segmentation facets and PII masking applied per role.", example: "?segment=Business%20transactors&sort=risk&limit=50" },
  { method: "GET", path: "/api/v1/customers/:id", scope: "read:all", description: "Customer 360: cash flow, mix, recurring commitments, predictions and peer benchmark." },
  { method: "GET", path: "/api/v1/merchants", scope: "read:all", description: "Merchant league table, or a single merchant dashboard when ?id= is supplied.", example: "?category=UTILITIES&sort=growth" },
  { method: "GET", path: "/api/v1/fraud", scope: "read:all", description: "Fraud queue with risk filter, detector catalogue and rule-engine policy list.", example: "?risk=high&limit=20" },
  { method: "GET", path: "/api/v1/fraud/cases", scope: "read:all", description: "Case management queue filtered by level, status and county." },
  { method: "GET", path: "/api/v1/fraud/cases/:id", scope: "read:all", description: "Investigation dossier: risk factors, detector votes, occlusion attribution, subject history." },
  { method: "PATCH", path: "/api/v1/fraud/cases/:id", scope: "resolve:cases", description: "Workflow transition — INVESTIGATING, ESCALATED, RESOLVED, FALSE_POSITIVE." },
  { method: "GET", path: "/api/v1/analytics", scope: "read:all", description: "Overview KPIs, volume series, category / channel / county / hour breakdowns and cash flow.", example: "?days=30&series_days=90" },
  { method: "GET", path: "/api/v1/predictions", scope: "read:all", description: "Forecasts, churn watchlist, spend projection and model registry.", example: "?model=churn" },
  { method: "GET", path: "/api/v1/segments", scope: "read:all", description: "K-means segments with centroids, revenue share and lifecycle cross-tab." },
  { method: "GET", path: "/api/v1/alerts", scope: "read:all", description: "Alert feed with severity, channel and status filters plus routing policy." },
  { method: "POST", path: "/api/v1/alerts", scope: "ack:alerts", description: "Acknowledge or resolve an alert; recorded against the acting principal." },
  { method: "GET", path: "/api/v1/reports", scope: "read:all", description: "Executive financial-intelligence report or model-governance report.", example: "?report=models" },
  { method: "GET", path: "/api/v1/stream", scope: "session", description: "Server-Sent Events feed of scored transactions, broker status and heartbeats." },
  { method: "POST", path: "/api/v1/stream", scope: "run:pipeline", description: "Start, stop or throttle the synthetic producer (1–60 events/second)." },
  { method: "GET", path: "/api/v1/system/status", scope: "public", description: "Bootstrap status, row counts and stream telemetry." },
  { method: "GET", path: "/api/v1/system/pipeline", scope: "public", description: "Lakehouse layers, DAG runs, relation sizes, benchmarks and audit trail." },
  { method: "GET", path: "/api/v1/system/models", scope: "public", description: "Full model registry payload including artefact URIs and metrics." },
  { method: "POST", path: "/api/v1/system/benchmark", scope: "run:pipeline", description: "Execute a measured load profile through the ensemble and persist the result." },
  { method: "POST", path: "/api/v1/system/bootstrap", scope: "run:pipeline", description: "Rebuild the entire lakehouse and retrain every model from the twin." },
];

const CONTROLS = [
  { k: "Authentication", v: "HS256 JWT in an httpOnly, SameSite=Lax cookie. 8-hour expiry, issuer and audience pinned, signature verified on every request including the edge guard." },
  { k: "Authorisation", v: "Six roles mapped to a capability matrix. Every route declares the scope it needs; a missing scope returns 403 insufficient_scope and writes a DENY audit entry." },
  { k: "Rate limiting", v: "Sliding-window bucket per (client IP, route). 300 req/min default, 20–60 req/min on mutation endpoints, 429 with retry_after on breach." },
  { k: "Data masking", v: "Names and MSISDNs are masked for every role except ADMIN (view:pii). Masking is applied in the API serializer, not in the client." },
  { k: "Audit logging", v: "Append-only audit_logs capture actor, role, action, resource, decision, IP and latency for every privileged call." },
  { k: "Input validation", v: "Typed handlers reject unknown actions, clamp pagination and numeric ranges, and parameterize every SQL fragment through the Drizzle query builder." },
  { k: "Secrets", v: "Signing keys derive from AUTH_SECRET / DATABASE_URL environment variables. No credential is embedded in the client bundle." },
  { k: "Transport", v: "TLS termination at the platform edge; cookies are marked Secure in production builds." },
  { k: "Database access", v: "Single pooled connection string, least-privilege application role, advisory-locked bootstrap to prevent concurrent rebuilds." },
  { k: "Data provenance", v: "100% synthetic. No live telco integration, no real subscriber data, no production M-PESA credentials anywhere in the codebase." },
];

export default async function ApiDocsPage() {
  const session = await requirePage();
  await ensureReady();
  const p = await getPipeline();
  const perms = Array.from(new Set(ROLES.flatMap((r) => ROLE_PERMISSIONS[r]))).sort();

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="API Layer & Security Posture"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>REST v1 · JSON envelope · SSE streaming · RBAC · audit</span>
          <span className="text-fog/40">|</span>
          <Badge tone="signal">api {API_VERSION}</Badge>
          <span className="text-fog/40">|</span>
          <span className="num">{ENDPOINTS.length} endpoints</span>
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Panel bodyClass="p-3"><Label>endpoints</Label><div className="num mt-1 font-display text-[24px] font-semibold text-chalk">{ENDPOINTS.length}</div></Panel>
          <Panel bodyClass="p-3"><Label>roles</Label><div className="num mt-1 font-display text-[24px] font-semibold text-cyan">{ROLES.length}</div></Panel>
          <Panel bodyClass="p-3"><Label>scopes</Label><div className="num mt-1 font-display text-[24px] font-semibold text-iris">{perms.length}</div></Panel>
          <Panel bodyClass="p-3"><Label>audit entries</Label><div className="num mt-1 font-display text-[24px] font-semibold text-amber">{p.audit.length}</div></Panel>
        </div>

        <Panel
          title="Endpoint catalogue"
          subtitle="every route resolves through the same envelope: { status, version, data, meta }"
          icon="code"
          accent="#46c8dc"
          bodyClass="p-0"
        >
          <Table head={["method", "path", "scope", "description"]}>
            {ENDPOINTS.map((e) => (
              <Tr key={`${e.method}-${e.path}`}>
                <Td>
                  <Badge tone={e.method === "GET" ? "cyan" : e.method === "POST" ? "signal" : "amber"}>{e.method}</Badge>
                </Td>
                <Td className="whitespace-nowrap">
                  <Link href={`${e.path.split(":")[0].replace(/\/$/, "")}${e.example ?? ""}`} target="_blank" rel="noreferrer" className="num text-[11.5px] text-chalk hover:text-signal">
                    {e.path}
                    {e.example && <span className="text-fog/60">{e.example}</span>}
                  </Link>
                </Td>
                <Td><span className="num text-[10px] uppercase tracking-[0.1em] text-iris">{e.scope}</span></Td>
                <Td className="text-fog">{e.description}</Td>
              </Tr>
            ))}
          </Table>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_1fr]">
          <Panel title="Example · high-risk fraud query" subtitle="GET /api/v1/fraud?risk=high" icon="file" accent="#ff5a5f">
            <pre className="overflow-auto rounded-[3px] border border-line bg-black/50 p-3 font-mono text-[10.5px] leading-relaxed text-signal/85">
{`curl -s 'https://<host>/api/v1/fraud?risk=high&limit=2' \\
  -H 'Cookie: mpx_session=<jwt>'

{
  "status": "ok",
  "version": "${API_VERSION}",
  "data": {
    "count": 18,
    "transactions": [
      {
        "transaction_id": "TXN-1042871",
        "case_id": "FRD-4201",
        "customer_id": "CUS-10293",
        "amount": 185000,
        "location": "Kisumu",
        "transaction_type": "SEND_MONEY",
        "risk_score": 91,
        "risk_level": "critical",
        "recommendation": "BLOCK & ESCALATE",
        "confidence": 94.2,
        "reasons": ["Amount anomaly", "Velocity anomaly", "New recipient risk"]
      }
    ]
  },
  "meta": {
    "generated_at": "2026-01-28T09:42:21.482Z",
    "risk_filter": "high",
    "min_risk_score": 65,
    "summary": { "open_cases": 41, "mean_time_to_resolve_minutes": 38 }
  }
}`}
            </pre>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="envelope" value="data + meta" />
              <Stat label="pagination" value="limit · offset" />
              <Stat label="errors" value="code + message" tone="#f5a524" />
              <Stat label="429 body" value="retry_after" tone="#ff5a5f" />
            </div>
          </Panel>

          <Panel title="Role-based access control" subtitle="capability matrix enforced server-side" icon="shield" accent="#9d8cff" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="label-xs px-3 py-2 text-left">scope</th>
                    {ROLES.map((r) => (
                      <th key={r} className="label-xs px-2 py-2 text-center whitespace-nowrap">{r.replace("_", " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perms.map((perm) => (
                    <tr key={perm} className="border-b border-line/60 hover:bg-white/[0.02]">
                      <td className="num whitespace-nowrap px-3 py-1.5 text-cyan">{perm}</td>
                      {ROLES.map((r) => {
                        const granted = ROLE_PERMISSIONS[r].includes(perm) || ROLE_PERMISSIONS[r].includes("write:all") || ROLE_PERMISSIONS[r].includes("read:all");
                        return (
                          <td key={r} className="px-2 py-1.5 text-center">
                            {granted ? <span className="text-signal">●</span> : <span className="text-line-2">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line p-3">
              <Label>current session</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="iris">{session.role}</Badge>
                {session.scopes.map((s) => <Badge key={s} tone="cyan">{s}</Badge>)}
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="Security controls" subtitle="financial-grade controls implemented in this deployment" icon="shield" accent="#2fd07a">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {CONTROLS.map((c) => (
              <div key={c.k} className="rounded-[3px] border border-line/70 bg-black/25 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                  <span className="font-display text-[12px] font-semibold tracking-[0.04em] text-chalk">{c.k}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-fog">{c.v}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent audit entries" subtitle="append-only · written by the API guard" icon="file" accent="#f5a524" bodyClass="p-0">
          {p.audit.length === 0 ? (
            <Empty title="No audit entries yet" />
          ) : (
            <Table head={["timestamp", "actor", "role", "action", "resource", "result", "ip"]}>
              {p.audit.map((a) => (
                <Tr key={a.id}>
                  <Td className="num whitespace-nowrap text-[10px] text-fog">{new Date(a.at).toISOString().slice(0, 19).replace("T", " ")}</Td>
                  <Td className="whitespace-nowrap text-chalk">{a.actor}</Td>
                  <Td><Badge tone={a.role === "ADMIN" ? "iris" : "cyan"}>{a.role}</Badge></Td>
                  <Td className="num whitespace-nowrap text-[11px] text-cyan">{a.action}</Td>
                  <Td className="num max-w-[220px] truncate text-[10.5px] text-fog">{a.resource}</Td>
                  <Td><Badge tone={a.result === "ALLOW" ? "signal" : "alert"}>{a.result}</Badge></Td>
                  <Td className="num whitespace-nowrap text-[10px] text-fog/70">{a.ip}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
