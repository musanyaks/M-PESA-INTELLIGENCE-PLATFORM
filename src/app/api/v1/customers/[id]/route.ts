import { api, envelope, errorResponse, maskCustomer } from "@/lib/api";
import { getCustomer360 } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ params, session }) => {
    await ensureReady();
    const detail = await getCustomer360(params.id);
    if (!detail) return errorResponse(404, "not_found", `No customer matches '${params.id}'.`);
    const { customer, series, types, merchantsUsed, recurring, riskHistory, recent, segment, peer } = detail;
    return envelope({
      customer_360: {
        id: customer.code,
        name: maskCustomer({ name: customer.name }, session).name,
        msisdn: maskCustomer({ msisdn: customer.msisdn }, session).msisdn,
        county: customer.county,
        kyc_tier: customer.kycTier,
        tenure_days: customer.tenureDays,
        status: customer.status,
        monthly_transactions: customer.txn30d,
        monthly_value: customer.value30d,
        average_transaction: customer.avgTicket,
        top_category: customer.topCategory,
        peak_transaction_time: customer.peakWindow,
        risk_score: customer.riskScore,
        segment: segment ? { id: segment.code, name: segment.name, description: segment.description, colour: segment.colour } : null,
        cash_flow: {
          monthly_income: customer.monthlyIncome,
          monthly_expenses: customer.monthlyExpenses,
          net: customer.monthlyIncome - customer.monthlyExpenses,
          savings_rate: Number(customer.savingsRate.toFixed(2)),
          burn_rate: customer.burnRate,
          lifetime_value: customer.lifetimeValue,
        },
        predictions: {
          churn_probability: Number(customer.churnProbability.toFixed(4)),
          next_transaction_type: customer.predictedNextType,
          next_transaction_window: customer.predictedNextWindow,
          expected_next_month_spend: customer.expectedMonthlySpend,
          will_transact_tomorrow: customer.churnProbability < 0.35 && customer.txn30d >= 12,
        },
        digital_ratio: Number(customer.digitalRatio.toFixed(3)),
      },
      peer_benchmark: peer
        ? { cohort_size: Number(peer.n), avg_value: Number(peer.avg_value), avg_transactions: Number(peer.avg_txn), avg_risk: Number(peer.avg_risk) }
        : null,
      activity_series: series.map((s) => ({ day: s.day, count: Number(s.count), value: Number(s.value), inflow: Number(s.inflow), outflow: Number(s.outflow) })),
      transaction_mix: types.map((t) => ({ type: t.type, count: Number(t.count), value: Number(t.value) })),
      top_merchants: merchantsUsed.map((m) => ({ merchant: m.name, category: m.category, count: Number(m.count), value: Number(m.value) })),
      recurring_payments: recurring.map((r) => ({ merchant: r.name, category: r.category, occurrences: Number(r.count), average_amount: Number(r.avg_amount), total: Number(r.total) })),
      risk_distribution: riskHistory.map((r) => ({ level: r.level, count: Number(r.count) })),
      recent_transactions: recent.map((r) => ({
        transaction_id: r.code, type: r.type, amount: r.amount, fee: r.fee, status: r.status,
        channel: r.channel, location: r.county, merchant: r.merchantName, risk_score: r.riskScore,
        risk_level: r.riskLevel, reasons: r.reasons, timestamp: r.occurredAt,
      })),
    });
  },
  { audit: "api.customers.detail" },
);
