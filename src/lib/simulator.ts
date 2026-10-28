import {
  Rng, hashString, COUNTIES, COUNTY_WEIGHTS, countyByName, TXN_TYPES, TXN_CATEGORY,
  CHANNELS, clamp,
} from "./core";
import { mpesaFee, type TxnEvent } from "./ml/fraud";

/* ------------------------------------------------------------------ *
 * Synthetic M-PESA ecosystem ("digital twin").
 * No connection to any live telco system: population, merchants and
 * transaction flows are generated from seeded distributions with
 * injected fraud patterns so the whole platform can be demonstrated
 * without touching real customer data.
 * ------------------------------------------------------------------ */

const FIRST_NAMES = [
  "Amina","Wanjiku","Otieno","Njeri","Kimani","Mwangi","Achieng","Odhiambo","Kamau","Nyambura",
  "Hassan","Mohamed","Fatuma","Wanjiru","Kipchoge","Chebet","Kiplagat","Njoroge","Muthoni","Kariuki",
  "Gitau","Waithera","Mutua","Musyoka","Akinyi","Owino","Adhiambo","Omondi","Kibet","Cherono",
  "Rotich","Barasa","Wekesa","Nafula","Maina","Gathoni","Wairimu","Mumbi","Kinyua","Murugi",
  "Ndegwa","Wambui","Karanja","Mugo","Njuguna","Zainab","Ibrahim","Aisha","Peter","Grace",
  "Samuel","Esther","Daniel","Mercy","Joseph","Beatrice","Brian","Cynthia","Dennis","Faith",
];
const LAST_NAMES = [
  "Omondi","Kamau","Mwangi","Otieno","Njoroge","Kiplagat","Cheruiyot","Mutua","Wanjala","Barasa",
  "Kimani","Odhiambo","Achieng","Waweru","Githinji","Mbugua","Karanja","Njenga","Muthoni","Kariuki",
  "Ali","Hassan","Abdallah","Juma","Mwinyi","Salim","Nyongo","Ochieng","Owino","Onyango",
  "Kibet","Rotich","Sang","Bett","Korir","Langat","Chepkoech","Jepchirchir","Kimutai","Ngetich",
  "Koech","Ruto","Sigei","Tuwei","Yegon","Wambui","Gitonga","Macharia","Ndungu","Thuku",
];

export const MERCHANT_CATEGORIES = [
  "SUPERMARKET","PHARMACY","FUEL","UTILITIES","EDUCATION","TRANSPORT","TELECOM",
  "RESTAURANT","ELECTRONICS","HARDWARE","HEALTHCARE","AGRIBUSINESS","GENERAL RETAIL",
  "GOVERNMENT","SACCO","INSURANCE","ENTERTAINMENT",
] as const;

const BRAND_PREFIX = [
  "Mwanga","Jenga","Safi","Nuru","Pamoja","Uzima","Kilimo","Bahati","Imara","Tatu",
  "Kesho","Amani","Baraka","Tulia","Mavuno","Nyota","Raha","Sanaa","Haraka","Thamani",
];
const BRAND_SUFFIX: Record<string, string[]> = {
  SUPERMARKET: ["Mart","Foods","Supermarket","Grocers"],
  PHARMACY: ["Pharmacy","Chemist","Dawa Point"],
  FUEL: ["Energy","Petrol","Fuel Station"],
  UTILITIES: ["Power","Water","Electricity"],
  EDUCATION: ["Academy","Institute","School"],
  TRANSPORT: ["Cabs","Matatu Sacco","Logistics","Ride"],
  TELECOM: ["Comms","Airtime Hub","Mobile"],
  RESTAURANT: ["Kitchen","Grill","Cafe","Nyama Choma"],
  ELECTRONICS: ["Electronics","Tech","Gadgets"],
  HARDWARE: ["Hardware","Buildings Supplies"],
  HEALTHCARE: ["Clinic","Medical Centre","Health"],
  AGRIBUSINESS: ["Agrovets","Farmers Co-op","Produce"],
  "GENERAL RETAIL": ["Traders","Kiosk","Duka","Stores"],
  GOVERNMENT: ["County Services","Revenue","eCitizen Desk"],
  SACCO: ["Sacco","Investments","Chama"],
  INSURANCE: ["Assurance","Cover","Underwriters"],
  ENTERTAINMENT: ["Betting","Cinema","Sports Lounge"],
};

export type TwinCustomer = {
  id: string;
  code: string;
  name: string;
  msisdn: string;
  county: string;
  lat: number;
  lon: number;
  tenureDays: number;
  meanAmount: number;
  stdAmount: number;
  dailyFrequency: number;
  digitalRatio: number;
  primaryType: string;
  peakHour: number;
  priorFraudRatio: number;
  deviceChanges30d: number;
  risky: boolean;
  monthlyIncome: number;
  knownRecipients: string[];
};

export type TwinMerchant = {
  id: string;
  code: string;
  name: string;
  category: string;
  county: string;
  till: string;
  paybill: string | null;
  avgTicket: number;
  fraudRate: number;
  popularity: number;
};

function makeName(rng: Rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function msisdn(rng: Rng) {
  const prefixes = ["0722","0733","0710","0701","0755","0768","0741","0790","0712","0785"];
  return `${rng.pick(prefixes)}${String(rng.int(0, 999999)).padStart(6, "0")}`;
}

export function buildTwinPopulation(opts: { customers?: number; merchants?: number; seed?: number } = {}) {
  const nCustomers = opts.customers ?? 2400;
  const nMerchants = opts.merchants ?? 320;
  const rng = new Rng(opts.seed ?? 1337);
  const customers: TwinCustomer[] = [];
  const merchants: TwinMerchant[] = [];
  const namesUsed = new Set<string>();

  for (let i = 0; i < nMerchants; i++) {
    const category = rng.weighted(MERCHANT_CATEGORIES.map((c, idx) => [c, 20 - idx * 0.4] as [string, number]));
    const county = countyByName(rng.weighted(COUNTY_WEIGHTS));
    const suffixes = BRAND_SUFFIX[category] ?? ["Traders"];
    let name = `${rng.pick(BRAND_PREFIX)} ${rng.pick(suffixes)}`;
    let guard = 0;
    while (namesUsed.has(name) && guard++ < 8) name = `${rng.pick(BRAND_PREFIX)} ${rng.pick(suffixes)} ${guard}`;
    namesUsed.add(name);
    const avgTicket = Math.round(
      category === "UTILITIES" ? rng.logNormal(7.9, 0.7) :
      category === "EDUCATION" ? rng.logNormal(9.6, 0.6) :
      category === "FUEL" ? rng.logNormal(8.6, 0.35) :
      category === "SUPERMARKET" ? rng.logNormal(7.6, 0.55) :
      category === "GOVERNMENT" ? rng.logNormal(8.4, 0.8) :
      rng.logNormal(6.6, 0.9),
    );
    merchants.push({
      id: `mer_${i + 1}`,
      code: `MER-${String(1000 + i)}`,
      name,
      category,
      county: county.name,
      till: String(rng.int(100000, 999999)),
      paybill: category === "UTILITIES" || category === "GOVERNMENT" || category === "SACCO" || category === "EDUCATION" ? String(rng.int(200000, 899999)) : null,
      avgTicket: clamp(avgTicket, 80, 400000),
      fraudRate: rng.chance(0.07) ? rng.float(0.05, 0.24) : rng.float(0.001, 0.035),
      popularity: rng.logNormal(0, 0.9),
    });
  }

  namesUsed.clear();
  for (let i = 0; i < nCustomers; i++) {
    const county = countyByName(rng.weighted(COUNTY_WEIGHTS));
    let name = makeName(rng);
    let guard = 0;
    while (namesUsed.has(name) && guard++ < 10) name = makeName(rng);
    namesUsed.add(name);

    const archetype = rng.weighted([
      ["LOW_FREQUENCY", 26], ["REGULAR", 30], ["DAILY_TRANSACTOR", 14],
      ["BUSINESS", 12], ["DIGITAL_HEAVY", 13], ["HIGH_RISK", 5],
    ] as [string, number][]);

    const monthlyIncome = Math.round(
      archetype === "BUSINESS" ? rng.logNormal(12.1, 0.6) :
      archetype === "HIGH_VALUE" ? rng.logNormal(11.9, 0.5) :
      archetype === "DIGITAL_HEAVY" ? rng.logNormal(11.2, 0.5) :
      rng.logNormal(10.5, 0.75),
    );
    const meanAmount = clamp(Math.round(monthlyIncome / rng.float(18, 90)), 120, 90000);

    customers.push({
      id: `cus_${i + 1}`,
      code: `CUS-${String(10000 + i)}`,
      name,
      msisdn: msisdn(rng),
      county: county.name,
      lat: county.lat + rng.gaussian(0, 0.06),
      lon: county.lon + rng.gaussian(0, 0.06),
      tenureDays: Math.round(clamp(rng.logNormal(6.6, 0.7), 14, 4200)),
      meanAmount,
      stdAmount: Math.round(meanAmount * rng.float(0.35, 1.1)),
      dailyFrequency: archetype === "DAILY_TRANSACTOR" ? rng.float(1.6, 5.2) : archetype === "BUSINESS" ? rng.float(1.2, 4.4) : archetype === "REGULAR" ? rng.float(0.35, 1.1) : archetype === "DIGITAL_HEAVY" ? rng.float(0.8, 2.6) : rng.float(0.03, 0.22),
      digitalRatio: archetype === "DIGITAL_HEAVY" ? rng.float(0.82, 0.99) : archetype === "LOW_FREQUENCY" ? rng.float(0.1, 0.45) : rng.float(0.4, 0.9),
      primaryType: rng.pick(TXN_TYPES),
      peakHour: rng.weighted([[8, 2], [12, 3], [18, 4], [21, 2], [3, 0.3]] as [number, number][]),
      priorFraudRatio: archetype === "HIGH_RISK" ? rng.float(0.06, 0.34) : rng.chance(0.06) ? rng.float(0.01, 0.07) : rng.float(0, 0.015),
      deviceChanges30d: archetype === "HIGH_RISK" ? rng.int(1, 5) : rng.chance(0.07) ? rng.int(2, 3) : rng.int(0, 1),
      risky: archetype === "HIGH_RISK",
      monthlyIncome,
      knownRecipients: Array.from({ length: rng.int(2, 12) }, () => `cus_${rng.int(1, nCustomers)}`),
    });
  }
  return { customers, merchants };
}

function pickHour(rng: Rng, c: TwinCustomer, forcedNight: boolean): number {
  if (forcedNight && rng.chance(0.6)) return rng.int(0, 4);
  const jitter = Math.round(rng.gaussian(0, 2.4));
  return clamp((c.peakHour + jitter + 24) % 24, 0, 23);
}

function pickType(rng: Rng, c: TwinCustomer): string {
  if (rng.chance(0.3)) return c.primaryType;
  return rng.weighted([
    ["BUY_GOODS", 24 * (1 - c.digitalRatio) + 14], ["SEND_MONEY", 20], ["PAYBILL", 16],
    ["AIRTIME", 12 * c.digitalRatio + 4], ["RECEIVE_MONEY", 9], ["WITHDRAWAL", 9 * (1 - c.digitalRatio) + 3],
    ["DEPOSIT", 4], ["BANK_TRANSFER", 3], ["LOAN_REPAYMENT", 2], ["REVERSAL", 1],
  ] as [string, number][]);
}

function pickChannel(rng: Rng, c: TwinCustomer): string {
  const digital = rng.chance(c.digitalRatio);
  if (digital) return rng.weighted([["MPESA", 3], ["MPESA_APP", 5], ["GLOBALPAY", 1], ["BANK", 1]] as [string, number][]);
  return rng.weighted([["USSD", 4], ["AGENT", 5], ["MPESA", 2]] as [string, number][]);
}

/** Build one transaction event from the twin population. */
export function synthesiseEvent(
  rng: Rng,
  population: { customers: TwinCustomer[]; merchants: TwinMerchant[] },
  at: Date,
  opts: { fraudBias?: number; seq?: number } = {},
): TxnEvent {
  const fraudBias = opts.fraudBias ?? 1;
  const c = rng.pick(population.customers);
  const fraudulent = rng.chance(0.024 * fraudBias * (c.risky ? 8 : 1));
  const type = fraudulent ? rng.weighted([["WITHDRAWAL", 3], ["SEND_MONEY", 4], ["BANK_TRANSFER", 3], ["BUY_GOODS", 1], ["PAYBILL", 1]] as [string, number][]) : pickType(rng, c);

  let merchant: TwinMerchant | null = null;
  if (type === "BUY_GOODS" || type === "PAYBILL" || type === "LOAN_REPAYMENT") {
    const pool = population.merchants.filter((m) =>
      type === "PAYBILL" ? !!m.paybill : m.category !== "GOVERNMENT" || rng.chance(0.3),
    );
    merchant = rng.pick(pool.length ? pool : population.merchants);
  }

  const remoteCounty = fraudulent ? rng.chance(0.55) : rng.chance(0.07);
  const county = remoteCounty ? countyByName(rng.weighted(COUNTY_WEIGHTS)) : countyByName(c.county);
  const hour = pickHour(rng, c, fraudulent);

  let amount: number;
  if (fraudulent) {
    amount = Math.round(clamp(c.meanAmount * rng.float(7, 46), 25000, 690000));
  } else if (type === "AIRTIME") {
    amount = rng.pick([5, 10, 20, 50, 100, 200, 500, 1000]);
  } else if (type === "BUY_GOODS" && merchant) {
    amount = Math.round(clamp(rng.logNormal(Math.log(merchant.avgTicket), 0.5), 30, 250000));
  } else if (type === "PAYBILL" && merchant) {
    amount = Math.round(clamp(rng.logNormal(Math.log(merchant.avgTicket * 1.7), 0.6), 150, 400000));
  } else {
    amount = Math.round(clamp(rng.logNormal(Math.log(c.meanAmount), 0.55), 20, 180000));
  }

  const knownRecipient = rng.chance(fraudulent ? 0.16 : 0.78);
  const velocity = fraudulent ? (rng.chance(0.58) ? rng.int(3, 9) : rng.int(0, 2)) : rng.chance(0.045) ? rng.int(3, 5) : rng.int(0, 2);
  const failed = rng.chance(fraudulent ? 0.16 : 0.022);
  const seq = opts.seq ?? rng.int(1, 9999999);

  return {
    code: `TXN-${String(seq).padStart(7, "0")}`,
    customerId: c.id,
    customerCode: c.code,
    customerName: c.name,
    merchantId: merchant?.id ?? null,
    merchantCode: merchant?.code ?? null,
    merchantName: merchant?.name ?? null,
    recipientId: type === "SEND_MONEY" || type === "BANK_TRANSFER" || type === "REVERSAL" ? (knownRecipient ? rng.pick(c.knownRecipients) : `cus_${rng.int(1, population.customers.length)}`) : null,
    type: type as string,
    status: failed ? "FAILED" : type === "REVERSAL" ? "REVERSED" : "COMPLETED",
    channel: pickChannel(rng, c),
    amount,
    fee: type === "RECEIVE_MONEY" || type === "AIRTIME" ? 0 : fraudulent && rng.chance(0.22) ? Math.round(mpesaFee(amount) * rng.float(0.05, 0.55)) : mpesaFee(amount),
    county: county.name,
    lat: county.lat + rng.gaussian(0, 0.07),
    lon: county.lon + rng.gaussian(0, 0.07),
    category: merchant ? merchant.category : TXN_CATEGORY[type as string] ?? "GENERAL",
    occurredAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), hour, rng.int(0, 59), rng.int(0, 59))).toISOString(),
    hour,
    ctx: {
      customerMeanAmount: c.meanAmount,
      customerStdAmount: c.stdAmount,
      homeCounty: c.county,
      tenureDays: c.tenureDays,
      priorFraudRatio: c.priorFraudRatio,
      knownRecipient,
      velocity10m: velocity,
      dailyCount: Math.round(velocity + c.dailyFrequency * rng.float(0.4, 2.4)),
      merchantFraudRate: merchant?.fraudRate ?? rng.float(0, 0.01),
      deviceChanges30d: c.deviceChanges30d,
    },
    injected: fraudulent ? rng.pick(["ACCOUNT_TAKEOVER","MULE_NETWORK","SIM_SWAP","SMURFING","MERCHANT_COLLUSION","STOLEN_CREDENTIALS"]) : undefined,
  };
}

/** Generate a day's worth of twin traffic, sorted chronologically. */
export function generateDay(
  rng: Rng,
  population: { customers: TwinCustomer[]; merchants: TwinMerchant[] },
  day: Date,
  targetEvents: number,
  startSeq: number,
  fraudBias = 1,
): TxnEvent[] {
  const events: TxnEvent[] = [];
  for (let i = 0; i < targetEvents; i++) {
    events.push(synthesiseEvent(rng, population, day, { fraudBias, seq: startSeq + i }));
  }
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return events;
}

export function eventKey(e: TxnEvent): string {
  return `${hashString(e.code).toString(36)}`;
}

export const TWIN_CHANNELS = CHANNELS;
