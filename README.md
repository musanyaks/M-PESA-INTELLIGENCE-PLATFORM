# M-PESA Intelligence Platform

> A production-oriented real-time financial intelligence system that combines **event streaming**, **distributed data
> processing**, **machine learning**, **fraud detection**, **customer analytics**, **predictive modelling** and
> **interactive business intelligence** for M-PESA transaction ecosystems.

This is **not** an M-PESA dashboard. It is an end-to-end intelligence pipeline:

```
M-PESA data → streaming backbone → lakehouse (bronze/silver/gold) → ML inference
            → financial intelligence → dashboards → alerting → public API
```

---

## Contents

1. [What it does](#1-what-it-does)
2. [Reference architecture](#2-reference-architecture)
3. [The synthetic digital twin](#3-the-synthetic-digital-twin)
4. [Data engineering & the lakehouse](#4-data-engineering--the-lakehouse)
5. [Machine learning](#5-machine-learning)
6. [Fraud detection engine](#6-fraud-detection-engine)
7. [Data model](#7-data-model)
8. [Application surfaces](#8-application-surfaces)
9. [API reference](#9-api-reference)
10. [Security posture](#10-security-posture)
11. [Throughput benchmarking](#11-throughput-benchmarking)
12. [Running it](#12-running-it)
13. [Repository layout](#13-repository-layout)
14. [Design decisions & trade-offs](#14-design-decisions--trade-offs)
15. [Roadmap to the distributed target](#15-roadmap-to-the-distributed-target)
16. [Data provenance & disclaimer](#16-data-provenance--disclaimer)

---

## 1. What it does

| Module | Capability |
| --- | --- |
| **Transaction intelligence** | 10 M-PESA products (Send Money, PayBill, Buy Goods, Airtime, Withdrawal, Deposit, Bank Transfer, Reversal, Loan Repayment, Receive Money) with volume, value, average ticket, fee yield, failure and reversal rates, hour-of-day rhythm and geographic distribution. |
| **Real-time streaming** | An in-process Kafka-analogue backbone: 4 topics, partitioned by key, 4 consumer groups with committed offsets and lag, SSE fan-out to the console, end-to-end and inference latency percentiles. |
| **Fraud detection** | Seven independent detectors (logistic regression, random forest, gradient boosting, isolation forest, autoencoder, Mahalanobis, deterministic rule engine) blended into a single 0–100 risk score with case management and workflow states. |
| **Explainability** | Occlusion-based (SHAP-style) attribution per verdict: every feature is replaced with its population baseline and the resulting shift in ensemble fraud probability is reported as a signed percentage with human-readable evidence. |
| **Customer 360** | Behavioural profile, cash-flow statement, recurring-commitment detection, transaction mix, risk distribution, peer-cohort benchmarking, churn probability, next-best-product and expected next-month spend. |
| **Segmentation** | K-Means++ (k=6) over a standardized 7-feature behavioural space, with centroids, inertia, revenue concentration and lifecycle cross-tabs versioned in the model registry. |
| **Cash-flow intelligence** | Income, expenses, net position, savings rate, burn rate, fee burden, largest expense pools, savings-rate cohort distribution and 30-day forecasting. |
| **Predictive analytics** | Holt-Winters (additive, weekly seasonality) with AR(7) as a baseline comparator, churn classification, per-customer spend projection and a first-order Markov next-transaction model. |
| **Merchant intelligence** | Revenue, ticket size, returning-customer rate, growth, peak hours, catchment counties, category benchmarking with percentile rank and per-merchant revenue forecast. |
| **Geographic intelligence** | A true 47-county choropleth of Kenya rendered from real ADM1 boundaries, with hover dossiers, five switchable metrics, regional rollups and concentration analysis. |
| **Alerting** | Severity-based multi-channel routing (SMS, email, dashboard SSE, SOC webhook) with suppression, escalation policy and acknowledgement workflow. |
| **Platform engineering** | Model registry, pipeline run log with per-layer engine attribution, lakehouse footprint, audit trail, RBAC matrix, rate limiting and PII masking. |

---

## 2. Reference architecture

```
                        M-PESA DATA (synthetic twin)
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
            BATCH FILES        API EVENTS       TWIN PRODUCER
         (parquet · s3 drop)  POST /v1/transactions   (4–25 ev/s)
                  └─────────────────┼─────────────────┘
                                    ▼
                        ┌───────────────────────┐
                        │        KAFKA          │  8 partitions · 3 brokers
                        │   mpesa.bronze.raw    │  keyed by transaction_id
                        └───────────┬───────────┘
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
      FLINK CEP ENGINE      SPARK STREAMING         KAFKA CONNECT
      fraud · velocity      analytics rollups        jdbc · s3 sink
             │                      │                      │
             ▼                      ▼                      ▼
        BRONZE  ──────────────►  SILVER  ─────────────►  GOLD
     raw · append only      conformed · scored ·       marts · feature
                            deduped · enriched            store
                                    │
                                    ▼
                          ┌───────────────────┐
                          │    POSTGRESQL     │  warehouse · 14 relations
                          │   (Drizzle ORM)   │  advisory-locked bootstrap
                          └─────────┬─────────┘
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
        ML INFERENCE            BI / REST API           ALERTING
        7 detectors             27 endpoints            sms · email
        occlusion SHAP          JSON envelope           dashboard · webhook
                                    │
                                    ▼
                        NEXT.JSS 16 APP ROUTER UI
              command centre · fraud desk · geo · customer 360
              merchants · cash flow · predictions · pipeline
```

Supporting plane: **Airflow** (orchestration), **MLflow** (registry), **MinIO/S3** (parquet landing), **Redis**
(feature cache + rate limits), **Prometheus/Grafana** (SLA telemetry), **Docker Compose → ECS/MSK/EMR/RDS/S3/SageMaker**.

> **What actually runs here.** This deployment executes the whole topology **in-process on a single Node runtime**: the
> broker, partitions, consumer groups, feature extraction, model training and inference are all real code paths with the
> same semantics as the distributed target, but without a separate JVM cluster. Partitioning, offsets, lag, backpressure
> and latency percentiles are genuinely measured — so scale-out is an infrastructure change, not a rewrite.
> See [§15](#15-roadmap-to-the-distributed-target).

---

## 3. The synthetic digital twin

No live telco integration exists anywhere in this codebase. Everything is generated from seeded distributions so the
platform can be demonstrated end-to-end without touching real customer data.

```
buildTwinPopulation(seed=1337)
  ├── 2,400 customers   — 6 behavioural archetypes, log-normal income, KYC tier,
  │                       tenure, home county, device/SIM churn, trusted-beneficiary list
  ├──   320 merchants   — 17 verticals, till + paybill, ticket distribution, fraud exposure
  └──    47 counties    — real centroids, activity weights proportional to population/economy

synthesiseEvent(rng, population, day, fraudBias)
  ├── product mix by archetype and channel affinity (digital vs agent vs USSD)
  ├── weekday/weekend + monthly seasonality, diurnal peaks
  ├── tariff-band fee schedule, 2–16% failure and reversal rates
  └── injected fraud patterns: account takeover, mule networks, SIM swap,
      smurfing, merchant collusion, stolen credentials
```

The twin models **1/50th** of the national ecosystem (`TWIN_SCALE = 50`); dashboards therefore report the conformed
facts *and* the modelled national equivalent, always labelled as a projection.

---

## 4. Data engineering & the lakehouse

Cold start materialises the entire platform in ~20 seconds through twelve audited stages, each recorded in
`pipeline_runs` with engine attribution, records in/out, rejection counts, duration and an S3 target URI:

| # | Stage | Layer | Engine (attributed) | Output |
| --- | --- | --- | --- | --- |
| 1 | Identity, RBAC & secrets | bronze | Airflow · KubernetesPodOperator | 5 principals, 6 roles |
| 2 | Twin ingest | bronze | Kafka Connect · S3 sink | ~35,800 raw events over 96 days |
| 3 | Ensemble inference | silver | Apache Flink · keyed state | 7-detector verdict per event |
| 4 | Conformed facts | silver | Spark 3.5 · delta | deduped, enriched transaction facts |
| 5 | Feature store | silver | Spark 3.5 · feature-engineering | customer + merchant rollups, percentile ranks |
| 6 | Model registry | — | MLflow | trained fraud ensemble + component metrics |
| 7 | Segmentation | gold | Spark MLlib | 6 K-Means clusters with centroids |
| 8 | Churn & next-best-action | gold | Spark MLlib | churn probabilities + Markov transitions |
| 9 | Daily metric marts | gold | Spark 3.5 · dbt | 96 pre-aggregated daily rows with type/county/hour cubes |
| 10 | Forecasting | gold | Prophet-class runtime | Holt-Winters + AR baselines, 30-day horizon |
| 11 | Cases & alerts | gold | Flink CEP | 160 investigations, 250 alerts with attributions |
| 12 | Observability | — | Airflow | benchmark calibration, twin metadata, audit seed |

Concurrency is guarded by a Postgres **advisory lock** (`pg_advisory_lock(90210)`) plus an idempotency check on
`system_state.bootstrap`, so parallel cold starts cannot double-write.

---

## 5. Machine learning

Every model is implemented from first principles in TypeScript — no sklearn, no Python sidecar — and every artefact is
serialisable so it can be persisted to the registry.

| Model | Implementation | Task |
| --- | --- | --- |
| Logistic Regression | L2-regularized batch gradient descent, 500 iterations | fraud · churn |
| Random Forest | 26 bagged CART trees, depth 9, √d feature subsampling, gini, MDI importance | fraud |
| Gradient Boosting | 40 rounds of depth-4 regression trees on logistic residuals (XGBoost-style) | fraud |
| Isolation Forest | 64 iTrees, ψ=256, `2^(−E[h]/c(ψ))` anomaly score | anomaly |
| Autoencoder | 18→5→18 tanh network, Adam (β₁=0.9, β₂=0.999), reconstruction MSE | anomaly |
| Mahalanobis | full covariance inversion, 98th-percentile distance scaling | anomaly |
| K-Means++ | k=6, 80 iterations, inertia + silhouette proxy | segmentation |
| Holt-Winters | additive trend + weekly seasonality, α/β/γ fitted, 95% bands | forecasting |
| AR(7) | ordinary least squares via normal equations, Gaussian elimination | forecast baseline |
| Markov chain | first-order product-transition matrix over the twin sequence | next-best-product |

Evaluation uses a 72/28 shuffle split with ROC-AUC (rank-sum, tie-corrected), precision, recall, F1, accuracy and
specificity, all reported per component **and** for the blend so you can see what each detector contributes.

---

## 6. Fraud detection engine

```
                              TRANSACTION EVENT
                                       │
                        FEATURE EXTRACTION (18 features)
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼
   RULE ENGINE    LOGISTIC       RANDOM FOREST   GRADIENT BOOST   ANOMALY TRIO
   10 policies    w=0.42         w=0.28          w=0.30        iForest · AE · Maha
        │              └───────────────┴───────────────┘              │
        │                     supervised blend 0.55                   │ 0.24
        └────────────────────────── 0.21 ─────────────────────────────┘
                                       │
                                 RISK SCORE 0–100
                                       │
                    NORMAL · ELEVATED · HIGH · CRITICAL
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
               AUTO-APPROVE                     STEP-UP / HOLD / BLOCK
                                                          │
                                              CASE + ALERT + ATTRIBUTION
```

**Engineered features** — log amount, amount deviation in σ from the customer's rolling baseline, 10-minute velocity,
same-day count, night flag, cyclic hour (sin/cos), geodesic displacement from the home county in km, out-of-county flag,
new-recipient flag, cash-out channel flag, product risk weight, fee-to-tariff deviation, round-number flag, historical
fraud ratio, tenure, merchant fraud exposure, device/SIM churn.

**Policy catalogue** — `VEL_001` velocity, `AMT_002` amount, `GEO_003` geographic, `RCPT_004` new recipient,
`TIME_005` unusual hour, `STRUCT_006` structuring/smurfing, `CASH_007` cash-out burst, `MERCH_008` merchant exposure,
`DEV_009` device churn, `FEE_010` fee-schedule mismatch, `HIST_011` adverse history. Each hit carries severity, a
human-readable evidence string and a weight, so a verdict is never a black box.

**Explanation** — `explainEvent()` performs occlusion attribution: for each of the 18 features it substitutes the
population median, re-runs the ensemble and measures Δprobability. Contributions are normalised to shares, signed by
direction, paired with evidence and persisted on the case row — which is what renders as the *Model explanation* bars on
the investigation page.

---

## 7. Data model

```
users            audit_logs                              ← identity & governance
customers        merchants                               ← master data + feature store
transactions     daily_metrics                           ← silver facts / gold marts
fraud_cases      alerts                                  ← risk operations
ml_models        segments        forecasts               ← MLOps registry
pipeline_runs    benchmark_runs  system_state            ← platform observability
```

Notable choices: money is stored as integer shillings (no float drift), verdicts keep their per-detector scores and
triggered reasons as `jsonb`, cases persist their full attribution vector so an investigation is reproducible years
later, and `daily_metrics` stores type/county/hour cubes so long-range charts never re-scan the fact table.

---

## 8. Application surfaces

| Route | Surface |
| --- | --- |
| `/` | **Financial intelligence command centre** — KPI strip with nationalised projections, volume/value/flagged composition, fraud monitoring gauge, segments, categories, activity rhythm, live SSE stream, merchant performance, operational health. |
| `/fraud` | **Investigation desk** — filterable case queue, model performance, feature attribution leaderboard, policy catalogue. |
| `/fraud/[id]` | **Case dossier** — risk gauge, recommendation + confidence, transaction facts, risk factors, detector votes, occlusion explanation, subject profile with peer cohort, transaction history, workflow transitions, notification fan-out, raw bronze payload. |
| `/geo` | **Geographic intelligence** — real 47-county choropleth with hover dossiers and drill-down, regional rollup, merchant density, top-12 concentration bars and full league table. |
| `/customers` | **Customer intelligence** — searchable register with PII masking, K-Means segment explorer, revenue concentration, segment risk profile. |
| `/customers/[id]` | **Customer 360** — cash-flow rhythm, behavioural radar vs segment centroid, churn outlook, transaction mix, recurring commitments, risk distribution, recent activity. |
| `/merchants` | **Merchant intelligence** — register, category league, retention table, and a full merchant dashboard with peak hours, catchment and category benchmark. |
| `/cashflow` | **Cash-flow intelligence** — ecosystem statement, income vs expenses, fee revenue, savings-rate distribution, largest expense pools, forecast with 95% bands, stress watchlist. |
| `/predictions` | **Predictive analytics** — value/volume forecasts, churn distribution and watchlist, spend projection, Markov next-product matrix, full model registry. |
| `/pipeline` | **Data engineering** — reference architecture diagram, twin metadata, bootstrap stage telemetry, DAG run log, topic/partition/consumer-group view, warehouse footprint, live benchmark harness, audit trail. |
| `/alerts` | **Alerting fabric** — architecture diagram, severity/channel/status filters, actionable feed, escalation policy. |
| `/api-docs` | **API & security** — endpoint catalogue, worked request/response, RBAC matrix, control inventory, audit log. |
| `/login` | Five role identities, one-click sign-in, lakehouse status, session diagnostics. |

---

## 9. API reference

All responses share one envelope:

```json
{ "status": "ok", "version": "v1.4.0", "data": { }, "meta": { "generated_at": "…" } }
{ "status": "error", "version": "v1.4.0", "error": { "code": "insufficient_scope", "message": "…" } }
```

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | liveness, DB latency, lakehouse state, producer telemetry |
| POST | `/api/v1/auth/login` | public | issue JWT session (dual-channel cookies) |
| GET | `/api/v1/auth/me` · `/accounts` | session · public | resolve session · list demo identities |
| POST | `/api/v1/auth/logout` | session | expire both cookie channels |
| GET | `/api/v1/transactions` | `read:all` | conformed facts, 8 filter dimensions |
| POST | `/api/v1/transactions` | `write:all` | inject an M-PESA-shaped event, get the verdict synchronously |
| GET | `/api/v1/customers` | `read:all` | register + segmentation facets (PII masked by role) |
| GET | `/api/v1/customers/:id` | `read:all` | Customer 360 |
| GET | `/api/v1/merchants` | `read:all` | league table, or one merchant dashboard via `?id=` |
| GET | `/api/v1/fraud` | `read:all` | fraud queue by risk band + detector/policy catalogue |
| GET | `/api/v1/fraud/cases` | `read:all` | case management queue |
| GET/PATCH | `/api/v1/fraud/cases/:id` | `read:all` / `resolve:cases` | dossier · workflow transition |
| GET | `/api/v1/analytics` | `read:all` | KPIs, series, breakdowns, cash flow |
| GET | `/api/v1/predictions` | `read:all` | forecasts, churn, spend, registry (`?model=`) |
| GET | `/api/v1/segments` | `read:all` | clusters, centroids, revenue share, lifecycle |
| GET/POST | `/api/v1/alerts` | `read:all` / `ack:alerts` | feed · acknowledge/resolve |
| GET | `/api/v1/reports` | `read:all` | executive or model-governance report |
| GET/POST | `/api/v1/stream` | session / `run:pipeline` | SSE verdict feed · start/stop/throttle producer |
| GET | `/api/v1/system/{status,pipeline,models}` | public | bootstrap state, DAG runs, registry |
| POST | `/api/v1/system/{bootstrap,benchmark,retrain}` | `run:pipeline` | rebuild lakehouse · load test · retrain |

```bash
curl -s 'https://<host>/api/v1/fraud?risk=high&limit=2' -H "Cookie: mpx_session=<jwt>"
```

```json
{
  "status": "ok",
  "version": "v1.4.0",
  "data": {
    "count": 18,
    "transactions": [
      {
        "transaction_id": "TXN-1042871",
        "customer_id": "CUS-10293",
        "amount": 185000,
        "location": "Kisumu",
        "risk_score": 91,
        "risk_level": "critical",
        "recommendation": "BLOCK & ESCALATE",
        "confidence": 94.2,
        "reasons": ["Amount anomaly", "Velocity anomaly", "New recipient risk"]
      }
    ]
  },
  "meta": { "risk_filter": "high", "min_risk_score": 65, "summary": { "open_cases": 41 } }
}
```

---

## 10. Security posture

| Control | Implementation |
| --- | --- |
| Authentication | HS256 JWT, 8h TTL, issuer + audience pinned, signature verified on every request |
| Session delivery | **Dual channel** — `mpx_session` (`HttpOnly; SameSite=Lax; Secure`) plus a `mpx_token` mirror (`SameSite=None; Secure; Partitioned`, CHIPS) so the session survives cross-origin embedding; `Authorization: Bearer` is accepted as a third path |
| Passwords | `scrypt` with a 16-byte random salt, constant-time comparison |
| Authorisation | 6 roles × capability matrix; every route declares its scope; denial returns `403 insufficient_scope` **and** writes a `DENY` audit entry |
| Rate limiting | sliding-window bucket per (IP, route); 300/min default, 20–60/min on mutations, `429` with `retry_after` |
| PII protection | names and MSISDNs masked in the serializer for every role except `ADMIN` (`view:pii`) |
| Audit | append-only log of actor, role, action, resource, decision, IP and latency |
| Input handling | typed handlers, clamped pagination and numerics, fully parameterized SQL through the Drizzle builder |
| Secrets | derived from `AUTH_SECRET` / `DATABASE_URL`; nothing embedded in the client bundle |
| Cold-start safety | login calls `ensureReady()` and self-heals a wiped principals table instead of failing closed |

Roles: `ADMIN`, `ANALYST`, `FRAUD_ANALYST`, `MERCHANT`, `CUSTOMER`, `AUDITOR`.

---

## 11. Throughput benchmarking

`POST /api/v1/system/benchmark` drives a real load profile through the complete path — producer → bronze topic → feature
extraction → seven-detector ensemble → verdict — and records achieved throughput with latency percentiles. The
`/pipeline` page exposes 1k / 5k / 20k / 60k profiles.

A representative single-node calibration run:

| Metric | Value |
| --- | --- |
| Achieved throughput | **34,091 events/sec** |
| End-to-end p50 / p95 / p99 | 0.023 ms / 0.054 ms / 0.092 ms |
| ML inference p99 (7 detectors) | 0.061 ms |
| Fraud hits | 228 / 3,000 (7.6%) |
| Error rate | 0.000% |

Sustained live production runs at 2–25 events/sec by design: the constraint there is warehouse write amplification, not
compute. Mitigations already in place — every flagged verdict is persisted while benign traffic is sampled 1-in-12, and
the producer parks itself after 90 seconds without an SSE consumer.

---

## 12. Running it

```bash
npm install
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
export AUTH_SECRET=<32+ random bytes>          # optional; falls back for local dev

npx drizzle-kit push                            # create the 14 relations
npm run dev                                     # http://localhost:3000
```

The first authenticated request triggers the bootstrap (~20 s): twin generation, ensemble training, conformed facts,
feature store, segmentation, churn, gold marts, forecasting, cases and alerts. To force a rebuild:

```bash
curl -X POST http://localhost:3000/api/v1/system/bootstrap \
     -H 'content-type: application/json' -d '{"force":true}'
```

Production:

```bash
npm run build && npm run start
```

**Demonstration identities** (click-to-sign-in on `/login`):

| Role | Email | Password |
| --- | --- | --- |
| ADMIN | `admin@mpx.co.ke` | `Mpx!Admin2026` |
| ANALYST | `analyst@mpx.co.ke` | `Mpx!Analyst2026` |
| FRAUD_ANALYST | `fraud@mpx.co.ke` | `Mpx!Fraud2026` |
| MERCHANT | `merchant@mpx.co.ke` | `Mpx!Merchant2026` |
| AUDITOR | `auditor@mpx.co.ke` | `Mpx!Audit2026` |

---

## 13. Repository layout

```
src/
├── app/
│   ├── (surfaces)/           13 route surfaces, all force-dynamic server components
│   ├── api/
│   │   ├── health/
│   │   └── v1/               auth · transactions · customers · merchants · fraud
│   │                         analytics · predictions · segments · alerts · reports
│   │                         stream (SSE) · system (status/pipeline/models/bootstrap/benchmark)
│   ├── globals.css           design tokens, panel/label/num utilities, motion
│   └── layout.tsx            Space Grotesk · IBM Plex Sans · IBM Plex Mono
├── components/
│   ├── shell.tsx             nav, live system status, session menu
│   ├── ui.tsx                panel/KPI/badge/meter/table/sparkline kit + inline SVG icons
│   ├── charts.tsx            recharts wrappers (area, line, bar, donut, gauge, radar, heat)
│   ├── kenya-map.tsx         interactive 47-county choropleth with hover dossiers
│   ├── live.tsx              SSE stream, producer control, benchmark harness
│   └── actions.tsx           case workflow, alert acknowledgement, JSON copy
├── db/
│   ├── index.ts              pooled Drizzle client
│   └── schema.ts             14 relations, indexes, jsonb verdict storage
└── lib/
    ├── core.ts               seeded PRNG, 47-county registry, formatting, RBAC matrix
    ├── kenya-geometry.ts     real ADM1 boundaries (geoBoundaries, Douglas-Peucker reduced)
    ├── simulator.ts          the digital twin: population + event synthesis
    ├── ml/core.ts            scaler · logistic · k-means++ · Holt-Winters · AR · metrics
    ├── ml/trees.ts           CART · random forest · gradient boosting · iForest · AE · Mahalanobis
    ├── ml/fraud.ts           features · rule engine · ensemble · occlusion attribution
    ├── seed.ts               12-stage lakehouse bootstrap + model training
    ├── stream.ts             in-process broker, topics, partitions, consumer groups, SSE
    ├── ingest.ts             public event contract → internal TxnEvent adapter
    ├── queries.ts            read models powering every surface and endpoint
    ├── session.ts            edge-safe JWT primitives + dual-channel cookie builders
    ├── auth.ts               scrypt, session resolution, RBAC guard, audit writer
    └── api.ts                envelope, rate limiter, PII masking, handler wrapper
```

---

## 14. Design decisions & trade-offs

- **ML in TypeScript, not a Python sidecar.** Keeping inference in the request path removes a network hop, a second
  deployment artefact and a serialization boundary — inference p99 is ~0.06 ms. The cost is reimplementing CART,
  boosting, iForest and an autoencoder by hand; the benefit is that every coefficient is inspectable and persisted.
- **Occlusion instead of TreeSHAP.** Exact TreeSHAP is polynomial but fiddly to port; occlusion is model-agnostic,
  works across the *blend* (not just one tree), and produces the same signed, additive story a reviewer needs.
- **Postgres as the warehouse.** Gold-layer cubes (`daily_metrics`) mean long-range charts never re-scan 35k facts, so a
  single Postgres serves OLTP, OLAP and the feature store at this scale. Snowflake/BigQuery is the swap-in at 50M rows.
- **In-process broker.** Preserves Kafka semantics (keys, partitions, offsets, consumer groups, lag) with zero infra,
  which keeps the demo reproducible. It is explicitly *not* a claim of distributed durability — see §15.
- **Dual-channel sessions.** `SameSite=Lax` cookies silently fail inside cross-origin preview iframes. The `Partitioned`
  mirror plus a Bearer fallback makes authentication work everywhere, at the cost of a JS-readable token that carries
  the identical signature and TTL.
- **Integer shillings.** Avoids binary float drift in a financial ledger; cents are irrelevant at M-PESA tariff granularity.

---

## 15. Roadmap to the distributed target

| Concern | Today | Target |
| --- | --- | --- |
| Broker | in-process topic map | Amazon MSK, 24 partitions, 3 AZs |
| Stream processing | Node event loop | Flink on EMR, keyed state, exactly-once sinks |
| Batch | bootstrap stages | Spark 3.5 jobs writing Delta to S3 |
| Orchestration | sequential stages | Airflow DAGs with SLA misses + retries |
| Warehouse | Postgres | Postgres for ops, Snowflake/BigQuery for analytics |
| Object store | Postgres `jsonb` | S3/MinIO bronze·silver·gold parquet partitions |
| Feature store | in-request snapshots | Redis online store + Spark offline store |
| Model registry | `ml_models` table | MLflow with stage promotion and canary shadowing |
| Drift monitoring | none | Evidently reports on PSI/KS per feature, nightly |
| Deployment | single container | ECS Fargate, Terraform, blue/green, CloudWatch |
| Scale target | 34k events/s single node | 100k+ TPS across partitions, p99 < 150 ms e2e |

---

## 16. Data provenance & disclaimer

- **County boundaries** — geoBoundaries *gbOpen* KEN ADM1, licensed **CC-BY 4.0**, `shapeName` attributes preserved and
  reduced with a Douglas-Peucker pass (~1.5 km tolerance, 19,591 → 2,768 vertices) and 3-decimal quantisation.
- **Transactions, customers, merchants, fraud labels** — 100% synthetic, generated from seeded distributions.
- **Not affiliated with Safaricom, Vodacom or the M-PESA brand.** No production M-PESA system is contacted, no real
  subscriber data is stored, and no live credentials exist in this repository. Tariff bands and product names are used
  descriptively to make the modelling realistic.

---

## License

MIT — see [LICENSE](LICENSE).
