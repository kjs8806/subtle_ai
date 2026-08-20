import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { demoSubscriptions, savingsActions } from '../src/data/demoSubscriptions.js'
import { navigationMarkup } from '../src/ui/navigation.js'
import { overviewMarkup, subscriptionRow } from '../src/ui/overview.js'
import { detailMarkup, fieldProvenance } from '../src/ui/subscriptionDetail.js'
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

test('attention renders data-backed savings and has an honest empty state', () => {
  assert.match(overview, /Potential savings<\/span><strong>\$191\.88\/year/)
  assert.match(overview, /Potential savings<\/b><strong>\$15\.99\/month/)
  assert.doesNotMatch(overview, /4\.8%|\$64\/month|Supported impact/)
  assert.match(overview, /Dropbox \+ Google One/)
  const unsupported = overviewMarkup({ subscriptions: demoSubscriptions, actions: [{ ...savingsActions[0], saving: '' }], monthlySpend: 10 })
  assert.doesNotMatch(unsupported, /class="impact"/)
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
  assert.equal(fieldProvenance({ source: 'Gmail receipt', pipelineRecord: { confidence: { state: 'inferred' } } }, 'amount'), 'Inferred from Gmail receipt')
  assert.equal(fieldProvenance({ source: 'Gmail receipt', pipelineRecord: { fieldObservations: [{ field: 'amount', provenance: 'confirmed' }] } }, 'amount'), 'Confirmed from Gmail receipt')
  assert.equal(fieldProvenance({ source: 'Manual entry' }, 'amount'), 'User provided')
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
  assert.match(readFileSync(new URL('../src/ui/navigation.js', import.meta.url), 'utf8'), /focusout/)
})

test('manual add retains cost and cadence and updates the real overview state', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /name="cost"/)
  assert.match(main, /name="cadence"/)
  assert.match(main, /subscriptions\.push\(item\)/)
  assert.match(main, /monthlySpendFor\(subscriptions\)/)
  assert.match(main, /data-count/)
  assert.doesNotMatch(main, /ready to be added/)
})
