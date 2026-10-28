import { Rng, countyByName, riskLevel, clamp, TXN_TYPES, CHANNELS, COUNTY_WEIGHTS } from "@/lib/core";
import {
  StandardScaler,
  LogisticRegression,
  classificationReport,
  type Matrix,
} from "./core";
import {
  RandomForest,
  GradientBoosting,
  IsolationForest,
  Autoencoder,
  MahalanobisDetector,
} from "./trees";

/* ------------------------------------------------------------------ *
 * Feature store contract. Every event that reaches the fraud engine
 * carries a behavioural snapshot (the "features" produced by the
 * streaming feature-engineering job), which keeps inference stateless.
 * ------------------------------------------------------------------ */

export type TxnEvent = {
  code: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  merchantId?: string | null;
  merchantCode?: string | null;
  merchantName?: string | null;
  recipientId?: string | null;
  type: string;
  status: string;
  channel: string;
  amount: number;
  fee: number;
  county: string;
  lat: number;
  lon: number;
  category: string;
  occurredAt: string;
  hour: number;
  ctx: {
    customerMeanAmount: number;
    customerStdAmount: number;
    homeCounty: string;
    tenureDays: number;
    priorFraudRatio: number;
    knownRecipient: boolean;
    velocity10m: number;
    dailyCount: number;
    merchantFraudRate: number;
    deviceChanges30d: number;
  };
  label?: 0 | 1;
  injected?: string;
};

export const FEATURE_SPECS = [
  { key: "logAmount", label: "Transaction amount", unit: "log10 KSh" },
  { key: "amountZ", label: "Amount deviation from customer baseline", unit: "σ" },
  { key: "velocity10m", label: "Transaction velocity (10 min window)", unit: "count" },
  { key: "dailyCount", label: "Same-day transaction count", unit: "count" },
  { key: "nightFlag", label: "Unusual transaction time (00:00–04:59)", unit: "flag" },
  { key: "hourSin", label: "Hour of day (cyclic sin)", unit: "rad" },
  { key: "hourCos", label: "Hour of day (cyclic cos)", unit: "rad" },
  { key: "geoDistance", label: "Geographic displacement from home county", unit: "km" },
  { key: "countyMismatch", label: "Out-of-county transaction", unit: "flag" },
  { key: "newRecipient", label: "New / unseen recipient", unit: "flag" },
  { key: "cashChannel", label: "Cash-out channel (agent / withdrawal)", unit: "flag" },
  { key: "typeRisk", label: "Transaction-type risk weight", unit: "weight" },
  { key: "feeRatio", label: "Fee-to-amount ratio anomaly", unit: "ratio" },
  { key: "roundAmount", label: "Round-number amount", unit: "flag" },
  { key: "priorFraud", label: "Customer historical fraud ratio", unit: "ratio" },
  { key: "tenure", label: "Account tenure", unit: "log days" },
  { key: "merchantRisk", label: "Merchant fraud exposure", unit: "ratio" },
  { key: "deviceChurn", label: "Device / SIM swap frequency", unit: "count" },
] as const;

export const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  FEATURE_SPECS.map((f) => [f.key, f.label]),
);

const TYPE_RISK: Record<string, number> = {
  SEND_MONEY: 0.55,
  RECEIVE_MONEY: 0.15,
  PAYBILL: 0.1,
  BUY_GOODS: 0.08,
  AIRTIME: 0.12,
  WITHDRAWAL: 0.72,
  DEPOSIT: 0.2,
  BANK_TRANSFER: 0.65,
  REVERSAL: 0.4,
  LOAN_REPAYMENT: 0.18,
};

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function mpesaFee(amount: number): number {
  // approximate M-PESA tariff bands (synthetic, for modelling only)
  if (amount <= 100) return 0;
  if (amount <= 500) return 6;
  if (amount <= 1000) return 8;
  if (amount <= 1500) return 10;
  if (amount <= 2500) return 16;
  if (amount <= 3500) return 22;
  if (amount <= 5000) return 33;
  if (amount <= 7500) return 49;
  if (amount <= 10000) return 65;
  if (amount <= 15000) return 82;
  if (amount <= 20000) return 105;
  if (amount <= 35000) return 140;
  if (amount <= 50000) return 165;
  return Math.min(200, 180 + Math.floor(amount / 50000) * 10);
}

export function extractFeatures(e: TxnEvent): number[] {
  const home = countyByName(e.ctx.homeCounty || e.county);
  const dist = haversineKm(home.lat, home.lon, e.lat, e.lon);
  const sd = Math.max(250, e.ctx.customerStdAmount);
  const amountZ = (e.amount - e.ctx.customerMeanAmount) / sd;
  const expectedFee = mpesaFee(e.amount);
  const feeRatio = expectedFee > 0 ? Math.abs(e.fee - expectedFee) / expectedFee : 0;
  const hour = e.hour;
  return [
    Math.log10(Math.max(1, e.amount)),
    clamp(amountZ, -6, 12),
    clamp(e.ctx.velocity10m, 0, 20),
    clamp(e.ctx.dailyCount, 0, 60),
    hour >= 0 && hour < 5 ? 1 : 0,
    Math.sin((2 * Math.PI * hour) / 24),
    Math.cos((2 * Math.PI * hour) / 24),
    dist / 100,
    home.name !== e.county && dist > 60 ? 1 : 0,
    e.ctx.knownRecipient ? 0 : 1,
    e.channel === "AGENT" || e.type === "WITHDRAWAL" ? 1 : 0,
    TYPE_RISK[e.type] ?? 0.3,
    clamp(feeRatio, 0, 3),
    e.amount % 1000 === 0 && e.amount >= 5000 ? 1 : 0,
    clamp(e.ctx.priorFraudRatio, 0, 1),
    Math.log10(Math.max(1, e.ctx.tenureDays)),
    clamp(e.ctx.merchantFraudRate, 0, 1),
    clamp(e.ctx.deviceChanges30d, 0, 8),
  ];
}

/* ------------------------------------------------------------------ *
 * Rule engine — deterministic, explainable, auditable
 * ------------------------------------------------------------------ */

export type RuleHit = { rule: string; label: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; evidence: string; weight: number };

export const RULE_CATALOGUE = [
  { id: "VEL_001", label: "Velocity anomaly", description: "≥3 transactions inside a 10 minute window" },
  { id: "AMT_002", label: "Amount anomaly", description: "Amount > 4σ above the customer's rolling baseline" },
  { id: "GEO_003", label: "Geographic anomaly", description: "Transaction > 150km from the customer's home county" },
  { id: "RCPT_004", label: "New recipient risk", description: "First-ever transfer to this beneficiary above KSh 20,000" },
  { id: "TIME_005", label: "Unusual transaction time", description: "Activity between 00:00 and 04:59 local time" },
  { id: "STRUCT_006", label: "Structuring / smurfing", description: "Repeated round amounts just below reporting thresholds" },
  { id: "CASH_007", label: "Cash-out burst", description: "Agent withdrawal chain following inbound transfers" },
  { id: "MERCH_008", label: "Merchant risk exposure", description: "Counterparty merchant fraud rate above 4%" },
  { id: "DEV_009", label: "Device / SIM churn", description: "≥2 device or SIM changes in the last 30 days" },
  { id: "FEE_010", label: "Fee schedule mismatch", description: "Charged fee deviates from the published tariff band" },
];

export function applyRules(e: TxnEvent, features: number[]): RuleHit[] {
  const hits: RuleHit[] = [];
  const [logAmount, amountZ, velocity10m, dailyCount, nightFlag, , , geoDist100, countyMismatch, newRecipient, cashChannel, , feeRatio, roundAmount, priorFraud, , merchantRisk, deviceChurn] = features;

  if (velocity10m >= 3)
    hits.push({
      rule: "VEL_001", label: "Velocity anomaly", severity: velocity10m >= 6 ? "CRITICAL" : "HIGH",
      evidence: `${velocity10m} transactions in the last 10 minutes (threshold 3)`, weight: 0.24 + Math.min(0.12, velocity10m * 0.015),
    });
  if (amountZ > 4)
    hits.push({
      rule: "AMT_002", label: "Amount anomaly", severity: amountZ > 8 ? "CRITICAL" : "HIGH",
      evidence: `KSh ${Math.round(e.amount).toLocaleString()} is ${amountZ.toFixed(1)}σ above the baseline of KSh ${Math.round(e.ctx.customerMeanAmount).toLocaleString()}`,
      weight: clamp(0.18 + amountZ * 0.03, 0.18, 0.45),
    });
  if (countyMismatch === 1 && geoDist100 * 100 > 150)
    hits.push({
      rule: "GEO_003", label: "Geographic anomaly", severity: geoDist100 * 100 > 500 ? "HIGH" : "MEDIUM",
      evidence: `${Math.round(geoDist100 * 100)}km from home county (${e.ctx.homeCounty} → ${e.county})`,
      weight: clamp(0.1 + geoDist100 * 0.04, 0.1, 0.3),
    });
  if (newRecipient === 1 && e.amount >= 20000)
    hits.push({
      rule: "RCPT_004", label: "New recipient risk", severity: e.amount >= 100000 ? "CRITICAL" : "HIGH",
      evidence: `First transfer to beneficiary ${e.recipientId ?? "UNKNOWN"} for KSh ${Math.round(e.amount).toLocaleString()}`,
      weight: clamp(0.15 + e.amount / 400000, 0.15, 0.4),
    });
  if (nightFlag === 1 && e.amount > 5000)
    hits.push({
      rule: "TIME_005", label: "Unusual transaction time", severity: "MEDIUM",
      evidence: `Executed at ${String(e.hour).padStart(2, "0")}:xx outside the customer's normal activity window`, weight: 0.12,
    });
  if (roundAmount === 1 && dailyCount >= 4)
    hits.push({
      rule: "STRUCT_006", label: "Structuring / smurfing", severity: "HIGH",
      evidence: `${dailyCount} round-value transactions today (KSh ${Math.round(e.amount).toLocaleString()} each)`, weight: 0.26,
    });
  if (cashChannel === 1 && velocity10m >= 2)
    hits.push({
      rule: "CASH_007", label: "Cash-out burst", severity: "HIGH",
      evidence: "Agent cash-out chained to inbound movement inside the velocity window", weight: 0.2,
    });
  if (merchantRisk > 0.04)
    hits.push({
      rule: "MERCH_008", label: "Merchant risk exposure", severity: merchantRisk > 0.12 ? "HIGH" : "LOW",
      evidence: `Counterparty merchant fraud rate ${(merchantRisk * 100).toFixed(1)}%`, weight: 0.14,
    });
  if (deviceChurn >= 2)
    hits.push({
      rule: "DEV_009", label: "Device / SIM churn", severity: deviceChurn >= 4 ? "HIGH" : "MEDIUM",
      evidence: `${deviceChurn} device/SIM changes recorded in 30 days`, weight: 0.16,
    });
  if (feeRatio > 0.6)
    hits.push({
      rule: "FEE_010", label: "Fee schedule mismatch", severity: "LOW",
      evidence: `Charged fee deviates ${(feeRatio * 100).toFixed(0)}% from the tariff band for KSh ${Math.round(e.amount).toLocaleString()}`,
      weight: 0.1,
    });
  if (priorFraud > 0.05)
    hits.push({
      rule: "HIST_011", label: "Adverse history", severity: "MEDIUM",
      evidence: `${(priorFraud * 100).toFixed(1)}% of the customer's historical volume was confirmed fraudulent`, weight: 0.18,
    });
  void logAmount;
  return hits;
}

/* ------------------------------------------------------------------ *
 * Ensemble bundle
 * ------------------------------------------------------------------ */

export type DetectorScores = {
  logistic: number;
  randomForest: number;
  xgboost: number;
  isolationForest: number;
  autoencoder: number;
  mahalanobis: number;
  rules: number;
};

export type FraudVerdict = {
  score: number;
  level: "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL";
  probability: number;
  detectors: DetectorScores;
  rules: RuleHit[];
  recommendation: string;
  confidence: number;
  reasons: string[];
};

export type FraudBundle = {
  scaler: StandardScaler;
  logistic: LogisticRegression;
  forest: RandomForest;
  boosting: GradientBoosting;
  iforest: IsolationForest;
  autoencoder: Autoencoder;
  mahalanobis: MahalanobisDetector;
  baseline: number[];
  metrics: {
    logistic: ReturnType<typeof classificationReport>;
    randomForest: ReturnType<typeof classificationReport>;
    xgboost: ReturnType<typeof classificationReport>;
    isolationForest: ReturnType<typeof classificationReport>;
    autoencoder: ReturnType<typeof classificationReport>;
    ensemble: ReturnType<typeof classificationReport>;
  };
  trainedAt: string;
  trainingRows: number;
  fraudRate: number;
  trainDurationMs: number;
  featureImportance: { feature: string; label: string; importance: number }[];
};

let cachedBundle: FraudBundle | null = null;
let bundlePromise: Promise<FraudBundle> | null = null;

/* --------- synthetic labelled twin used for training & eval ------- */

export function generateLabelledSample(n: number, seed = 20260128): { events: TxnEvent[]; X: Matrix; y: number[] } {
  const rng = new Rng(seed);
  const events: TxnEvent[] = [];
  let txnSeq = 0;
  for (let i = 0; i < n; i++) {
    const fraudulent = rng.chance(0.045);
    const home = rng.weighted(COUNTY_WEIGHTS);
    const homeCounty = countyByName(home);
    const tenureDays = Math.round(rng.logNormal(6.4, 0.75));
    const baseAmount = rng.logNormal(7.4, 0.85);
    const meanAmount = clamp(baseAmount, 250, 60000);
    const type = fraudulent
      ? rng.weighted([["WITHDRAWAL", 3], ["SEND_MONEY", 4], ["BANK_TRANSFER", 3], ["PAYBILL", 1], ["BUY_GOODS", 1]] as const)
      : rng.weighted([["BUY_GOODS", 26], ["SEND_MONEY", 22], ["PAYBILL", 18], ["AIRTIME", 14], ["RECEIVE_MONEY", 8], ["WITHDRAWAL", 6], ["DEPOSIT", 3], ["BANK_TRANSFER", 1.5], ["LOAN_REPAYMENT", 1], ["REVERSAL", 0.5]] as const);
    const county = fraudulent && rng.chance(0.55) ? countyByName(rng.weighted(COUNTY_WEIGHTS)) : homeCounty;
    const hour = fraudulent
      ? rng.chance(0.42) ? rng.int(0, 4) : rng.int(8, 22)
      : rng.weighted([[rng.int(6, 9), 2], [rng.int(11, 14), 3], [rng.int(17, 21), 4]] as unknown as readonly [number, number][]) as number;
    const amount = fraudulent
      ? Math.round(clamp(meanAmount * rng.float(6, 42), 20000, 480000))
      : Math.round(clamp(rng.logNormal(Math.log(meanAmount), 0.42), 20, 120000));
    const velocity = fraudulent ? (rng.chance(0.6) ? rng.int(3, 9) : rng.int(0, 2)) : rng.chance(0.05) ? rng.int(3, 4) : rng.int(0, 2);
    const e: TxnEvent = {
      code: `TXN-S${(txnSeq++).toString().padStart(7, "0")}`,
      customerId: `cus_${rng.int(1, 2400)}`,
      customerCode: `CUS-${rng.int(10000, 99999)}`,
      customerName: "TWIN CUSTOMER",
      merchantId: type === "BUY_GOODS" || type === "PAYBILL" ? `mer_${rng.int(1, 320)}` : null,
      merchantCode: type === "BUY_GOODS" || type === "PAYBILL" ? `MER-${rng.int(100, 999)}` : null,
      merchantName: type === "BUY_GOODS" || type === "PAYBILL" ? "TWIN MERCHANT" : null,
      recipientId: type === "SEND_MONEY" || type === "BANK_TRANSFER" ? `cus_${rng.int(1, 2400)}` : null,
      type: type as string,
      status: rng.chance(0.03) ? "FAILED" : "COMPLETED",
      channel: fraudulent ? rng.weighted([["AGENT", 3], ["MPESA", 4], ["USSD", 2], ["GLOBALPAY", 1]] as const) : rng.weighted([["MPESA", 5], ["MPESA_APP", 4], ["USSD", 2], ["AGENT", 2], ["GLOBALPAY", 1], ["BANK", 1]] as const),
      amount,
      fee: fraudulent && rng.chance(0.25) ? Math.round(mpesaFee(amount) * rng.float(0.1, 0.6)) : mpesaFee(amount),
      county: county.name,
      lat: county.lat + rng.gaussian(0, 0.08),
      lon: county.lon + rng.gaussian(0, 0.08),
      category: "TWIN",
      occurredAt: new Date(Date.UTC(2026, 0, 1 + rng.int(0, 89), hour, rng.int(0, 59))).toISOString(),
      hour,
      ctx: {
        customerMeanAmount: Math.round(meanAmount),
        customerStdAmount: Math.round(meanAmount * rng.float(0.35, 0.9)),
        homeCounty: homeCounty.name,
        tenureDays,
        priorFraudRatio: fraudulent ? rng.float(0.02, 0.35) : rng.chance(0.08) ? rng.float(0.005, 0.06) : rng.float(0, 0.012),
        knownRecipient: fraudulent ? rng.chance(0.18) : rng.chance(0.78),
        velocity10m: velocity,
        dailyCount: velocity + rng.int(0, fraudulent ? 12 : 4),
        merchantFraudRate: fraudulent ? rng.float(0.01, 0.22) : rng.float(0, 0.04),
        deviceChanges30d: fraudulent ? rng.int(0, 5) : rng.chance(0.08) ? rng.int(2, 3) : rng.int(0, 1),
      },
      label: fraudulent ? 1 : 0,
      injected: fraudulent ? rng.pick(["ACCOUNT_TAKEOVER", "MULE_NETWORK", "CARD_NOT_PRESENT", "SIM_SWAP", "SMURFING", "MERCHANT_COLLUSION"]) : undefined,
    };
    events.push(e);
  }
  const X = events.map((e) => extractFeatures(e));
  const y = events.map((e) => e.label ?? 0);
  return { events, X, y };
}

function shuffleSplit(X: Matrix, y: number[], testRatio: number, seed = 99) {
  const rng = new Rng(seed);
  const idx = X.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const cut = Math.floor(idx.length * (1 - testRatio));
  const tr = idx.slice(0, cut);
  const te = idx.slice(cut);
  return {
    xTrain: tr.map((i) => X[i]), yTrain: tr.map((i) => y[i]),
    xTest: te.map((i) => X[i]), yTest: te.map((i) => y[i]),
  };
}

export async function trainFraudBundle(sampleSize = 9000): Promise<FraudBundle> {
  const started = Date.now();
  const { X, y } = generateLabelledSample(sampleSize);
  const scaler = StandardScaler.fit(X);
  const Z = scaler.transform(X);
  const { xTrain, yTrain, xTest, yTest } = shuffleSplit(Z, y, 0.28);

  const logistic = new LogisticRegression().train(xTrain, yTrain, { lr: 0.12, l2: 0.004, iterations: 500 });
  const forest = new RandomForest().train(xTrain, yTrain, { nTrees: 26, maxDepth: 9, mode: "gini" });
  const boosting = new GradientBoosting().train(xTrain, yTrain, { rounds: 40, maxDepth: 4, learningRate: 0.14 });
  const benignTrain = xTrain.filter((_, i) => yTrain[i] === 0);
  const iforest = new IsolationForest().train(benignTrain, { trees: 64, psi: 256 });
  const autoencoder = new Autoencoder(5, 4242).train(benignTrain, { epochs: 55, lr: 0.012, batchSize: 48 });
  const mahalanobis = new MahalanobisDetector().train(benignTrain);

  const dims = X[0]?.length ?? 0;
  const baseline: number[] = [];
  for (let j = 0; j < dims; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    baseline.push(col[Math.floor(col.length / 2)] ?? 0);
  }

  const report = (scoreFn: (row: number[]) => number, rows: Matrix, labels: number[]) =>
    classificationReport(rows.map(scoreFn), labels, 0.5);

  const ifScore = (row: number[]) => iforest.score(row);
  const aeScore = (row: number[]) => autoencoder.score(row);

  const ensembleScores = xTest.map((row) => {
    const sup = 0.42 * logistic.predictProba(row) + 0.28 * forest.predictProba(row) + 0.3 * boosting.predictProba(row);
    const ano = 0.45 * ifScore(row) + 0.32 * aeScore(row) + 0.23 * mahalanobis.score(row);
    return clamp(0.62 * sup + 0.38 * ano, 0, 1);
  });

  const importance = forest
    .normalisedImportance()
    .map((v, i) => ({ feature: FEATURE_SPECS[i].key, label: FEATURE_SPECS[i].label, importance: v }))
    .sort((a, b) => b.importance - a.importance);

  cachedBundle = {
    scaler, logistic, forest, boosting, iforest, autoencoder, mahalanobis, baseline,
    metrics: {
      logistic: report((r) => logistic.predictProba(r), xTest, yTest),
      randomForest: report((r) => forest.predictProba(r), xTest, yTest),
      xgboost: report((r) => boosting.predictProba(r), xTest, yTest),
      isolationForest: report(ifScore, xTest, yTest),
      autoencoder: report(aeScore, xTest, yTest),
      ensemble: classificationReport(ensembleScores, yTest, 0.5),
    },
    trainedAt: new Date().toISOString(),
    trainingRows: X.length,
    fraudRate: y.reduce((a, b) => a + b, 0) / y.length,
    trainDurationMs: Date.now() - started,
    featureImportance: importance,
  };
  return cachedBundle;
}

export async function getFraudBundle(): Promise<FraudBundle> {
  if (cachedBundle) return cachedBundle;
  if (!bundlePromise) {
    bundlePromise = trainFraudBundle().catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

/* ------------------------------------------------------------------ *
 * Inference
 * ------------------------------------------------------------------ */

export function scoreEvent(bundle: FraudBundle, e: TxnEvent, features = extractFeatures(e)): FraudVerdict {
  const z = bundle.scaler.transformRow(features);
  const lr = bundle.logistic.predictProba(z);
  const rf = bundle.forest.predictProba(z);
  const gb = bundle.boosting.predictProba(z);
  const ifo = bundle.iforest.score(z);
  const ae = bundle.autoencoder.score(z);
  const mh = bundle.mahalanobis.score(z);
  const rules = applyRules(e, features);

  const supervised = 0.42 * lr + 0.28 * rf + 0.3 * gb;
  const anomaly = 0.45 * ifo + 0.32 * ae + 0.23 * mh;
  const ruleScore = clamp(rules.reduce((a, r) => a + r.weight, 0), 0, 1);

  let probability = clamp(0.55 * supervised + 0.24 * anomaly + 0.21 * ruleScore, 0, 1);
  const criticalRule = rules.some((r) => r.severity === "CRITICAL");
  if (criticalRule) probability = clamp(probability * 1.22 + 0.06, 0, 1);
  if (e.status === "FAILED") probability *= 0.82;

  const score = Math.round(probability * 100);
  const level = riskLevel(score);
  const agreement = 1 - (Math.max(lr, rf, gb, ifo, ae) - Math.min(lr, rf, gb, ifo, ae));

  let recommendation = "AUTO-APPROVE";
  if (level === "CRITICAL") recommendation = "BLOCK & ESCALATE";
  else if (level === "HIGH") recommendation = "HOLD FOR REVIEW";
  else if (level === "ELEVATED") recommendation = "STEP-UP AUTHENTICATION";

  return {
    score,
    level,
    probability,
    detectors: { logistic: lr, randomForest: rf, xgboost: gb, isolationForest: ifo, autoencoder: ae, mahalanobis: mh, rules: ruleScore },
    rules,
    recommendation,
    confidence: clamp(0.55 + 0.4 * agreement + Math.min(0.1, rules.length * 0.02), 0, 0.998),
    reasons: rules.map((r) => r.label),
  };
}

/**
 * Occlusion-based attribution (SHAP-style): each feature is replaced with its
 * population baseline and the change in ensemble fraud probability is measured.
 */
export function explainEvent(bundle: FraudBundle, e: TxnEvent, features = extractFeatures(e), verdict = scoreEvent(bundle, e, features)) {
  const base = verdict.probability;
  const rows = features.map((_, j) => {
    const occluded = features.slice();
    occluded[j] = bundle.baseline[j];
    const z = bundle.scaler.transformRow(occluded);
    const lr = bundle.logistic.predictProba(z);
    const rf = bundle.forest.predictProba(z);
    const gb = bundle.boosting.predictProba(z);
    const p = clamp(0.55 * (0.42 * lr + 0.28 * rf + 0.3 * gb) + 0.24 * (0.45 * bundle.iforest.score(z) + 0.32 * bundle.autoencoder.score(z) + 0.23 * bundle.mahalanobis.score(z)) + 0.21 * 0, 0, 1);
    return { index: j, delta: base - p };
  });
  const total = rows.reduce((a, r) => a + Math.abs(r.delta), 0) || 1;
  return rows
    .map((r) => ({
      feature: FEATURE_SPECS[r.index].key,
      label: FEATURE_SPECS[r.index].label,
      contribution: r.delta,
      share: (Math.abs(r.delta) / total) * 100,
      direction: r.delta >= 0 ? "INCREASES RISK" : "DECREASES RISK",
      evidence: evidenceFor(e, features, r.index),
    }))
    .filter((r) => r.share > 0.6)
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);
}

function evidenceFor(e: TxnEvent, f: number[], j: number): string {
  const key = FEATURE_SPECS[j].key;
  switch (key) {
    case "logAmount": return `Amount KSh ${e.amount.toLocaleString()}`;
    case "amountZ": return `${f[1].toFixed(1)}σ vs customer baseline KSh ${Math.round(e.ctx.customerMeanAmount).toLocaleString()}`;
    case "velocity10m": return `${f[2]} txn in 10 minutes`;
    case "dailyCount": return `${f[3]} txn today`;
    case "nightFlag": return f[4] === 1 ? `Executed at ${String(e.hour).padStart(2, "0")}:xx` : `Executed at ${String(e.hour).padStart(2, "0")}:xx (in-window)`;
    case "geoDistance": return `${Math.round(f[7] * 100)}km displacement (${e.ctx.homeCounty} → ${e.county})`;
    case "countyMismatch": return f[8] === 1 ? "Out-of-county activity" : "Home county activity";
    case "newRecipient": return f[9] === 1 ? "Beneficiary never seen before" : "Beneficiary in trusted list";
    case "cashChannel": return f[10] === 1 ? `Cash-out via ${e.channel}` : `Digital channel ${e.channel}`;
    case "typeRisk": return `${e.type} risk weight ${f[11].toFixed(2)}`;
    case "feeRatio": return `Fee KSh ${e.fee} vs expected KSh ${mpesaFee(e.amount)}`;
    case "roundAmount": return f[13] === 1 ? "Round-number value" : "Non-round value";
    case "priorFraud": return `${(f[14] * 100).toFixed(1)}% historical fraud ratio`;
    case "tenure": return `${e.ctx.tenureDays} days tenure`;
    case "merchantRisk": return e.merchantName ? `${(f[16] * 100).toFixed(1)}% merchant fraud rate` : "No merchant counterparty";
    case "deviceChurn": return `${e.ctx.deviceChanges30d} device/SIM changes in 30d`;
    default: return `raw=${f[j].toFixed(3)}`;
  }
}

export const DETECTOR_META = [
  { key: "logistic", name: "Logistic Regression", family: "Supervised · Linear", weight: 0.42 },
  { key: "randomForest", name: "Random Forest", family: "Supervised · Bagged trees", weight: 0.28 },
  { key: "xgboost", name: "Gradient Boosting (XGBoost-style)", family: "Supervised · Boosted trees", weight: 0.3 },
  { key: "isolationForest", name: "Isolation Forest", family: "Unsupervised · Anomaly", weight: 0.45 },
  { key: "autoencoder", name: "Autoencoder", family: "Unsupervised · Neural", weight: 0.32 },
  { key: "mahalanobis", name: "Mahalanobis / One-class", family: "Unsupervised · Statistical", weight: 0.23 },
  { key: "rules", name: "Deterministic Rule Engine", family: "Expert rules · 10 policies", weight: 0.21 },
] as const;

export { TXN_TYPES, CHANNELS };
