import assert from 'node:assert/strict'
import test from 'node:test'
import { demoSubscriptions, savingsActions } from '../src/data/demoSubscriptions.js'
import { navigationMarkup } from '../src/ui/navigation.js'
import { overviewMarkup, subscriptionRow } from '../src/ui/overview.js'
import { detailMarkup } from '../src/ui/subscriptionDetail.js'
import { gmailDisclosureMarkup } from '../src/ui/gmailDisclosure.js'

const overview = overviewMarkup({ subscriptions: demoSubscriptions, actions: savingsActions, monthlySpend: 108.95 })

test('overview follows the approved information hierarchy without a Savings destination or AI card', () => {
  const labels = ['Good morning', 'Monthly recurring spend', 'Worth your attention', 'Coming up', 'Your subscriptions', 'Subscription source status']
  let previous = -1
  for (const label of labels) { const next = overview.indexOf(label); assert.ok(next > previous, `${label} is in order`); previous = next }
  const navigation = navigationMarkup('Subtle AI')
  assert.match(navigation, />Overview</)
  assert.match(navigation, />Subscriptions</)
  assert.doesNotMatch(navigation, />Savings</)
  assert.doesNotMatch(overview, /Personalized analysis|Savings feed/)
})

test('attention renders supported impact and has an honest empty state', () => {
  assert.match(overview, /Supported impact \$192\/yr/)
  const unsupported = overviewMarkup({ subscriptions: demoSubscriptions, actions: [{ ...savingsActions[0], saving: '' }], monthlySpend: 10 })
  assert.doesNotMatch(unsupported, /Supported impact/)
  const empty = overviewMarkup({ subscriptions: [], actions: [], monthlySpend: 0 })
  assert.match(empty, /Nothing needs your attention right now/)
})

test('neutral rows stay quiet while important rows expose attention', () => {
  assert.doesNotMatch(subscriptionRow(demoSubscriptions[0]), /Steady|Active|category|source/i)
  assert.match(subscriptionRow(demoSubscriptions[2]), /Possible overlap with Google One/)
})

test('detail and Gmail disclosure expose approved hierarchy, provenance and actions', () => {
  const detail = detailMarkup()
  const headings = ['What am I paying?', 'What did Subtle notice?', 'How do we know?', 'Price history', 'Billing history']
  let previous = -1
  headings.forEach(heading => { const next = detail.indexOf(heading); assert.ok(next > previous); previous = next })
  assert.match(detail, /Evidence confidence/)
  const disclosure = gmailDisclosureMarkup()
  assert.match(disclosure, /Find subscriptions from receipts/)
  assert.match(disclosure, /Continue with Gmail/)
  assert.match(disclosure, /Not now/)
})

test('mobile navigation has explicit destinations and semantic current state', () => {
  const navigation = navigationMarkup('Subtle AI')
  assert.match(navigation, /aria-controls="mobile-menu"/)
  assert.match(navigation, /aria-expanded="false"/)
  assert.match(navigation, /aria-current="page"/)
})
