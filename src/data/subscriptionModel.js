import { createSubscriptionRecord, parseReceipt } from '../services/receiptPipeline.js'

const money = (value) => `$${value.toFixed(2)}`

export const monthlySpendFor = (subscriptions = []) => subscriptions.reduce(
  (sum, item) => sum + (Number.isFinite(item.cost) && ['monthly', 'yearly'].includes(item.cadence)
    ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost)
    : 0),
  0,
)

export const createPipelineRecords = (subscriptions = []) => subscriptions.map((item) => {
  const evidence = parseReceipt({
    id: `demo-${item.id}`,
    subject: `${item.name} ${item.plan} receipt`,
    sender: `${item.name.toLowerCase()}@receipts.example`,
    receivedAt: item.confirmed,
    body: `${item.name} subscription payment ${money(item.cost)} ${item.cadence}`,
  })
  return createSubscriptionRecord(evidence, {
    id: String(item.id),
    plan: item.plan,
    currentPrice: item.cost,
    billingCycle: item.cadence,
    nextRenewal: item.next,
    category: item.category,
  })
})