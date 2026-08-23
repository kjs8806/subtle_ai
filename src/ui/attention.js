import { serviceIconMarkup } from '../services/serviceIcons.js'
import { NAV_ICONS } from './navigation.js'
import { routePath } from './router.js'

const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>')
const ICON_CHECK = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>`

const money = (amount, currency) => typeof amount !== 'number' ? 'Price not provided' : currency ? `${currency} ${amount.toFixed(2)}` : `$${amount.toFixed(2)}`
const formatDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const cadenceUnit = (cadence) => cadence === 'yearly' ? 'yr' : 'mo'

// Product Owner decision (GitHub issue #22, decision #3): the mockup's
// High/Medium/Low badges are visual aids, not an authoritative scoring
// engine - see the priorityFor() comment in attentionItemBuilder.js for the
// actual tier assignment this only renders.
const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }
export const severityBadgeMarkup = (priority) => `<span class="severity-badge severity-${escapeHtml(priority || 'low')}">${SEVERITY_LABEL[priority] || 'Low'}</span>`

export const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'price_change', label: 'Price changes' },
  { key: 'renewal', label: 'Renewals' },
  { key: 'needs_review', label: 'Needs review' },
]
export const countsByFilter = (items) => Object.fromEntries(FILTER_TABS.map(({ key }) => [key, key === 'all' ? items.length : items.filter(item => item.type === key).length]))
export const filterAttentionItems = (items, filterKey) => filterKey && filterKey !== 'all' ? items.filter(item => item.type === filterKey) : items
export const sortAttentionItems = (items, sort) => sort === 'name'
  ? [...items].sort((a, b) => (a.canonicalService || '').localeCompare(b.canonicalService || ''))
  : [...items].sort((a, b) => a.sortRank - b.sortRank)

export const attentionTitle = (item) => item.plan ? `${item.canonicalService} · ${item.plan}` : item.canonicalService

export const attentionSubtitle = (item) => {
  if (item.type === 'price_change') {
    const { previousPrice, currentPrice, currency, cadence, annualImpact } = item.priceChange
    return `${money(previousPrice, currency)} → ${money(currentPrice, currency)}/${cadenceUnit(cadence)} · +${money(annualImpact, currency)}/year`
  }
  if (item.type === 'renewal') {
    const { timing, daysUntil, certainty, date } = item.renewal
    const label = certainty === 'inferred' ? 'Expected renewal' : 'Next renewal'
    const when = timing === 'due_today' ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`
    return `${label}: ${formatDate(date) || 'Not available'} · ${when}`
  }
  return 'Possible subscription · Uncertain'
}

// FEATURE-002: an ambiguous candidate is a pending review item, never an
// active subscription - it visually differs from a confirmed subscription
// row (no chevron/no detail link, an explicit "Uncertain" tag, and an
// evidence-count line) and never contributes to confirmed recurring spend
// until the user confirms it.
export const candidateRow = (candidate) => {
  const evidence = candidate?.evidence || []
  const priced = [...evidence].reverse().find((entry) => typeof entry.amount === 'number' && entry.currency)
  const priceLabel = priced ? `${money(priced.amount, priced.currency)}${priced.cadence ? ` every ${priced.cadence === 'yearly' ? 'year' : 'month'}` : ''}` : ''
  return `<article class="candidate-row" data-candidate-id="${escapeHtml(candidate?.id)}">${serviceIconMarkup(candidate?.canonicalService)}<div class="candidate-info"><div class="candidate-title"><strong>${escapeHtml(candidate?.canonicalService)}</strong>${priceLabel ? `<span class="candidate-price">${escapeHtml(priceLabel)}</span>` : ''}<span class="uncertain-tag">Uncertain</span></div><span>Possible subscription${candidate?.rawMerchant && candidate.rawMerchant !== candidate.canonicalService ? ` · ${escapeHtml(candidate.rawMerchant)}` : ''}</span><div class="candidate-why"><strong>Why we're unsure</strong><p>We found ${evidence.length} receipt${evidence.length === 1 ? '' : 's'} but couldn't confirm this is a subscription.</p></div></div><div class="candidate-actions"><button class="primary-button" data-confirm-candidate type="button" aria-label="Confirm ${escapeHtml(candidate?.canonicalService)} as a subscription">Confirm subscription</button><button class="quiet-button" data-reject-candidate type="button" aria-label="${escapeHtml(candidate?.canonicalService)} is not a subscription">Not a subscription</button></div></article>`
}

// A price-change/renewal card opens the detail dialog (renderAttentionDetail
// below); a needs-review candidate keeps its own dedicated confirm/reject
// controls instead (see candidateRow), since "review the subscription" isn't
// a meaningful action until it's confirmed to exist.
export const attentionCardMarkup = (item) => `<button class="attention-card" type="button" data-attention-id="${escapeHtml(item.id)}"><span class="severity-rail severity-${escapeHtml(item.priority)}"></span>${serviceIconMarkup(item.canonicalService, { size: 'sm' })}<span class="attention-card-body"><span class="attention-card-title-row"><strong>${escapeHtml(attentionTitle(item))}</strong>${severityBadgeMarkup(item.priority)}</span><span class="attention-card-subtitle">${escapeHtml(attentionSubtitle(item))}</span></span>${NAV_ICONS.chevron}</button>`

// Legacy overlap-detection cards (src/services/recommendationEngine.js,
// unrelated to FEATURE-003) - kept out of the severity/filter system since
// they predate it and the mockup doesn't cover them, but still surfaced here
// under "All" so the existing feature isn't silently dropped.
export const overlapCardMarkup = (action) => `<article class="action-card"><p class="action-label">${escapeHtml(action.label)}</p><h3 class="affected-services">${escapeHtml(action.affectedServices.join(' + '))}</h3><p>${escapeHtml(action.body)}</p>${action.saving ? `<p class="impact"><span>${escapeHtml(action.impactLabel)}</span><strong>${escapeHtml(action.saving)}</strong></p>` : ''}<div><a class="primary-button" href="#${routePath('subscription-detail', { id: action.subscriptionId })}">Review subscription</a>${action.secondary ? `<button class="quiet-button" type="button" data-dismiss-overlap="${escapeHtml(action.id)}">${escapeHtml(action.secondary)}</button>` : ''}</div></article>`

const emptyAllCaughtUpMarkup = () => `<div class="subscriptions-empty"><span class="empty-icon">${ICON_CHECK}</span><h2>You're all caught up</h2><p>Nothing needs your attention right now. We'll let you know if that changes.</p></div>`
const emptyForFilterMarkup = () => `<p class="empty-state">Nothing here for this filter.</p>`

const filterTabsMarkup = (counts, active) => FILTER_TABS.map(({ key, label }) => `<button class="filter-tab${key === active ? ' is-active' : ''}" type="button" role="tab" aria-selected="${key === active}" data-attention-filter="${key}">${escapeHtml(label)}${counts[key] ? `<span class="filter-tab-count">${counts[key]}</span>` : ''}</button>`).join('')

// Re-rendered on every filter/sort change (see wireAttentionPage in main.js)
// without touching the tabs/sort control around it, mirroring
// renderSubscriptionRows' split between static toolbar and re-rendered list.
export const renderAttentionList = (root, { items = [], candidatesById = new Map(), hasAnyItems = items.length > 0 }) => {
  const list = root.querySelector('[data-attention-list]')
  if (!list) return
  list.innerHTML = items.map(item => item.type === 'needs_review' ? candidateRow(candidatesById.get(item.candidateId)) : attentionCardMarkup(item)).join('')
  const empty = root.querySelector('[data-attention-empty]')
  empty.innerHTML = items.length ? '' : (hasAnyItems ? emptyForFilterMarkup() : '')
  empty.hidden = items.length > 0
  list.hidden = items.length === 0
  const tabs = root.querySelector('[data-attention-tabs]')
  if (tabs) tabs.hidden = !hasAnyItems
}

export const attentionPageMarkup = ({ items = [], overlapActions = [] } = {}) => {
  const total = items.length + overlapActions.length
  const counts = countsByFilter(items)
  const hasAnyItems = items.length > 0

  return `<div class="main-content wrap" id="page-attention"><header class="page-header"><div><p class="eyebrow" data-attention-total>${total} to review</p><h1>Worth your attention</h1><p>Things Subtle AI believes may need a decision.</p></div></header>

<div class="attention-info-banner">${ICON_INFO}<p><strong>You're in control.</strong> These are suggestions, not automatic changes - nothing here affects your subscriptions until you act on it.</p></div>

${hasAnyItems ? `<div class="attention-toolbar" data-attention-tabs><div class="attention-tabs" role="tablist" aria-label="Filter by type">${filterTabsMarkup(counts, 'all')}</div><label class="sort-control"><span>Sort by</span><select data-attention-sort><option value="priority">Priority</option><option value="name">Service name (A-Z)</option></select></label></div>` : ''}

<section class="panel-card attention-full" aria-label="Needs a decision"><div class="attention-list" data-attention-list></div><div data-attention-empty></div></section>

${overlapActions.length ? `<section class="panel-card attention-overlap" data-attention-overlap aria-labelledby="attention-overlap-title"><div class="panel-head"><h2 id="attention-overlap-title">Other suggestions</h2><span class="count-badge">${overlapActions.length}</span></div><div class="action-feed">${overlapActions.map(overlapCardMarkup).join('')}</div></section>` : ''}

${!total ? emptyAllCaughtUpMarkup() : ''}
</div>`
}

export const attentionDetailDialogMarkup = () => `<div class="dialog-backdrop attention-detail-backdrop" data-attention-dialog hidden><section class="dialog attention-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="attention-detail-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><div data-attention-detail-body></div></section></div>`

const priceStatCards = (change) => `<div class="attention-stat-grid"><div class="attention-stat"><span>Previous price</span><strong>${escapeHtml(money(change.previousPrice, change.currency))}</strong></div><div class="attention-stat"><span>Current price</span><strong>${escapeHtml(money(change.currentPrice, change.currency))}</strong></div><div class="attention-stat"><span>Change</span><strong>+${change.percentChange.toFixed(1)}%</strong></div><div class="attention-stat"><span>Annual impact</span><strong>+${escapeHtml(money(change.annualImpact, change.currency))}/yr</strong></div></div><dl class="attention-details-dl"><div><dt>Billing cadence</dt><dd>${change.cadence === 'yearly' ? 'Yearly' : 'Monthly'}</dd></div><div><dt>Currency</dt><dd>${escapeHtml(change.currency)}</dd></div><div><dt>First seen at this price</dt><dd>${escapeHtml(formatDate(change.firstSeenAt) || 'Not available')}</dd></div></dl>`

const renewalStatCards = (renewal) => `<div class="attention-stat-grid"><div class="attention-stat"><span>Renewal date</span><strong>${escapeHtml(formatDate(renewal.date) || 'Not available')}</strong></div><div class="attention-stat"><span>Days until renewal</span><strong>${renewal.timing === 'due_today' ? 'Today' : renewal.daysUntil}</strong></div><div class="attention-stat"><span>Certainty</span><strong>${renewal.certainty === 'inferred' ? 'Expected' : 'Confirmed'}</strong></div></div>`

// Recommended actions are deliberately limited to "Review subscription" and
// "Dismiss this item" - the mockup also showed "Compare alternatives" and
// "Cancel subscription", but the Product Owner's explicit scope correction
// (GitHub issue #22) authorized only Review subscription. See
// docs/design/DESIGN_DECISIONS.md.
//
// A pure string-building function (unlike renderDetail/renderCorrectionDialog
// in subscriptionDetail.js, which mutate the DOM directly and so aren't unit
// tested) so the detail dialog's content is testable without a DOM.
export const attentionDetailMarkup = (item) => {
  const eyebrow = item.type === 'price_change' ? 'Price change' : 'Upcoming renewal'
  const stats = item.type === 'price_change' ? priceStatCards(item.priceChange) : renewalStatCards(item.renewal)
  return `<div class="attention-detail-head">${serviceIconMarkup(item.canonicalService, { size: 'lg' })}<div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="attention-detail-title">${escapeHtml(attentionTitle(item))}</h2>${severityBadgeMarkup(item.priority)}</div></div>
${stats}
<div class="attention-detail-actions"><a class="primary-button" data-attention-review href="#${routePath('subscription-detail', { id: item.subscriptionId })}">Review subscription</a><button class="quiet-button" type="button" data-attention-dismiss data-attention-dismiss-id="${escapeHtml(item.id)}">Dismiss this item</button></div>`
}

export const renderAttentionDetail = (root, item) => {
  const body = root.querySelector('[data-attention-detail-body]')
  body.innerHTML = attentionDetailMarkup(item)
}
