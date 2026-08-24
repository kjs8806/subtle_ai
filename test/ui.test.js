import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { demoSubscriptions } from '../src/data/demoSubscriptions.js'
import { currentRoute, routePath } from '../src/ui/router.js'
import { navigationMarkup } from '../src/ui/navigation.js'
import { overviewMarkup } from '../src/ui/overview.js'
import { filterAndSortSubscriptions, subscriptionRow, subscriptionsPageMarkup, subscriptionTableRow } from '../src/ui/subscriptions.js'
import { attentionCardMarkup, attentionDetailMarkup, attentionPageMarkup, candidateRow, countsByFilter, filterAttentionItems, overlapCardMarkup, severityBadgeMarkup, sortAttentionItems } from '../src/ui/attention.js'
import { sourcesPageMarkup } from '../src/ui/sources.js'
import { settingsPageMarkup } from '../src/ui/settings.js'
import { correctionDialogMarkup, detailMarkup, fieldProvenance, rejectConfirmMarkup, renewalLabel } from '../src/ui/subscriptionDetail.js'
import { gmailDisclosureMarkup } from '../src/ui/gmailDisclosure.js'
import { signedOutMarkup } from '../src/ui/signedOut.js'
import { FALLBACK_SERVICE_ICON, SERVICE_ICONS, serviceIconFor, serviceIconMarkup } from '../src/services/serviceIcons.js'

const candidate = { id: 'cand-1', canonicalService: 'Amazon', rawMerchant: 'AMZN Mktp', evidence: [{ amount: 9.99, currency: 'USD', cadence: 'monthly' }] }
// FEATURE-003 attention-item fixtures (src/services/attentionItemBuilder.js's output shape).
const needsReviewAttentionItem = { id: 'needs-review:cand-1', type: 'needs_review', subscriptionId: null, candidateId: 'cand-1', canonicalService: 'Amazon', plan: null, priority: 'low', sortRank: 3, ruleVersion: 1 }
const priceChangeAttentionItem = {
  id: 'price-change:sub-1:14.99:17.99:USD', type: 'price_change', subscriptionId: 'sub-1', candidateId: null,
  canonicalService: 'Canva Pro', plan: 'Pro', priority: 'medium', sortRank: 1, ruleVersion: 1,
  priceChange: { changeType: 'increase', currency: 'USD', cadence: 'monthly', previousPrice: 14.99, currentPrice: 17.99, perPeriodDelta: 3, percentChange: 20.01, annualImpact: 36, firstSeenAt: '2026-08-12T00:00:00.000Z', isAttentionWorthy: true },
}
const renewalAttentionItem = {
  id: 'renewal:sub-2:2026-08-29', type: 'renewal', subscriptionId: 'sub-2', candidateId: null,
  canonicalService: 'Spotify', plan: 'Premium Individual', priority: 'high', sortRank: 0, ruleVersion: 1,
  renewal: { certainty: 'confirmed', date: '2026-08-29', timing: 'soon', daysUntil: 6 },
}

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
  const overview = overviewMarkup({ subscriptions: items, attentionItems: [priceChangeAttentionItem, needsReviewAttentionItem], overlapActions: [], monthlySpend: 108.95, greeting: 'Good morning.', gmailSource: { status: 'connected', lastScanAt: null } })

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

  const empty = overviewMarkup({ subscriptions: [], attentionItems: [], overlapActions: [], monthlySpend: 0 })
  assert.match(empty, /No subscriptions yet\. Connect Gmail or add one manually\./)
  assert.match(empty, /Nothing needs your attention right now\./)
})

// ---- Subscriptions: the full list, each row a real link to its own detail route.
test('the Subscriptions page renders search/filter/sort controls and a table shell; rows come from subscriptionTableRow', () => {
  const items = demoSubscriptions
  const page = subscriptionsPageMarkup({ subscriptions: items })
  // The static shell has the toolbar and an empty rows container - actual
  // rows are rendered client-side (wireSubscriptionsPage in main.js) so
  // search/sort/filter can re-render just the list without losing focus in
  // the search field.
  assert.match(page, /data-subscription-search/)
  assert.match(page, /data-open-filter/)
  assert.match(page, /data-subscription-sort/)
  assert.match(page, /data-subscription-rows/)
  assert.match(page, /data-subscription-table-head/)
  assert.match(page, />Subscription<\/span><span>Price<\/span><span>Billing<\/span><span>Next renewal<\/span><span>Status</)
  assert.match(page, new RegExp(`${items.filter(item => (item.status || 'active') === 'active').length} active`))

  const row = subscriptionTableRow(items[0])
  assert.match(row, /<a class="subscription-table-row"/)
  assert.match(row, new RegExp(`href="#/subscriptions/${items[0].id}"`))
  assert.match(row, /class="status-pill">ACTIVE</)

  const compactRow = subscriptionRow(items[0])
  assert.match(compactRow, /<a class="subscription-row/)
  assert.doesNotMatch(compactRow, /Steady|Active|category|source/i, 'the compact Overview-preview row stays quiet - no redundant status/category noise')
})

// ---- Subscriptions: pure search/filter/sort so it's testable without a DOM.
test('filterAndSortSubscriptions searches by name/plan, filters by billing cadence, and sorts without fabricating data', () => {
  const netflix = { id: 'a', name: 'Netflix', plan: 'Premium Plan', cost: 22.99, cadence: 'monthly', next: 'Sep 12, 2026' }
  const nordvpn = { id: 'b', name: 'NordVPN', plan: '2-Year Plan', cost: 99.48, cadence: 'yearly', next: 'Nov 15, 2026' }
  const spotify = { id: 'c', name: 'Spotify', plan: 'Premium Individual', cost: 10.99, cadence: 'monthly', next: 'Sep 24, 2026' }
  const all = [netflix, nordvpn, spotify]

  assert.deepEqual(filterAndSortSubscriptions(all, { query: 'netflix' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAndSortSubscriptions(all, { query: 'premium' }).map(item => item.id).sort(), ['a', 'c'])
  assert.deepEqual(filterAndSortSubscriptions(all, { cadence: 'yearly' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAndSortSubscriptions(all, { sort: 'next-renewal' }).map(item => item.id), ['a', 'c', 'b'])
  assert.deepEqual(filterAndSortSubscriptions(all, { sort: 'name' }).map(item => item.id), ['a', 'b', 'c'])
  // Highest monthly-equivalent cost first: NordVPN's $99.48/2yr (~$4.15/mo)
  // ranks below Netflix and Spotify once annualized-to-monthly, not above
  // them by its sticker price alone.
  assert.deepEqual(filterAndSortSubscriptions(all, { sort: 'price-desc' }).map(item => item.id), ['a', 'c', 'b'])
})

// ---- Worth your attention: its own destination, not a dashboard widget -
// and it includes ambiguous-candidate review (FEATURE-002), visually distinct
// from a confirmed subscription.
test('Worth your attention (FEATURE-003) is a dedicated page unifying price changes, renewals, and ambiguous-candidate review, prioritized and filterable', () => {
  const items = [renewalAttentionItem, priceChangeAttentionItem, needsReviewAttentionItem]
  const page = attentionPageMarkup({ items })
  assert.match(page, /Worth your attention/)
  assert.match(page, /You're in control/)
  // Filter tabs, one per attention type plus All, each carrying its own count.
  for (const label of ['All', 'Price changes', 'Renewals', 'Needs review']) assert.match(page, new RegExp(label))
  assert.match(page, /data-attention-sort/)

  assert.deepEqual(countsByFilter(items), { all: 3, price_change: 1, renewal: 1, needs_review: 1 })
  assert.deepEqual(filterAttentionItems(items, 'renewal').map(item => item.id), [renewalAttentionItem.id])
  assert.deepEqual(filterAttentionItems(items, 'all'), items)
  // Server-provided priority order (renewal soon first) by default; name sort is the only client-side alternative.
  assert.deepEqual(sortAttentionItems(items, 'priority').map(item => item.id), [renewalAttentionItem.id, priceChangeAttentionItem.id, needsReviewAttentionItem.id])
  assert.deepEqual(sortAttentionItems(items, 'name').map(item => item.canonicalService), ['Amazon', 'Canva Pro', 'Spotify'])

  // Each card carries a severity badge - a visual aid, not a scoring engine
  // (Product Owner note, GitHub issue #22) - and opens the detail dialog.
  const priceCard = attentionCardMarkup(priceChangeAttentionItem)
  assert.match(priceCard, /data-attention-id="price-change:sub-1:14\.99:17\.99:USD"/)
  assert.match(priceCard, /severity-medium/)
  assert.match(priceCard, /USD 14\.99 → USD 17\.99\/mo/)
  const renewalCard = attentionCardMarkup(renewalAttentionItem)
  assert.match(renewalCard, /severity-high/)
  assert.match(renewalCard, /Next renewal/)

  const row = candidateRow(candidate)
  assert.match(row, /data-confirm-candidate/)
  assert.match(row, /data-reject-candidate/)
  assert.match(row, /Uncertain/)
  assert.doesNotMatch(row, /subscription-row/, 'a candidate never renders as a confirmed subscription row')

  // Legacy overlap-detection cards (unrelated to FEATURE-003) still render,
  // with a real "Review subscription" link to the affected subscription and
  // a "Keep both" button that dismisses the card (both were previously dead
  // controls with no handler at all).
  const overlapAction = { id: 'overlap-1', subscriptionId: 'sub-dropbox', label: 'Potential overlap', affectedServices: ['Dropbox', 'Google One'], body: 'Both provide cloud storage.', saving: '$120.00/year', impactLabel: 'Potential savings', secondary: 'Keep both' }
  const overlapCard = overlapCardMarkup(overlapAction)
  assert.match(overlapCard, new RegExp(`<a class="primary-button" href="#${routePath('subscription-detail', { id: 'sub-dropbox' }).replace(/\//g, '\\/')}">Review subscription</a>`))
  assert.match(overlapCard, /data-dismiss-overlap="overlap-1"/)
  assert.match(attentionPageMarkup({ items: [], overlapActions: [overlapAction] }), /Other suggestions/)

  const empty = attentionPageMarkup({ items: [], overlapActions: [] })
  assert.match(empty, /You're all caught up/)
})

test('attentionDetailMarkup shows an impact breakdown for a price change and only "Review subscription"/"Dismiss this item" as actions - never the unauthorized Compare alternatives or Cancel subscription', () => {
  const body = attentionDetailMarkup(priceChangeAttentionItem)
  assert.match(body, /USD 14\.99/)
  assert.match(body, /USD 17\.99/)
  assert.match(body, /\+USD 36\.00\/yr/)
  assert.match(body, /Review subscription/)
  assert.match(body, /Dismiss this item/)
  assert.doesNotMatch(body, /Compare alternatives/)
  assert.doesNotMatch(body, /Cancel subscription/)
  assert.match(body, new RegExp(`href="#${routePath('subscription-detail', { id: priceChangeAttentionItem.subscriptionId }).replace(/\//g, '\\/')}"`))

  const renewalBody = attentionDetailMarkup(renewalAttentionItem)
  assert.match(renewalBody, /Confirmed/)
  assert.match(severityBadgeMarkup('high'), /High/)
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

  // Primary facts area: billing cadence, (expected/next) renewal, annualized
  // cost, and status - no per-field "Confirmed from Gmail receipt" provenance
  // text repeated under any of them (that lives in Information source now),
  // and "Current cost" is never repeated here since price is already
  // prominent right above under the service name.
  assert.match(detail, /class="meta-rows"/)
  assert.match(detail, /data-detail-next-label/)
  assert.doesNotMatch(detail, /data-cost-source|data-cadence-source|data-renewal-source/, 'per-field provenance text no longer lives in the primary facts area')
  const metaRowsSection = detail.slice(detail.indexOf('class="meta-rows"'), detail.indexOf('</header>'))
  assert.doesNotMatch(metaRowsSection, /Current cost/)

  // Information source keeps only the record-level provenance (when it was
  // last confirmed, how confident the evidence is) - field-level provenance
  // for corrected fields still comes through the evidence list itself
  // ("You updated price ... Confirmed by you").
  assert.match(detail, /<dt>Last confirmed<\/dt><dd data-confirmed>/)
  assert.match(detail, /<dt>Evidence confidence<\/dt><dd data-confidence>/)

  // FEATURE-002 correction: one unified form with every supported field,
  // not a "pick one field, then a value" workflow.
  const correction = correctionDialogMarkup()
  assert.doesNotMatch(correction, /data-correction-field/, 'the single-field selector must be gone')
  assert.match(correction, />Service</)
  assert.match(correction, />Plan</)
  assert.match(correction, />Price</)
  assert.match(correction, />Billing cadence</)
  assert.match(correction, />Next renewal date</)
  assert.match(correction, /data-correction-service>/)
  assert.match(correction, /data-correction-service-icon/)
  assert.match(correction, /data-correction-plan/)
  assert.match(correction, /data-correction-price/)
  assert.match(correction, /data-correction-currency/)
  assert.match(correction, /<option value="USD">USD<\/option>/)
  assert.match(correction, /<option value="CAD">CAD<\/option>/)
  assert.match(correction, /data-correction-cadence/)
  assert.match(correction, /data-correction-renewal/)
  assert.match(correction, /type="date"/)
  // Save starts disabled - nothing has changed yet (populated by
  // renderCorrectionDialog/wireCorrectionDialogInteractions at open time).
  assert.match(correction, /data-correction-submit disabled/)
  assert.match(correction, /We'll keep the original receipt evidence so you can always see where this came from\./)
  assert.match(correction, /Cancel/)
  assert.match(correction, /Save changes/)
  // Every known canonical service is offered by name (Netflix used only as
  // one representative check - the option list itself is data-driven from
  // SUBSCRIPTION_TEMPLATES, not hardcoded per service).
  assert.match(correction, />Netflix</)

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

  // FEATURE-003: a merely-inferred renewal date is never presented with the
  // same certainty as a confirmed one, and no date is invented when there
  // isn't one.
  assert.equal(renewalLabel({ next: 'Sep 12, 2026', source: 'Gmail receipt', pipelineRecord: { confidence: { state: 'inferred' } } }), 'Expected renewal')
  assert.equal(renewalLabel({ next: 'Sep 12, 2026', source: 'Gmail receipt', pipelineRecord: { fieldObservations: [{ field: 'nextRenewal', provenance: 'confirmed' }] } }), 'Next renewal')
  assert.equal(renewalLabel({ next: 'Sep 12, 2026', pipelineRecord: { corrections: [{ field: 'next_renewal' }] } }), 'Next renewal')
  assert.equal(renewalLabel({ next: 'Not provided' }), 'Next renewal')

  const disclosure = gmailDisclosureMarkup()
  assert.match(disclosure, /Find subscriptions from receipts/)
  assert.match(disclosure, /Continue with Gmail/)
  assert.match(disclosure, /Not now/)
})

// ---- Service icons: recognizable identity per canonical service, never a
// wrong or invented logo for an unmapped merchant, and never a generic
// document icon when a real (even unmapped) name is available.
test('known canonical services get a distinct icon; unmapped-but-named merchants get a first-letter tile; only a missing name gets the neutral fallback', () => {
  assert.notEqual(serviceIconFor('Netflix'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Spotify'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Dropbox'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Canva'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('NordVPN'), FALLBACK_SERVICE_ICON)

  // Unmapped but named: a letter tile, not the neutral fallback and not a
  // guessed logo for a service Subtle AI doesn't actually recognize.
  assert.notEqual(serviceIconFor('Some Unmapped Merchant LLC'), FALLBACK_SERVICE_ICON)
  assert.notEqual(serviceIconFor('Some Unmapped Merchant LLC'), serviceIconFor('Netflix'))
  assert.match(serviceIconFor('Some Unmapped Merchant LLC').svg, />S</)
  assert.match(serviceIconFor('Crave').svg, />C</)
  assert.match(serviceIconFor('Patreon').svg, />P</)
  assert.match(serviceIconFor('MyFitnessPal').svg, />M</)
  // Leading symbols/whitespace are skipped to find the first *meaningful*
  // character.
  assert.match(serviceIconFor('  #1 Fitness Club').svg, />1</)

  // Every unmapped-but-named service gets the same letter-tile styling
  // (background/foreground), matching the established Subtle AI identity
  // tile look rather than a per-service invented palette.
  assert.deepEqual(
    { bg: serviceIconFor('Crave').bg, fg: serviceIconFor('Crave').fg },
    { bg: serviceIconFor('Patreon').bg, fg: serviceIconFor('Patreon').fg },
  )

  // Only a genuinely missing/invalid name falls all the way through to the
  // neutral generic icon.
  assert.equal(serviceIconFor(''), FALLBACK_SERVICE_ICON)
  assert.equal(serviceIconFor(undefined), FALLBACK_SERVICE_ICON)
  assert.equal(serviceIconFor('   '), FALLBACK_SERVICE_ICON)

  const netflix = serviceIconMarkup('Netflix')
  assert.match(netflix, /Netflix logo/)
  // A letter tile never claims to be a "logo" - it's a stand-in for a name
  // Subtle AI doesn't recognize, not a real brand mark.
  const unknown = serviceIconMarkup('Totally Unknown Co')
  assert.match(unknown, /aria-label="Totally Unknown Co"/)
  assert.doesNotMatch(unknown, /logo/)
  // The service name always stays visible as real text elsewhere (the row
  // markup, not the icon) - the icon itself never substitutes for the name.
})

// ---- Service icons: a FEATURE-002 correction that changes canonicalService
// must change the displayed icon on the very next render, in both
// directions - nothing here caches or pins the icon to the old name.
test('serviceIconFor tracks canonicalService live, so a FEATURE-002 correction changes the icon tier immediately', () => {
  // Unknown -> a name FEATURE-002 maps to a real logo: tile becomes the logo.
  assert.equal(serviceIconFor('Some New Service Nobody Recognizes') === SERVICE_ICONS.Netflix, false)
  assert.equal(serviceIconFor('Netflix'), SERVICE_ICONS.Netflix)
  // Known -> corrected to a name with no mapping: logo becomes a letter tile,
  // never stays pinned to the old logo and never falls to the generic icon.
  const corrected = serviceIconFor('Some Renamed Local Gym')
  assert.notEqual(corrected, SERVICE_ICONS.Netflix)
  assert.notEqual(corrected, FALLBACK_SERVICE_ICON)
  assert.match(corrected.svg, />S</)
})

// ---- Branding: "Subtle AI" everywhere, never bare "Subtle".
test('the product is branded "Subtle AI" throughout, not "Subtle"', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /name:\s*'Subtle AI'/)
  assert.match(main, /brand-wordmark" src="\/wordmark\.png"[\s\S]{0,40}alt="\$\{APP_CONFIG\.name\}"/)
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

// ---- Landing/sign-in page: marketing content matching the approved mockup,
// but only the one control that actually works (Google sign-in) - no
// email/password auth, sign-up, or password reset exist on the backend, and
// no fabricated star rating or testimonial.
test('the landing page offers only the real Google sign-in control and no fabricated auth, rating, or testimonial UI', () => {
  const page = signedOutMarkup()
  assert.match(page, /data-google-sign-in/)
  assert.match(page, /Continue with Google/)
  assert.doesNotMatch(page, /type="email"|type="password"|Forgot your password|Sign up|Don't have an account/i)
  assert.doesNotMatch(page, /★|star-rating|testimonial|Subtle AI user/i)

  // Real, currently-true product claims only.
  assert.match(page, /Find everything/)
  assert.match(page, /Understand the details/)
  assert.match(page, /Know what matters/)
  assert.match(page, /Take action/)
  assert.match(page, /Trusted by people who want clarity and control/)

  // The product-preview panel is illustrative, not live data, and is marked
  // aria-hidden - the only real interactive element on the whole page is the
  // Google button (the preview itself is built entirely from
  // div/span/strong/em/small, never <a> or <button>, so nothing in it reads
  // as a control that happens to do nothing).
  assert.match(page, /class="landing-preview" aria-hidden="true"/)
  assert.equal((page.match(/<button/g) || []).length, 1)
  assert.equal((page.match(/<a /g) || []).length, 0)

  // The feature section keeps its id as the target of the header's
  // "Learn more" anchor (added in main.js, outside signedOutMarkup).
  assert.match(page, /id="learn-more"/)
})
