import assert from 'node:assert/strict'
import test from 'node:test'
import { classifySubscriptionCandidate } from '../src/services/subscriptionClassifier.js'
import { findSubscriptionTemplate, SUBSCRIPTION_TEMPLATES } from '../src/services/subscriptionTemplates.js'

const classify = (subject, body, sender = 'billing@example.com') => classifySubscriptionCandidate({ subject, sender, body })

// ---- template matching -----------------------------------------------
test('template matching: single-purpose services match on sender domain alone', () => {
  const template = findSubscriptionTemplate('', 'billing@netflix.com')
  assert.equal(template.canonicalService, 'Netflix')
})

test('template matching: multi-product companies do not match on domain alone', () => {
  assert.equal(findSubscriptionTemplate('Your receipt', 'billing@google.com'), undefined)
  assert.equal(findSubscriptionTemplate('Your receipt', 'orders@amazon.com'), undefined)
})

test('template matching: multi-product companies match when the specific product is named', () => {
  assert.equal(findSubscriptionTemplate('Google One storage renewal', 'billing@google.com').canonicalService, 'Google One')
  assert.equal(findSubscriptionTemplate('Your Prime membership renews', 'auto-confirm@amazon.com').canonicalService, 'Amazon Prime')
})

test('catalog covers the required categories', () => {
  const names = SUBSCRIPTION_TEMPLATES.map((t) => t.canonicalService)
  for (const expected of ['Netflix', 'Spotify', 'Disney+', 'Hulu', 'Max', 'YouTube Premium', 'Apple Music', 'Dropbox', 'Google One', 'iCloud+', 'Microsoft 365', 'Adobe', 'Canva', 'NordVPN', 'ExpressVPN', 'Amazon Prime', 'Uber One']) {
    assert.ok(names.includes(expected), `missing template: ${expected}`)
  }
})

// ---- scoring thresholds -------------------------------------------------
test('scoring: known service alone (no recurrence signal) is ambiguous, not subscription', () => {
  const result = classify('Netflix', 'Your Netflix receipt.', 'billing@netflix.com')
  assert.equal(result.classification, 'ambiguous')
  assert.ok(result.score < 5)
})

test('scoring: unknown merchant needs at least two recurrence signals to qualify', () => {
  const oneSignal = classify('Membership', 'Your membership receipt.', 'billing@example.com')
  assert.equal(oneSignal.classification, 'ambiguous')

  const twoSignals = classify('Membership renewal', 'Your monthly membership renews.', 'billing@example.com')
  assert.equal(twoSignals.classification, 'subscription')
})

test('scoring: generic receipt/invoice/payment language alone is ambiguous, never subscription', () => {
  const result = classify('Payment receipt', 'Your payment was received.')
  assert.equal(result.classification, 'ambiguous')
  assert.equal(result.score, 0)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.negativeReasons, [])
})

// ---- known service + recurrence -----------------------------------------
test('accepts: Netflix membership renewal with monthly cadence', () => {
  const result = classify('Netflix renewal receipt', 'Your Netflix membership renews on Sep 12. Monthly payment $22.99.', 'billing@netflix.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Netflix')
  assert.ok(result.reasons.includes('known_subscription_service'))
})

test('accepts: Spotify subscription payment with monthly cadence', () => {
  const result = classify('Spotify receipt', 'Your Premium subscription payment has been processed. $11.99/month.', 'billing@spotify.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Spotify')
})

test('accepts: Adobe Creative Cloud annual subscription renewal', () => {
  const result = classify('Adobe receipt', 'Your Creative Cloud annual subscription renews next month.', 'billing@adobe.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Adobe')
})

test('accepts: Google One monthly membership renewal', () => {
  const result = classify('Google One payment receipt', 'Your Google One 2 TB membership renews monthly.', 'billing@google.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Google One')
})

test('accepts: Amazon Prime annual membership renewal', () => {
  const result = classify('Amazon receipt', 'Your Prime membership will renew annually.', 'auto-confirm@amazon.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Amazon Prime')
})

test('accepts: Uber One monthly membership renewal', () => {
  const result = classify('Uber receipt', 'Your Uber One membership renews monthly.', 'noreply@uber.com')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, 'Uber One')
})

// ---- unknown service + strong recurrence ---------------------------------
test('accepts: unknown/local merchant with strong recurrence language', () => {
  const result = classify('Downtown Fitness Club', 'Downtown Fitness Club — Your monthly membership renews September 1.', 'billing@downtownfitness.example')
  assert.equal(result.classification, 'subscription')
  assert.equal(result.canonicalService, null, 'not in the catalog, so no known-service credit is claimed')
})

// ---- one-time transaction rejection --------------------------------------
test('rejects: Uber ride receipt', () => {
  const result = classify('Your Uber trip receipt', 'Thanks for riding with Uber. Trip fare $18.42.', 'receipts@uber.com')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('ride_receipt'))
})

test('rejects: Lyft ride receipt', () => {
  const result = classify('Your Lyft ride receipt', 'Your Lyft ride receipt. Total $14.71.', 'no-reply@lyft.com')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('ride_receipt'))
})

test('rejects: Uber Eats food delivery order', () => {
  const result = classify('Your order from Uber Eats', 'Your food order has been delivered. Total $37.80.', 'noreply@uber.com')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('delivery_order'))
})

test('rejects: DoorDash order receipt', () => {
  const result = classify('Your order receipt', 'Your order receipt.', 'receipts@doordash.com')
  assert.equal(result.classification, 'one_time')
})

test('rejects: Amazon retail order shipped', () => {
  const result = classify('Your Amazon order has shipped', 'Your Amazon order has shipped.', 'ship-confirm@amazon.com')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('retail_purchase'))
  assert.equal(result.canonicalService, null, 'a retail shipment never matches the Prime template')
})

test('rejects: flight booking confirmation', () => {
  const result = classify('Flight booking confirmation', 'Flight booking confirmation. Total $420.', 'noreply@airline.example')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('travel_booking'))
})

test('rejects: hotel reservation receipt', () => {
  const result = classify('Your hotel reservation', 'Your hotel reservation receipt.', 'noreply@hotel.example')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('travel_booking'))
})

test('rejects: generic retail purchase', () => {
  const result = classify('Your purchase receipt', 'Thank you for your purchase. Order #12345.', 'orders@store.example')
  assert.equal(result.classification, 'one_time')
  assert.ok(result.negativeReasons.includes('retail_purchase'))
})

// ---- mixed-merchant edge cases (section 12) ------------------------------
test('mixed merchant: Google Play one-time purchase is not Google One', () => {
  const result = classify('Google Play receipt', 'Thank you for your purchase. Order #98765.', 'noreply@google.com')
  assert.notEqual(result.classification, 'subscription')
  assert.equal(result.canonicalService, null)
})

test('mixed merchant: Apple hardware/app purchase is rejected, iCloud+ renewal is accepted', () => {
  const purchase = classify('Your receipt from Apple', 'Thank you for your purchase. Order #55521.', 'no_reply@apple.com')
  assert.equal(purchase.classification, 'one_time')

  const icloud = classify('Your iCloud+ receipt', 'Your iCloud+ subscription renews monthly.', 'no_reply@apple.com')
  assert.equal(icloud.classification, 'subscription')
  assert.equal(icloud.canonicalService, 'iCloud+')
})

test('mixed merchant: Microsoft one-time purchase vs. Microsoft 365 subscription', () => {
  const purchase = classify('Your Microsoft Store receipt', 'Thank you for your purchase. Order #77812.', 'no-reply@microsoft.com')
  assert.notEqual(purchase.classification, 'subscription')

  const m365 = classify('Your Microsoft 365 receipt', 'Your Microsoft 365 subscription renews annually.', 'no-reply@microsoft.com')
  assert.equal(m365.classification, 'subscription')
  assert.equal(m365.canonicalService, 'Microsoft 365')
})

test('mixed merchant: Amazon retail order vs. Amazon Prime renewal', () => {
  const order = classify('Your Amazon order has shipped', 'Your Amazon order has shipped.', 'ship-confirm@amazon.com')
  assert.equal(order.classification, 'one_time')

  const prime = classify('Your Amazon Prime receipt', 'Your Prime membership will renew annually.', 'auto-confirm@amazon.com')
  assert.equal(prime.classification, 'subscription')
})

// ---- ambiguous (section 11) ----------------------------------------------
test('ambiguous: generic payment receipt from an unknown merchant', () => {
  const result = classify('Payment receipt from Example Corp', 'Payment receipt from Example Corp — $19.99')
  assert.equal(result.classification, 'ambiguous')
})

test('ambiguous: generic invoice-paid notice', () => {
  const result = classify('Invoice paid', 'Invoice paid — Example Service')
  assert.equal(result.classification, 'ambiguous')
})

test('ambiguous: bare thank-you-for-your-payment notice', () => {
  const result = classify('Payment confirmation', 'Thank you for your payment')
  assert.equal(result.classification, 'ambiguous')
})

test('ambiguous: known merchant with no recurrence evidence at all', () => {
  const result = classify('Google payment receipt', 'Google payment receipt — $9.99', 'billing@google.com')
  assert.equal(result.classification, 'ambiguous')
  assert.equal(result.canonicalService, null)
})
