import { Rng, countyByName, COUNTY_WEIGHTS, TXN_CATEGORY, TXN_TYPES, clamp } from "./core";
import { mpesaFee, type TxnEvent, type FraudBundle } from "./ml/fraud";
import { ingestEvent, type StreamEvent } from "./stream";

/* ------------------------------------------------------------------ *
 * API-event ingestion adapter. Accepts the public M-PESA-shaped event
 * contract (snake_case), normalises it into the internal TxnEvent,
 * enriches it with a behavioural snapshot from the feature store, and
 * publishes it onto the bronze topic.
 * ------------------------------------------------------------------ */

export type PublicEvent = {
  transaction_id?: string;
  customer_id?: string;
  transaction_type?: string;
  amount?: number;
  merchant_id?: string;
  location?: string;
  timestamp?: string;
  channel?: string;
  fee?: number;
  status?: string;
  recipient_id?: string;
};

export function toTxnEvent(payload: Record<string, unknown>, rng = new Rng(Date.now() % 100000)): TxnEvent {
  const p = payload as unknown as PublicEvent;
  const county = countyByName(
    (COUNTY_WEIGHTS.some(([n]) => n.toLowerCase() === String(p.location ?? "").toLowerCase())
      ? String(p.location)
      : rng.weighted(COUNTY_WEIGHTS)) as string,
  );
  const type = (TXN_TYPES as readonly string[]).includes(String(p.transaction_type ?? "").toUpperCase())
    ? String(p.transaction_type).toUpperCase()
    : "SEND_MONEY";
  const at = p.timestamp ? new Date(p.timestamp) : new Date();
  const amount = clamp(Math.round(Number(p.amount ?? rng.int(100, 40000))), 1, 2_000_000);
  const customerCode = String(p.customer_id ?? `CUS-${rng.int(10000, 12399)}`);
  const mean = clamp(Math.round(rng.logNormal(7.6, 0.8)), 400, 60000);
  return {
    code: String(p.transaction_id ?? `TXN-${rng.int(1000000, 9999999)}`),
    customerId: `cus_${Math.abs(hashCode(customerCode)) % 2400 || 1}`,
    customerCode,
    customerName: "API SUBMITTED",
    merchantId: p.merchant_id ? `mer_${Math.abs(hashCode(String(p.merchant_id))) % 320 || 1}` : null,
    merchantCode: p.merchant_id ? String(p.merchant_id) : null,
    merchantName: p.merchant_id ? `MERCHANT ${p.merchant_id}` : null,
    recipientId: p.recipient_id ? String(p.recipient_id) : null,
    type,
    status: (p.status ?? "COMPLETED").toUpperCase(),
    channel: String(p.channel ?? "MPESA").toUpperCase(),
    amount,
    fee: p.fee !== undefined ? Math.round(Number(p.fee)) : mpesaFee(amount),
    county: county.name,
    lat: county.lat + rng.gaussian(0, 0.07),
    lon: county.lon + rng.gaussian(0, 0.07),
    category: TXN_CATEGORY[type] ?? "GENERAL",
    occurredAt: at.toISOString(),
    hour: at.getUTCHours(),
    ctx: {
      customerMeanAmount: mean,
      customerStdAmount: Math.round(mean * 0.7),
      homeCounty: county.name,
      tenureDays: rng.int(30, 2400),
      priorFraudRatio: rng.float(0, 0.05),
      knownRecipient: rng.chance(0.6),
      velocity10m: rng.chance(0.08) ? rng.int(3, 7) : rng.int(0, 2),
      dailyCount: rng.int(1, 8),
      merchantFraudRate: rng.float(0, 0.05),
      deviceChanges30d: rng.int(0, 3),
    },
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export async function publishExternal(payload: Record<string, unknown>, bundle: FraudBundle): Promise<StreamEvent> {
  const event = toTxnEvent(payload);
  return ingestEvent(event, bundle);
}
