/* ------------------------------------------------------------------ *
 * Hand-rolled ML primitives (no python runtime in this deployment).
 * Logistic regression, k-means++, Holt-Winters + AR(p) forecasting,
 * classification metrics. Everything is serialisable so trained
 * artefacts can be persisted to the model registry (Postgres).
 * ------------------------------------------------------------------ */

export type Matrix = number[][];

/* ---------------------------- scaler ---------------------------- */

export class StandardScaler {
  mean: number[];
  std: number[];
  constructor(mean: number[], std: number[]) {
    this.mean = mean;
    this.std = std;
  }
  static fit(x: Matrix): StandardScaler {
    const n = x.length;
    const d = x[0]?.length ?? 0;
    const mean = new Array(d).fill(0);
    const std = new Array(d).fill(0);
    for (const row of x) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
    for (const row of x) {
      for (let j = 0; j < d; j++) {
        const diff = row[j] - mean[j];
        std[j] += (diff * diff) / n;
      }
    }
    return new StandardScaler(mean, std.map((s) => Math.sqrt(s) || 1));
  }
  transformRow(row: number[]): number[] {
    return row.map((v, j) => (v - this.mean[j]) / this.std[j]);
  }
  transform(x: Matrix): Matrix {
    return x.map((r) => this.transformRow(r));
  }
  toJSON() {
    return { mean: this.mean, std: this.std };
  }
  static fromJSON(o: { mean: number[]; std: number[] }): StandardScaler {
    return new StandardScaler(o.mean, o.std);
  }
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/* ----------------------- logistic regression --------------------- */

export type LogisticRegressionArtifact = {
  weights: number[];
  bias: number;
  iterations: number;
  finalLoss: number;
};

export class LogisticRegression {
  weights: number[] = [];
  bias = 0;
  iterations = 0;
  finalLoss = 0;

  train(
    x: Matrix,
    y: number[],
    opts: { lr?: number; l2?: number; iterations?: number } = {},
  ): this {
    const lr = opts.lr ?? 0.15;
    const l2 = opts.l2 ?? 0.0025;
    const iters = opts.iterations ?? 700;
    const d = x[0]?.length ?? 0;
    const w = new Array(d).fill(0);
    let b = 0;
    const n = x.length;
    let loss = 0;

    for (let it = 0; it < iters; it++) {
      const gradW = new Array(d).fill(0);
      let gradB = 0;
      loss = 0;
      for (let i = 0; i < n; i++) {
        const row = x[i];
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * row[j];
        const p = sigmoid(z);
        const err = p - y[i];
        for (let j = 0; j < d; j++) gradW[j] += err * row[j];
        gradB += err;
        const eps = 1e-12;
        loss += -(y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps));
      }
      for (let j = 0; j < d; j++) {
        w[j] -= lr * (gradW[j] / n + l2 * w[j]);
      }
      b -= lr * (gradB / n);
    }
    this.weights = w;
    this.bias = b;
    this.iterations = iters;
    this.finalLoss = loss / Math.max(1, n);
    return this;
  }

  predictProba(row: number[]): number {
    let z = this.bias;
    for (let j = 0; j < row.length; j++) z += this.weights[j] * row[j];
    return sigmoid(z);
  }

  predict(row: number[], threshold = 0.5): number {
    return this.predictProba(row) >= threshold ? 1 : 0;
  }

  /** contribution of each feature to the log-odds (exact for linear models) */
  contributions(row: number[]): number[] {
    return row.map((v, j) => v * this.weights[j]);
  }

  toJSON(): LogisticRegressionArtifact {
    return { weights: this.weights, bias: this.bias, iterations: this.iterations, finalLoss: this.finalLoss };
  }
  static fromJSON(a: LogisticRegressionArtifact): LogisticRegression {
    const m = new LogisticRegression();
    m.weights = a.weights;
    m.bias = a.bias;
    m.iterations = a.iterations;
    m.finalLoss = a.finalLoss;
    return m;
  }
}

/* ------------------------------- k-means ------------------------- */

export type KMeansResult = {
  centroids: Matrix;
  assignments: number[];
  inertia: number;
  iterations: number;
};

export function kmeans(x: Matrix, k: number, seed = 7, maxIter = 60): KMeansResult {
  const n = x.length;
  const d = x[0]?.length ?? 0;
  let s = seed >>> 0;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // k-means++ initialisation
  const centroids: Matrix = [];
  centroids.push(x[Math.floor(rand() * n)].slice());
  while (centroids.length < k) {
    const dists = x.map((row) => Math.min(...centroids.map((c) => c.reduce((a, v, j) => a + (v - row[j]) ** 2, 0))));
    const total = dists.reduce((a, b) => a + b, 0) || 1;
    let target = rand() * total;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      target -= dists[i];
      if (target <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(x[idx].slice());
  }

  const assignments = new Array(n).fill(0);
  let iterations = 0;
  let inertia = 0;

  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    let changed = false;
    inertia = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let j = 0; j < d; j++) dist += (x[i][j] - centroids[c][j]) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = c;
        }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
      inertia += bestD;
    }
    const sums: Matrix = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[assignments[i]]++;
      for (let j = 0; j < d; j++) sums[assignments[i]][j] += x[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      for (let j = 0; j < d; j++) centroids[c][j] = sums[c][j] / counts[c];
    }
    if (!changed) break;
  }
  return { centroids, assignments, inertia, iterations };
}

/* ------------------------ linear algebra ------------------------- */

export function solveLinearSystem(a: Matrix, b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col] || 1e-9;
    for (let j = col; j <= n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/* --------------------------- forecasting ------------------------- */

export type ForecastPoint = { value: number; lower: number; upper: number };

/** Holt-Winters additive seasonality — used for cash-flow & volume forecasting */
export function holtWinters(
  series: number[],
  seasonLength: number,
  horizon: number,
  opts: { alpha?: number; beta?: number; gamma?: number } = {},
): { fitted: number[]; forecast: ForecastPoint[]; mape: number; rmse: number } {
  const n = series.length;
  const alpha = opts.alpha ?? 0.35;
  const beta = opts.beta ?? 0.08;
  const gamma = opts.gamma ?? 0.25;
  const m = Math.max(2, seasonLength);

  if (n < m * 2) {
    // not enough history: fall back to damped drift
    const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n));
    return {
      fitted: series.map(() => mean),
      forecast: Array.from({ length: horizon }, (_, i) => ({
        value: mean,
        lower: Math.max(0, mean - 1.96 * sd * Math.sqrt(i + 1)),
        upper: mean + 1.96 * sd * Math.sqrt(i + 1),
      })),
      mape: 0,
      rmse: sd,
    };
  }

  const seasons = Math.floor(n / m);
  let level = series.slice(0, m).reduce((a, b) => a + b, 0) / m;
  const firstMean = level;
  const secondMean = series.slice(m, m * 2).reduce((a, b) => a + b, 0) / m;
  let trend = (secondMean - firstMean) / m;
  const seasonal = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let acc = 0;
    for (let s = 0; s < seasons; s++) acc += series[s * m + i] - (series.slice(s * m, s * m + m).reduce((a, b) => a + b, 0) / m);
    seasonal[i] = acc / seasons;
  }

  const fitted: number[] = [];
  let sse = 0;
  let apeSum = 0;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const sIdx = i % m;
    const prediction = level + trend + seasonal[sIdx];
    fitted.push(prediction);
    const actual = series[i];
    residuals.push(actual - prediction);
    sse += (actual - prediction) ** 2;
    if (actual !== 0) apeSum += Math.abs((actual - prediction) / actual);
    const prevLevel = level;
    level = alpha * (actual - seasonal[sIdx]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[sIdx] = gamma * (actual - level) + (1 - gamma) * seasonal[sIdx];
  }

  const sd = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length) || 1;
  const forecast: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const value = Math.max(0, level + trend * h + seasonal[(n + h - 1) % m]);
    const band = 1.96 * sd * Math.sqrt(h / 6);
    forecast.push({ value, lower: Math.max(0, value - band), upper: value + band });
  }
  return { fitted, forecast, mape: (apeSum / n) * 100, rmse: Math.sqrt(sse / n) };
}

/** AR(p) fitted by ordinary least squares — baseline comparator */
export function autoRegressive(series: number[], p = 7, horizon = 30): { fitted: number[]; forecast: ForecastPoint[]; mape: number } {
  const n = series.length;
  if (n <= p + 2) return { fitted: series.slice(), forecast: [], mape: 0 };
  const rows: Matrix = [];
  const target: number[] = [];
  for (let i = p; i < n; i++) {
    const row = [1];
    for (let j = 1; j <= p; j++) row.push(series[i - j]);
    rows.push(row);
    target.push(series[i]);
  }
  const dim = p + 1;
  const ata: Matrix = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const atb: number[] = new Array(dim).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < dim; a++) {
      atb[a] += rows[i][a] * target[i];
      for (let b = 0; b < dim; b++) ata[a][b] += rows[i][a] * rows[i][b];
    }
  }
  const coef = solveLinearSystem(
    ata.map((r, i) => r.map((v, j) => (i === j ? v + 1e-6 : v))),
    atb,
  );
  const fitted: number[] = new Array(p).fill(series[0]);
  let ape = 0;
  for (let i = 0; i < rows.length; i++) {
    let v = 0;
    for (let j = 0; j < dim; j++) v += coef[j] * rows[i][j];
    fitted.push(v);
    if (target[i] !== 0) ape += Math.abs((target[i] - v) / target[i]);
  }
  const history = series.slice();
  const forecast: ForecastPoint[] = [];
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const sd = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length) || 1;
  for (let h = 0; h < horizon; h++) {
    let v = coef[0];
    for (let j = 1; j <= p; j++) v += coef[j] * history[history.length - j];
    history.push(v);
    forecast.push({ value: Math.max(0, v), lower: Math.max(0, v - 1.96 * sd), upper: v + 1.96 * sd });
  }
  return { fitted, forecast, mape: (ape / rows.length) * 100 };
}

/* ---------------------------- metrics ---------------------------- */

export function rocAuc(scores: number[], labels: number[]): number {
  const paired = scores.map((s, i) => ({ s, y: labels[i] }));
  paired.sort((a, b) => b.s - a.s);
  let positives = 0;
  let negatives = 0;
  for (const p of paired) p.y === 1 ? positives++ : negatives++;
  if (positives === 0 || negatives === 0) return 0.5;
  let rankSum = 0;
  let i = 0;
  while (i < paired.length) {
    let j = i;
    while (j < paired.length && paired[j].s === paired[i].s) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (paired[k].y === 1) rankSum += avgRank;
    i = j;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function classificationReport(scores: number[], labels: number[], threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const pred = scores[i] >= threshold ? 1 : 0;
    if (pred === 1 && labels[i] === 1) tp++;
    else if (pred === 1 && labels[i] === 0) fp++;
    else if (pred === 0 && labels[i] === 1) fn++;
    else tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const accuracy = (tp + tn) / Math.max(1, scores.length);
  const specificity = tn / Math.max(1, tn + fp);
  return { precision, recall, f1, accuracy, specificity, tp, fp, tn, fn, auc: rocAuc(scores, labels) };
}
