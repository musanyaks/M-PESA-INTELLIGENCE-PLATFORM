/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32 + gaussian) so the synthetic M-PESA
 * digital twin is reproducible across rebuilds.
 * ------------------------------------------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private r: () => number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  float(min = 0, max = 1) {
    return min + (max - min) * this.r();
  }
  int(min: number, max: number) {
    return Math.floor(this.float(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.r() * arr.length) % arr.length];
  }
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, e) => s + e[1], 0);
    let x = this.r() * total;
    for (const [value, w] of entries) {
      x -= w;
      if (x <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }
  gaussian(mean = 0, sd = 1) {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.r() * 2 - 1;
      v = this.r() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return mean + sd * (u * mul);
  }
  logNormal(mu: number, sigma: number) {
    return Math.exp(this.gaussian(mu, sigma));
  }
  /** true with probability p */
  chance(p: number) {
    return this.r() < p;
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function uid(prefix: string, rand: () => number = Math.random) {
  const t = Date.now().toString(36);
  const r = Math.floor(rand() * 1e6)
    .toString(36)
    .padStart(4, "0");
  return `${prefix}_${t}${r}`.toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Kenyan geography (county centroids used by the geographic engine)
 * ------------------------------------------------------------------ */

export type County = {
  name: string;
  code: number;
  lat: number;
  lon: number;
  /** relative share of M-PESA activity in the digital twin */
  weight: number;
  region: "NAIROBI METRO" | "CENTRAL" | "COAST" | "EASTERN" | "NYANZA" | "RIFT VALLEY" | "WESTERN" | "NORTH EASTERN";
};

export const COUNTIES: County[] = [
  { name: "Nairobi", code: 47, lat: -1.2864, lon: 36.8172, weight: 24.0, region: "NAIROBI METRO" },
  { name: "Kiambu", code: 22, lat: -1.1714, lon: 36.8356, weight: 7.4, region: "CENTRAL" },
  { name: "Nakuru", code: 32, lat: -0.3031, lon: 36.08, weight: 7.1, region: "RIFT VALLEY" },
  { name: "Mombasa", code: 1, lat: -4.0435, lon: 39.6682, weight: 6.6, region: "COAST" },
  { name: "Kisumu", code: 42, lat: -0.0917, lon: 34.768, weight: 5.4, region: "NYANZA" },
  { name: "Uasin Gishu", code: 27, lat: 0.5143, lon: 35.2698, weight: 4.3, region: "RIFT VALLEY" },
  { name: "Machakos", code: 16, lat: -1.5177, lon: 37.2634, weight: 3.4, region: "EASTERN" },
  { name: "Kajiado", code: 20, lat: -2.0981, lon: 36.782, weight: 3.2, region: "RIFT VALLEY" },
  { name: "Kakamega", code: 26, lat: 0.2827, lon: 34.7516, weight: 3.0, region: "WESTERN" },
  { name: "Bungoma", code: 39, lat: 0.5636, lon: 34.5603, weight: 2.8, region: "WESTERN" },
  { name: "Meru", code: 12, lat: 0.0562, lon: 37.6556, weight: 2.7, region: "EASTERN" },
  { name: "Kilifi", code: 3, lat: -3.6305, lon: 39.8494, weight: 2.6, region: "COAST" },
  { name: "Nyeri", code: 0, lat: -0.4206, lon: 36.9476, weight: 2.4, region: "CENTRAL" },
  { name: "Murang'a", code: 21, lat: -0.7219, lon: 37.1527, weight: 2.3, region: "CENTRAL" },
  { name: "Kericho", code: 35, lat: -0.3676, lon: 35.2858, weight: 2.1, region: "RIFT VALLEY" },
  { name: "Kisii", code: 45, lat: -0.6811, lon: 34.7668, weight: 2.1, region: "NYANZA" },
  { name: "Kitui", code: 15, lat: -1.367, lon: 38.0109, weight: 2.0, region: "EASTERN" },
  { name: "Trans Nzoia", code: 26, lat: 1.0567, lon: 34.9506, weight: 1.9, region: "RIFT VALLEY" },
  { name: "Kwale", code: 2, lat: -4.1737, lon: 39.4521, weight: 1.7, region: "COAST" },
  { name: "Makueni", code: 17, lat: -1.8049, lon: 37.4222, weight: 1.7, region: "EASTERN" },
  { name: "Homa Bay", code: 43, lat: -0.5273, lon: 34.4571, weight: 1.6, region: "NYANZA" },
  { name: "Garissa", code: 7, lat: -0.4569, lon: 39.6512, weight: 1.2, region: "NORTH EASTERN" },
  { name: "Laikipia", code: 31, lat: 0.3606, lon: 36.8601, weight: 1.1, region: "RIFT VALLEY" },
  { name: "Turkana", code: 23, lat: 3.1, lon: 35.6, weight: 0.9, region: "RIFT VALLEY" },
  { name: "Wajir", code: 8, lat: 1.7471, lon: 40.0573, weight: 0.8, region: "NORTH EASTERN" },
  { name: "Mandera", code: 9, lat: 3.9366, lon: 41.867, weight: 0.7, region: "NORTH EASTERN" },
  { name: "Marsabit", code: 6, lat: 2.3333, lon: 37.9833, weight: 0.7, region: "EASTERN" },
  { name: "Isiolo", code: 11, lat: 0.3546, lon: 37.5822, weight: 0.5, region: "EASTERN" },
  { name: "Lamu", code: 5, lat: -2.2717, lon: 40.902, weight: 0.5, region: "COAST" },
  { name: "Taita Taveta", code: 18, lat: -3.4, lon: 38.36, weight: 0.8, region: "COAST" },
  { name: "Embu", code: 14, lat: -0.5306, lon: 37.45, weight: 1.2, region: "EASTERN" },
  { name: "Tharaka Nithi", code: 13, lat: -0.3, lon: 37.85, weight: 0.9, region: "EASTERN" },
  { name: "Kirinyaga", code: 20, lat: -0.5, lon: 37.28, weight: 1.3, region: "CENTRAL" },
  { name: "Nyandarua", code: 18, lat: -0.18, lon: 36.53, weight: 1.2, region: "CENTRAL" },
  { name: "Busia", code: 40, lat: 0.4606, lon: 34.2431, weight: 1.1, region: "WESTERN" },
  { name: "Siaya", code: 41, lat: 0.06, lon: 34.28, weight: 1.3, region: "NYANZA" },
  { name: "Migori", code: 44, lat: -1.0636, lon: 34.1542, weight: 1.4, region: "NYANZA" },
  { name: "Bomet", code: 36, lat: -0.7811, lon: 35.3406, weight: 1.3, region: "RIFT VALLEY" },
  { name: "Nandi", code: 29, lat: 0.1833, lon: 34.9833, weight: 1.3, region: "RIFT VALLEY" },
  { name: "Vihiga", code: 38, lat: 0.05, lon: 34.72, weight: 1.0, region: "WESTERN" },
  { name: "Nyamira", code: 46, lat: -0.5603, lon: 34.9304, weight: 1.0, region: "NYANZA" },
  { name: "Elgeyo Marakwet", code: 28, lat: 0.75, lon: 35.45, weight: 0.8, region: "RIFT VALLEY" },
  { name: "West Pokot", code: 24, lat: 1.62, lon: 35.12, weight: 0.9, region: "RIFT VALLEY" },
  { name: "Baringo", code: 30, lat: 0.47, lon: 35.96, weight: 0.9, region: "RIFT VALLEY" },
  { name: "Samburu", code: 25, lat: 1.2, lon: 36.9, weight: 0.5, region: "RIFT VALLEY" },
  { name: "Tana River", code: 4, lat: -1.8, lon: 39.65, weight: 0.6, region: "COAST" },
];

export const COUNTY_WEIGHTS: [string, number][] = COUNTIES.map((c) => [c.name, c.weight] as [string, number]);

export function countyByName(name: string): County {
  return COUNTIES.find((c) => c.name === name) ?? COUNTIES[0];
}

/** equirectangular projection into a 0..1 box over Kenya's bounding rectangle */
const KENYA_BOUNDS = { minLon: 33.85, maxLon: 41.95, minLat: -4.75, maxLat: 5.4 };

export function projectKenya(lon: number, lat: number): { x: number; y: number } {
  const cosLat = Math.cos(((-0.3 * Math.PI) / 180) * 0.5);
  const x = (lon - KENYA_BOUNDS.minLon) / (KENYA_BOUNDS.maxLon - KENYA_BOUNDS.minLon) / cosLat;
  const y = (KENYA_BOUNDS.maxLat - lat) / (KENYA_BOUNDS.maxLat - KENYA_BOUNDS.minLat);
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** simplified Kenya national outline (lon, lat) */
export const KENYA_OUTLINE: [number, number][] = [
  [33.97, 0.55], [33.9, -0.6], [34.07, -1.06], [34.6, -1.06], [35.6, -1.6],
  [36.6, -2.1], [37.62, -3.1], [38.6, -3.7], [39.2, -4.68], [39.6, -4.05],
  [40.05, -3.3], [40.4, -2.7], [40.9, -2.2], [41.55, -1.6], [41.0, -0.5],
  [40.98, 0.6], [41.2, 1.4], [40.9, 2.1], [40.98, 3.0], [41.85, 3.9],
  [40.98, 4.2], [39.8, 3.9], [38.4, 3.6], [36.9, 4.45], [36.0, 4.45],
  [35.85, 5.3], [35.0, 5.0], [34.4, 4.6], [34.0, 4.0], [33.9, 3.4],
  [34.1, 2.3], [34.0, 1.5], [33.97, 0.55],
];

/* ------------------------------------------------------------------ *
 * Domain constants
 * ------------------------------------------------------------------ */

/** the synthetic twin models 1/50th of the national ecosystem */
export const TWIN_SCALE = 50;

export const TXN_TYPES = [
  "SEND_MONEY", "RECEIVE_MONEY", "PAYBILL", "BUY_GOODS", "AIRTIME",
  "WITHDRAWAL", "DEPOSIT", "BANK_TRANSFER", "REVERSAL", "LOAN_REPAYMENT",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const TXN_LABEL: Record<string, string> = {
  SEND_MONEY: "Send Money",
  RECEIVE_MONEY: "Receive Money",
  PAYBILL: "PayBill",
  BUY_GOODS: "Buy Goods / Till",
  AIRTIME: "Airtime",
  WITHDRAWAL: "Withdrawal",
  DEPOSIT: "Deposit",
  BANK_TRANSFER: "Bank Transfer",
  REVERSAL: "Reversal",
  LOAN_REPAYMENT: "Loan Repayment",
};

export const TXN_CATEGORY: Record<string, string> = {
  SEND_MONEY: "P2P TRANSFER",
  RECEIVE_MONEY: "P2P TRANSFER",
  PAYBILL: "UTILITIES & BILLERS",
  BUY_GOODS: "RETAIL",
  AIRTIME: "TELCO",
  WITHDRAWAL: "CASH OUT",
  DEPOSIT: "CASH IN",
  BANK_TRANSFER: "BANKING",
  REVERSAL: "ADJUSTMENT",
  LOAN_REPAYMENT: "CREDIT",
};

export const CHANNELS = ["MPESA", "MPESA_APP", "USSD", "AGENT", "GLOBALPAY", "BANK"] as const;

export const ROLES = ["ADMIN", "ANALYST", "FRAUD_ANALYST", "MERCHANT", "CUSTOMER", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

/** capability matrix — what each role may do across the API surface */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ["read:all", "write:all", "manage:users", "run:pipeline", "ack:alerts", "resolve:cases", "export:data", "view:pii"],
  ANALYST: ["read:all", "run:pipeline", "export:data", "view:analytics"],
  FRAUD_ANALYST: ["read:all", "ack:alerts", "resolve:cases", "view:fraud", "export:data"],
  MERCHANT: ["read:merchant", "view:analytics"],
  CUSTOMER: ["read:self"],
  AUDITOR: ["read:all", "view:audit"],
};

export function roleCan(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[(role as Role) ?? "CUSTOMER"] ?? [];
  return perms.includes("write:all") || perms.includes(permission) || perms.includes("read:all");
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

export function ksh(n: number, decimals = 0): string {
  return `KSh ${n.toLocaleString("en-KE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function compactKsh(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `KSh ${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `KSh ${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `KSh ${(n / 1e3).toFixed(1)}K`;
  return `KSh ${Math.round(n)}`;
}

export function compactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function pct(n: number, decimals = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

export function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 6) return "******";
  return `${msisdn.slice(0, 4)}•••${msisdn.slice(-2)}`;
}

export function maskName(name: string): string {
  const parts = name.split(" ");
  if (parts.length < 2) return `${name.slice(0, 2)}***`;
  return `${parts[0]} ${parts[1][0]}.***`;
}

export function riskLevel(score: number): "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL" {
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 40) return "ELEVATED";
  return "NORMAL";
}

export const RISK_COLOUR: Record<string, string> = {
  NORMAL: "#35D07F",
  ELEVATED: "#4FD1E0",
  HIGH: "#F2A93B",
  CRITICAL: "#FF5C5C",
};

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function hourBucket(d: Date): number {
  return d.getUTCHours();
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor((p / 100) * sorted.length), 0, sorted.length - 1);
  return sorted[idx];
}
