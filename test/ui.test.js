import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { demoSubscriptions } from '../src/data/demoSubscriptions.js'
import { currentRoute, routePath } from '../src/ui/router.js'
import { navigationMarkup } from '../src/ui/navigation.js'
import { overviewMarkup } from '../src/ui/overview.js'
import { subscriptionRow, subscriptionsPageMarkup } from '../src/ui/subscriptions.js'
import { actionCard, attentionPageMarkup, candidateRow } from '../src/ui/attention.js'
import { sourcesPageMarkup } from '../src/ui/sources.js'
import { settingsPageMarkup } from '../src/ui/settings.js'
import { correctionDialogMarkup, detailMarkup, fieldProvenance, rejectConfirmMarkup } from '../src/ui/subscriptionDetail.js'
import { gmailDisclosureMarkup } from '../src/ui/gmailDisclosure.js'
import { FALLBACK_SERVICE_ICON, serviceIconFor, serviceIconMarkup } from '../src/services/serviceIcons.js'

const candidate = { id: 'cand-1', canonicalService: 'Amazon', rawMerchant: 'AMZN Mktp', evidence: [{ amount: 9.99, currency: 'USD', cadence: 'monthly' }] }

// ---- Router: a real destination per sidebar item, not anchors into one page.
test('router maps every sidebar destination to its own path, round-trips through currentRoute, and falls back safely', () => {
  assert.equal(routePath('overview'), '/overview')
  assert.equal(routePath('subscriptions'), '/subscriptions')
  assert.equal(routePath('attention'), '/attention')
  assert.equal(routePath('sources'), '/sources')
  assert.equal(routePath('settings'), '/settings')
  assert.equal(routePath('subscription-detail', { id: 'abc 123' }), '/subscriptions/abc%20123')

  assert.deepEqual(currentRoute('#/subscriptions/abc%20123'), { name: 'subscription-detail', params: { id: 'abc 123' } })
  assert.deepEqual(currentRoute('#/subscriptions'), { name: 'subscriptions', params: {} })
  assert.deepEqual(currentRoute('#/attention'), { name: 'attention', params: {} })
  assert.deepEqual(currentRoute('#/sources'), { name: 'sources', params: {} })
  assert.deepEqual(currentRoute('#/settings'), { name: 'settings', params: {} })
  // Empty hash, an unrecognized path, and a hard refresh with no hash at all
  // must never break navigation - they all resolve to Overview, never a blank page.
  assert.deepEqual(currentRoute(''), { name: 'overview', params: {} })
  assert.deepEqual(currentRoute('#/nonsense'), { name: 'overview', params: {} })
})

// ---- Sidebar: real route links, not a table of contents for one long page.
test('the sidebar is real route links with distinct destinations, correct active state, and a live attention badge', () => {
  const nav = navigationMarkup('Subtle AI', { activeRoute: 'overview', attentionCount: 3 })
  for (const path of ['/overview', '/subscriptions', '/attention', '/sources', '/settings']) {
    assert.match(nav, new RegExp(`href="#${path.replace('+', '\\+')}"`), `missing a real link to ${path}`)
  }
  assert.match(nav, />Overview</)
  assert.match(nav, />Subscriptions</)
  assert.match(nav, />Worth your attention</)
  assert.match(nav, />Sources</)
  assert.match(nav, />Settings</)
  // Exactly the Overview link is marked current when activeRoute is overview.
  const overviewLinkIndex = nav.indexOf('data-route-link="overview"')
  const currentIndex = nav.indexOf('aria-current="page"')
  assert.ok(currentIndex > -1 && Math.abs(currentIndex - overviewLinkIndex) < 60, 'aria-current should sit on the Overview link')
  assert.match(nav, /nav-badge">3</)

  // A subscription-detail route (no sidebar entry of its own) highlights Subscriptions.
  const onDetail = navigationMarkup('Subtle AI', { activeRoute: 'subscription-detail' })
  const subsLinkStart = onDetail.indexOf('data-route-link="subscriptions"')
  const subsLinkEnd = onDetail.indexOf('</a>', subsLinkStart)
  assert.match(onDetail.slice(subsLinkStart, subsLinkEnd), /aria-current="page"/)

  // No badge at all when there is nothing to review.
  assert.doesNotMatch(navigationMarkup('Subtle AI', { activeRoute: 'overview', attentionCount: 0 }), /nav-badge/)

  // Mobile: a real, discoverable replacement for the desktop links, not a
  // second copy of the whole page.
  assert.match(nav, /aria-controls="mobile-menu"/)
  assert.match(nav, /aria-expanded="false"/)
  assert.match(readFileSync(new URL('../src/ui/navigation.js', import.meta.url), 'utf8'), /focusout/)
})

// ---- Overview: orientation only - a preview, not the whole application.
test('Overview shows previews and links onward, and never contains full management UI', () => {
  const items = demoSubscriptions.slice(0, 8)
  const overview = overviewMarkup({ subscriptions: items, actions: [], monthlySpend: 108.95, candidates: [candidate], greeting: 'Good morning.', gmailSource: { status: 'connected', lastScanAt: null } })

  // Required hierarchy: greeting -> summary cards -> subscriptions preview -> attention preview.
  const order = ['Good morning', 'Monthly recurring spend', 'Annual spend', 'Active subscriptions', 'Worth your attention', 'Your subscriptions']
  let previous = -1
  for (const label of order) { const next = overview.indexOf(label); assert.ok(next > previous, `${label} is in order`); previous = next }

  // Preview, not the full list: only a bounded number of rows render even
  // though 8 subscriptions were passed in, and a "View all" link hands off
  // to the dedicated Subscriptions destination.
  const rowCount = (overview.match(/subscription-row/g) || []).length
  assert.ok(rowCount > 0 && rowCount < items.length, 'Overview previews a subset, not every subscription')
  assert.match(overview, /href="#\/subscriptions">View all subscriptions/)
  assert.match(overview, /href="#\/attention">View all/)

  // Management (Gmail connect/scan/disconnect, candidate Confirm/Reject,
  // account settings) must live on their own pages, never on Overview.
  assert.doesNotMatch(overview, /data-gmail-action|data-gmail-disconnect|data-confirm-candidate|data-reject-candidate|data-sign-out/)
  assert.match(overview, /href="#\/sources">Manage sources/)

  const empty = overviewMarkup({ subscriptions: [], actions: [], monthlySpend: 0, candidates: [] })
  assert.match(empty, /No subscriptions yet\. Connect Gmail or add one manually\./)
  assert.match(empty, /Nothing needs your attention right now\./)
})

// ---- Subscriptions: the full list, each row a real link to its own detail route.
test('the Subscriptions page lists every subscription as a link to its own Subscription Detail route', () => {
  const items = demoSubscriptions
  const page = subscriptionsPageMarkup({ subscriptions: items })
  const rowCount = (page.match(/class="subscription-row/g) || []).length
  assert.equal(rowCount, items.length, 'the full list renders every subscription, unlike the Overview preview')
  const row = subscriptionRow(items[0])
  assert.match(row, /<a class="subscription-row/)
  assert.match(row, new RegExp(`href="#/subscriptions/${items[0].id}"`))
  assert.doesNotMatch(subscriptionRow(items[0]), /Steady|Active|category|source/i, 'a neutral row stays quiet - no redundant status/category noise')
})

// ---- Worth your attention: its own destination, not a dashboard widget -
// and it includes ambiguous-candidate review (FEATURE-002), visually distinct
// from a confirmed subscription.
test('Worth your attention is a dedicated page combining real signals and ambiguous-candidate review', () => {
  const action = { id: 'price', label: 'Price increase detected', affectedServices: ['Canva Pro'], body: '$14.99 -> $17.99/month.', saving: '+$36/year', impactLabel: 'Yearly impact' }
  const page = attentionPageMarkup({ actions: [action], candidates: [candidate] })
  assert.match(page, /Worth your attention/)
  assert.match(page, /Needs your review/)
  assert.match(page, /Items Subtle AI is unsure about won't affect your totals until you decide\./)

  const row = candidateRow(candidate)
  assert.match(row, /data-confirm-candidate/)
  assert.match(row, /data-reject-candidate/)
  assert.match(row, /Uncertain/)
  assert.doesNotMatch(row, /subscription-row/, 'a candidate never renders as a confirmed subscription row')
  assert.match(actionCard(action), /Review subscription/)

  const empty = attentionPageMarkup({ actions: [], candidates: [] })
  assert.match(empty, /Nothing needs your attention right now\./)
  assert.match(empty, /Nothing to review right now\./)
})

// ---- Sources: the one place Gmail is actually managed.
test('Sources is a dedicated page carrying the real Gmail connect/scan/disconnect controls', () => {
  const page = sourcesPageMarkup()
  assert.match(page, /data-gmail-action="connect"/)
  assert.match(page, /data-gmail-disconnect/)
  assert.match(page, /data-discovery-result/)
  assert.match(page, /Your data is private and secure/)
})

// ---- Settings: sparse and real, not padded with invented features.
test('Settings is intentionally sparse: only real, currently-supported controls', () => {
  const page = settingsPageMarkup({ user: { name: 'Jun Park', email: 'jun@example.com' } })
  assert.match(page, /Jun Park/)
  assert.match(page, /jun@example\.com/)
  assert.match(page, /data-sign-out/)
  assert.match(page, /href="#\/sources"/)
})

// ---- Subscription Detail: full page, matching the approved hierarchy.
test('Subscription Detail follows the approved hierarchy and exposes FEATURE-002 entry points', () => {
  const detail = detailMarkup()
  assert.match(detail, /Back to Subscriptions/)
  const order = ['Back to Subscriptions', 'detail-title', 'Information source', 'Price history', 'Billing history', 'This looks wrong', 'Not a subscription']
  let previous = -1
  for (const label of order) { const next = detail.indexOf(label); assert.ok(next > previous, `${label} is in order`); previous = next }
  assert.match(detail, /data-detail-status/)
  assert.match(detail, /data-toggle-correction/)
  assert.match(detail, /data-open-reject/)

  const correction = correctionDialogMarkup()
  assert.match(correction, /We'll keep the original receipt evidence so you can always see where this came from\./)
  assert.match(correction, /Cancel/)
  assert.match(correction, /Save changes/)

  const reject = rejectConfirmMarkup()
  assert.match(reject, /Not a subscription\?/)
  assert.match(reject, /It won't appear in your active subscriptions/)
  assert.match(reject, /It won't be counted in recurring spend/)
  assert.match(reject, /We'll remember your decision/)
  assert.match(reject, /Mark as not a subscription/)
  assert.match(reject, /Cancel/)

  assert.equal(fieldProvenance({ source: 'Gmail receipt', pipelineRecord: { confidence: { state: 'inferred' } } }, 'amount'), 'Inferred from Gmail receipt')
  assert.equal(fieldProvenance({ source: 'Gmail receipt', pipelineRecord: { fieldObservations: [{ field: 'amount', provenance: 'confirmed' }] } }, 'amount'), 'Confirmed from Gmail receipt')
  assert.equal(fieldProvenance({ source: 'Manual entry' }, 'amount'), 'User provided')

  const disclosure = gmailDisclosureMarkup()
  assert.match(disclosure, /Find subscriptions from receipts/)
  assert.match(disclosure, /Continue with Gmail/)
  assert.match(disclosure, /Not now/)
})

// ---- Service icons: recognizable identity per canonical service, never a
// wrong or invented logo for an unmapped merchant.
test('known canonical services get a distinct icon; unmapped merchants get the neutral fallback, never a guess', () => {
  assert.notEqual(serviceIconFor('Netflix'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Spotify'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Dropbox'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Canva'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('NordVPN'), FALLBACK_SERVICE_ICON)
  assert.equal(serviceIconFor('Some Unmapped Merchant LLC'), FALLBACK_SERVICE_ICON)
  assert.equal(serviceIconFor(''), FALLBACK_SERVICE_ICON)
  assert.equal(serviceIconFor(undefined), FALLBACK_SERVICE_ICON)

  const netflix = serviceIconMarkup('Netflix')
  assert.match(netflix, /Netflix logo/)
  const unknown = serviceIconMarkup('Totally Unknown Co')
  assert.match(unknown, /aria-label="Totally Unknown Co logo"/)
  // The service name always stays visible as real text elsewhere (the row
  // markup, not the icon) - the icon itself never substitutes for the name.
})

// ---- Branding: "Subtle AI" everywhere, never bare "Subtle".
test('the product is branded "Subtle AI" throughout, not "Subtle"', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /name:\s*'Subtle AI'/)
  assert.match(main, /brand-name">\$\{APP_CONFIG\.name\}/)
  assert.match(main, /document\.title = APP_CONFIG\.name/)
})

// ---- Preserved FEATURE-001/002 wiring in main.js (manual add, spend calc, OAuth redirect discipline).
test('manual add, spend calculation, and the OAuth redirect contract are preserved', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /name="cost"/)
  assert.match(main, /name="cadence"/)
  assert.match(main, /manualSubscriptions\.push\(/)
  assert.match(main, /monthlySpendFor\(items\)/)
  assert.match(main, /startGoogleSignIn\(\)[\s\S]{0,80}url/)
  assert.match(main, /authorizeGmail\(\)[\s\S]{0,80}url/)
  assert.doesNotMatch(main, /client_id|scope=/i)
})

test('the service worker treats /api/** as network-only and never caches authenticated API responses', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/)
  const apiBranchIndex = sw.indexOf("pathname.startsWith('/api/')")
  const cachePutIndex = sw.indexOf('cache.put')
  assert.ok(apiBranchIndex > -1 && cachePutIndex > apiBranchIndex, 'the /api/ branch must be checked, and return, before any cache.put call')
})
