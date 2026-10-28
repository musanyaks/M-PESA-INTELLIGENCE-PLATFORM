import { sigmoid, type Matrix } from "./core";

/* ------------------------------------------------------------------ *
 * CART decision tree supporting classification (gini) and regression
 * (variance) splits with quantile candidate thresholds.
 * ------------------------------------------------------------------ */

export type TreeNode = {
  leaf: boolean;
  value: number;
  prob?: number;
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  n: number;
};

function quantileCandidates(values: number[], max: number): number[] {
  const uniq = Array.from(new Set(values));
  if (uniq.length <= max) return uniq;
  const out: number[] = [];
  for (let i = 1; i < max; i++) {
    const idx = Math.floor((i / max) * uniq.length);
    out.push(uniq[idx]);
  }
  return Array.from(new Set(out));
}

function buildTree(
  x: Matrix,
  y: number[],
  idx: number[],
  depth: number,
  opts: { mode: "gini" | "variance"; maxDepth: number; minSplit: number; featureSubset: number[]; importance: number[] },
): TreeNode {
  const n = idx.length;
  const mean = idx.reduce((a, i) => a + y[i], 0) / Math.max(1, n);
  if (depth >= opts.maxDepth || n < opts.minSplit || opts.featureSubset.length === 0) {
    return { leaf: true, value: mean, n };
  }

  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  const parentImpurity =
    opts.mode === "gini"
      ? 1 - Math.min(mean, 1) ** 2 - (1 - Math.min(mean, 1)) ** 2 * 0 + (1 - (mean * mean + (1 - mean) * (1 - mean)))
      : idx.reduce((a, i) => a + (y[i] - mean) ** 2, 0) / n;

  for (const f of opts.featureSubset) {
    const values = idx.map((i) => x[i][f]);
    const candidates = quantileCandidates(values, 10);
    for (const t of candidates) {
      const left: number[] = [];
      const right: number[] = [];
      for (const i of idx) (x[i][f] <= t ? left : right).push(i);
      if (left.length < 2 || right.length < 2) continue;
      let impL = 0;
      let impR = 0;
      if (opts.mode === "gini") {
        const mL = left.reduce((a, i) => a + y[i], 0) / left.length;
        const mR = right.reduce((a, i) => a + y[i], 0) / right.length;
        impL = 1 - (mL * mL + (1 - mL) * (1 - mL));
        impR = 1 - (mR * mR + (1 - mR) * (1 - mR));
      } else {
        const mL = left.reduce((a, i) => a + y[i], 0) / left.length;
        const mR = right.reduce((a, i) => a + y[i], 0) / right.length;
        impL = left.reduce((a, i) => a + (y[i] - mL) ** 2, 0) / left.length;
        impR = right.reduce((a, i) => a + (y[i] - mR) ** 2, 0) / right.length;
      }
      const weighted = (left.length * impL + right.length * impR) / n;
      const gain = parentImpurity - weighted;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = t;
        bestLeft = left;
        bestRight = right;
      }
    }
  }

  if (bestFeature < 0) return { leaf: true, value: mean, n };
  opts.importance[bestFeature] += bestGain * n;

  const sub = () => {
    const d = x[0]?.length ?? 0;
    const count = Math.min(d, opts.featureSubset.length);
    const pool = Array.from({ length: d }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  };

  const leftNode = buildTree(x, y, bestLeft, depth + 1, { ...opts, featureSubset: sub() });
  const rightNode = buildTree(x, y, bestRight, depth + 1, { ...opts, featureSubset: sub() });
  return {
    leaf: false,
    value: mean,
    feature: bestFeature,
    threshold: bestThreshold,
    left: leftNode,
    right: rightNode,
    n,
  };
}

function predictTree(node: TreeNode, row: number[]): number {
  let cur = node;
  while (!cur.leaf && cur.feature !== undefined && cur.left && cur.right) {
    cur = row[cur.feature] <= (cur.threshold ?? 0) ? cur.left : cur.right;
  }
  return cur.value;
}

/* -------------------------- random forest ------------------------ */

export type RandomForestArtifact = {
  mode: "gini" | "variance";
  trees: TreeNode[];
  importance: number[];
  nTrees: number;
  maxDepth: number;
};

export class RandomForest {
  trees: TreeNode[] = [];
  importance: number[] = [];
  mode: "gini" | "variance" = "gini";
  maxDepth = 8;

  train(
    x: Matrix,
    y: number[],
    opts: { nTrees?: number; maxDepth?: number; mode?: "gini" | "variance"; sampleRatio?: number; seed?: number } = {},
  ): this {
    const nTrees = opts.nTrees ?? 28;
    this.maxDepth = opts.maxDepth ?? 8;
    this.mode = opts.mode ?? "gini";
    const n = x.length;
    const d = x[0]?.length ?? 0;
    const sampleSize = Math.max(64, Math.floor(n * (opts.sampleRatio ?? 0.6)));
    const featureCount = Math.max(2, Math.round(Math.sqrt(d)));
    this.trees = [];
    this.importance = new Array(d).fill(0);

    for (let t = 0; t < nTrees; t++) {
      const idx: number[] = [];
      for (let i = 0; i < sampleSize; i++) idx.push(Math.floor(Math.random() * n));
      const pool = Array.from({ length: d }, (_, i) => i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const tree = buildTree(x, y, idx, 0, {
        mode: this.mode,
        maxDepth: this.maxDepth,
        minSplit: 16,
        featureSubset: pool.slice(0, featureCount),
        importance: this.importance,
      });
      this.trees.push(tree);
    }
    return this;
  }

  predictProba(row: number[]): number {
    if (this.trees.length === 0) return 0;
    let sum = 0;
    for (const t of this.trees) sum += predictTree(t, row);
    return this.mode === "gini" ? sum / this.trees.length : sigmoid(sum / this.trees.length);
  }

  predict(row: number[]): number {
    if (this.trees.length === 0) return 0;
    let sum = 0;
    for (const t of this.trees) sum += predictTree(t, row);
    return sum / this.trees.length;
  }

  normalisedImportance(): number[] {
    const total = this.importance.reduce((a, b) => a + b, 0) || 1;
    return this.importance.map((v) => v / total);
  }

  toJSON(): RandomForestArtifact {
    return { mode: this.mode, trees: this.trees, importance: this.importance, nTrees: this.trees.length, maxDepth: this.maxDepth };
  }
}

/* -------------------- gradient boosting (xgboost-style) ---------- */

export type BoostingArtifact = {
  base: number;
  learningRate: number;
  trees: TreeNode[];
  importance: number[];
  rounds: number;
};

export class GradientBoosting {
  trees: TreeNode[] = [];
  base = 0;
  learningRate = 0.12;
  importance: number[] = [];
  rounds = 0;

  train(
    x: Matrix,
    y: number[],
    opts: { rounds?: number; maxDepth?: number; learningRate?: number; sampleRatio?: number } = {},
  ): this {
    const rounds = opts.rounds ?? 45;
    const depth = opts.maxDepth ?? 4;
    this.learningRate = opts.learningRate ?? 0.12;
    const n = x.length;
    const d = x[0]?.length ?? 0;
    const pos = Math.max(1, y.reduce((a, b) => a + b, 0));
    this.base = Math.log(pos / Math.max(1, n - pos));
    this.importance = new Array(d).fill(0);
    this.trees = [];
    let f = new Array(n).fill(this.base);
    const featureCount = Math.max(2, Math.round(d * 0.7));
    const sampleSize = Math.max(128, Math.floor(n * (opts.sampleRatio ?? 0.8)));

    for (let r = 0; r < rounds; r++) {
      const residual = f.map((v, i) => y[i] - sigmoid(v));
      const idx: number[] = [];
      for (let i = 0; i < sampleSize; i++) idx.push(Math.floor(Math.random() * n));
      const pool = Array.from({ length: d }, (_, i) => i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const tree = buildTree(x, residual, idx, 0, {
        mode: "variance",
        maxDepth: depth,
        minSplit: 24,
        featureSubset: pool.slice(0, featureCount),
        importance: this.importance,
      });
      this.trees.push(tree);
      for (let i = 0; i < n; i++) f[i] += this.learningRate * predictTree(tree, x[i]);
    }
    this.rounds = rounds;
    return this;
  }

  rawScore(row: number[]): number {
    let s = this.base;
    for (const t of this.trees) s += this.learningRate * predictTree(t, row);
    return s;
  }

  predictProba(row: number[]): number {
    return sigmoid(this.rawScore(row));
  }

  normalisedImportance(): number[] {
    const total = this.importance.reduce((a, b) => a + b, 0) || 1;
    return this.importance.map((v) => v / total);
  }
}

/* -------------------------- isolation forest --------------------- */

type INode = {
  leaf: boolean;
  size: number;
  feature?: number;
  threshold?: number;
  left?: INode;
  right?: INode;
};

function harmonic(n: number) {
  return Math.log(Math.max(1, n)) + 0.5772156649;
}

function buildITree(x: Matrix, idx: number[], depth: number, maxDepth: number): INode {
  if (depth >= maxDepth || idx.length <= 1) return { leaf: true, size: idx.length };
  const d = x[0].length;
  const f = Math.floor(Math.random() * d);
  let min = Infinity;
  let max = -Infinity;
  for (const i of idx) {
    if (x[i][f] < min) min = x[i][f];
    if (x[i][f] > max) max = x[i][f];
  }
  if (min === max) return { leaf: true, size: idx.length };
  const t = min + Math.random() * (max - min);
  const left: number[] = [];
  const right: number[] = [];
  for (const i of idx) (x[i][f] <= t ? left : right).push(i);
  if (left.length === 0 || right.length === 0) return { leaf: true, size: idx.length };
  return {
    leaf: false,
    size: idx.length,
    feature: f,
    threshold: t,
    left: buildITree(x, left, depth + 1, maxDepth),
    right: buildITree(x, right, depth + 1, maxDepth),
  };
}

function pathLength(node: INode, row: number[], depth: number): number {
  if (node.leaf) return depth + (node.size > 1 ? (2 * harmonic(node.size - 1) - (2 * (node.size - 1)) / node.size) : 0);
  if (node.feature === undefined || !node.left || !node.right) return depth;
  return pathLength(row[node.feature] <= (node.threshold ?? 0) ? node.left : node.right, row, depth + 1);
}

export class IsolationForest {
  private trees: INode[] = [];
  private psi = 256;
  private cNorm = 1;

  train(x: Matrix, opts: { trees?: number; psi?: number } = {}): this {
    const nTrees = opts.trees ?? 70;
    this.psi = Math.min(opts.psi ?? 256, x.length);
    const maxDepth = Math.ceil(Math.log2(Math.max(2, this.psi)));
    this.trees = [];
    for (let t = 0; t < nTrees; t++) {
      const idx: number[] = [];
      for (let i = 0; i < this.psi; i++) idx.push(Math.floor(Math.random() * x.length));
      this.trees.push(buildITree(x, idx, 0, maxDepth));
    }
    this.cNorm = 2 * harmonic(this.psi - 1) - (2 * (this.psi - 1)) / this.psi;
    return this;
  }

  /** anomaly score in (0,1); >0.6 typically anomalous */
  score(row: number[]): number {
    if (this.trees.length === 0 || this.cNorm === 0) return 0.5;
    let sum = 0;
    for (const t of this.trees) sum += pathLength(t, row, 0);
    const eh = sum / this.trees.length;
    return Math.pow(2, -eh / this.cNorm);
  }
}

/* ------------------------------ autoencoder ---------------------- */

export type AutoencoderArtifact = {
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
  hidden: number;
  baselineError: number;
  errorScale: number;
};

/** single-hidden-layer autoencoder trained with Adam; reconstruction error = anomaly signal */
export class Autoencoder {
  private w1: number[][] = [];
  private b1: number[] = [];
  private w2: number[][] = [];
  private b2: number[] = [];
  private hidden: number;
  baselineError = 0;
  errorScale = 1;

  constructor(hidden = 4, seed = 11) {
    this.hidden = hidden;
    let s = seed;
    const rand = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.rand = rand;
  }
  private rand: () => number = Math.random;

  train(x: Matrix, opts: { epochs?: number; lr?: number; batchSize?: number } = {}): this {
    const d = x[0]?.length ?? 0;
    const h = this.hidden;
    const scale = Math.sqrt(6 / (d + h));
    this.w1 = Array.from({ length: h }, () => Array.from({ length: d }, () => (this.rand() * 2 - 1) * scale));
    this.b1 = new Array(h).fill(0);
    this.w2 = Array.from({ length: d }, () => Array.from({ length: h }, () => (this.rand() * 2 - 1) * Math.sqrt(6 / (h + d))));
    this.b2 = new Array(d).fill(0);

    const epochs = opts.epochs ?? 90;
    const lr = opts.lr ?? 0.01;
    const batch = opts.batchSize ?? 64;
    const n = x.length;
    const mW1 = this.w1.map((r) => r.map(() => 0));
    const mW2 = this.w2.map((r) => r.map(() => 0));
    const vW1 = mW1.map((r) => r.map(() => 0));
    const vW2 = mW2.map((r) => r.map(() => 0));
    const mB1 = new Array(h).fill(0);
    const mB2 = new Array(d).fill(0);
    const vB1 = new Array(h).fill(0);
    const vB2 = new Array(d).fill(0);
    let step = 0;
    const beta1 = 0.9;
    const beta2 = 0.999;

    for (let e = 0; e < epochs; e++) {
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let start = 0; start < n; start += batch) {
        const slice = order.slice(start, start + batch);
        const gW1 = this.w1.map((r) => r.map(() => 0));
        const gW2 = this.w2.map((r) => r.map(() => 0));
        const gB1 = new Array(h).fill(0);
        const gB2 = new Array(d).fill(0);
        for (const i of slice) {
          const row = x[i];
          const z: number[] = new Array(h);
          const a: number[] = new Array(h);
          for (let j = 0; j < h; j++) {
            let s = this.b1[j];
            for (let k = 0; k < d; k++) s += this.w1[j][k] * row[k];
            z[j] = s;
            a[j] = Math.tanh(s);
          }
          const out: number[] = new Array(d);
          for (let k = 0; k < d; k++) {
            let s = this.b2[k];
            for (let j = 0; j < h; j++) s += this.w2[k][j] * a[j];
            out[k] = Math.tanh(s);
          }
          const bs = slice.length;
          for (let k = 0; k < d; k++) {
            const dOut = (2 * (out[k] - row[k])) / bs;
            const dz = dOut * (1 - out[k] * out[k]);
            gB2[k] += dz;
            for (let j = 0; j < h; j++) {
              gW2[k][j] += dz * a[j];
              gB1[j] += dz * this.w2[k][j] * (1 - z[j] * z[j]);
            }
          }
          for (let j = 0; j < h; j++) {
            for (let k = 0; k < d; k++) gW1[j][k] += gB1[j] * row[k];
          }
          for (let j = 0; j < h; j++) gB1[j] /= 1;
        }
        step++;
        const c1 = 1 - Math.pow(beta1, step);
        const c2 = 1 - Math.pow(beta2, step);
        for (let j = 0; j < h; j++) {
          for (let k = 0; k < d; k++) {
            mW1[j][k] = beta1 * mW1[j][k] + (1 - beta1) * gW1[j][k];
            vW1[j][k] = beta2 * vW1[j][k] + (1 - beta2) * gW1[j][k] ** 2;
            this.w1[j][k] -= (lr * mW1[j][k]) / c1 / (Math.sqrt(vW1[j][k] / c2) + 1e-8);
            mW2[j] = mW2[j] ?? [];
          }
          mB1[j] = beta1 * mB1[j] + (1 - beta1) * gB1[j];
          vB1[j] = beta2 * vB1[j] + (1 - beta2) * gB1[j] ** 2;
          this.b1[j] -= (lr * mB1[j]) / c1 / (Math.sqrt(vB1[j] / c2) + 1e-8);
        }
        for (let k = 0; k < d; k++) {
          for (let j = 0; j < h; j++) {
            mW2[k][j] = beta1 * mW2[k][j] + (1 - beta1) * gW2[k][j];
            vW2[k][j] = beta2 * vW2[k][j] + (1 - beta2) * gW2[k][j] ** 2;
            this.w2[k][j] -= (lr * mW2[k][j]) / c1 / (Math.sqrt(vW2[k][j] / c2) + 1e-8);
          }
          mB2[k] = beta1 * mB2[k] + (1 - beta1) * gB2[k];
          vB2[k] = beta2 * vB2[k] + (1 - beta2) * gB2[k] ** 2;
          this.b2[k] -= (lr * mB2[k]) / c1 / (Math.sqrt(vB2[k] / c2) + 1e-8);
        }
      }
    }
    const errs = x.map((r) => this.reconstructionError(r));
    errs.sort((a, b) => a - b);
    this.baselineError = errs[Math.floor(errs.length * 0.5)] ?? 0;
    this.errorScale = Math.max(1e-6, (errs[Math.floor(errs.length * 0.99)] ?? 1) - this.baselineError);
    return this;
  }

  reconstructionError(row: number[]): number {
    const d = row.length;
    const h = this.hidden;
    const a: number[] = new Array(h);
    for (let j = 0; j < h; j++) {
      let s = this.b1[j];
      for (let k = 0; k < d; k++) s += this.w1[j][k] * row[k];
      a[j] = Math.tanh(s);
    }
    let err = 0;
    for (let k = 0; k < d; k++) {
      let s = this.b2[k];
      for (let j = 0; j < h; j++) s += this.w2[k][j] * a[j];
      const out = Math.tanh(s);
      err += (out - row[k]) ** 2;
    }
    return err / Math.max(1, d);
  }

  /** normalised anomaly score in (0,1) */
  score(row: number[]): number {
    const err = this.reconstructionError(row);
    const z = (err - this.baselineError) / this.errorScale;
    return Math.max(0, Math.min(1, 0.5 + z * 0.22));
  }

  toJSON(): AutoencoderArtifact {
    return {
      w1: this.w1,
      b1: this.b1,
      w2: this.w2,
      b2: this.b2,
      hidden: this.hidden,
      baselineError: this.baselineError,
      errorScale: this.errorScale,
    };
  }
}

/* --------------------- Mahalanobis outlier detector --------------- */

export class MahalanobisDetector {
  private mean: number[] = [];
  private inv: number[][] = [];
  private scale = 1;

  train(x: Matrix): this {
    const n = x.length;
    const d = x[0]?.length ?? 0;
    this.mean = new Array(d).fill(0);
    for (const row of x) for (let j = 0; j < d; j++) this.mean[j] += row[j] / n;
    const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const row of x) {
      for (let a = 0; a < d; a++) {
        for (let b = 0; b < d; b++) cov[a][b] += ((row[a] - this.mean[a]) * (row[b] - this.mean[b])) / n;
      }
    }
    for (let a = 0; a < d; a++) cov[a][a] += 1e-4;
    this.inv = invertMatrix(cov);
    const scores = x.map((r) => this.distance(r));
    const sorted = scores.slice().sort((a, b) => a - b);
    this.scale = sorted[Math.floor(sorted.length * 0.98)] || 1;
    return this;
  }

  distance(row: number[]): number {
    const d = row.length;
    const diff = row.map((v, j) => v - this.mean[j]);
    let s = 0;
    for (let a = 0; a < d; a++) {
      let acc = 0;
      for (let b = 0; b < d; b++) acc += this.inv[a][b] * diff[b];
      s += diff[a] * acc;
    }
    return Math.sqrt(Math.max(0, s));
  }

  score(row: number[]): number {
    return Math.max(0, Math.min(1, this.distance(row) / (this.scale * 1.35)));
  }

  toJSON() {
    return { mean: this.mean, inv: this.inv, scale: this.scale };
  }
}

export function invertMatrix(m: number[][]): number[][] {
  const n = m.length;
  const aug: number[][] = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const div = aug[col][col] || 1e-9;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}
