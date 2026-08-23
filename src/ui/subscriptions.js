import { serviceIconMarkup } from '../services/serviceIcons.js'
import { NAV_ICONS } from './navigation.js'
import { routePath } from './router.js'

const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const attentionFor = (item) => item.takeTone !== 'good' ? item.signal : ''
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>')
const ICON_FILTER = svg('<path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/>')
const ICON_CALENDAR = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>`

// A real link to the subscription's own route (not a button opening a modal) -
// "clicking anywhere on the row" navigates, and the URL itself is shareable/
// bookmarkable/back-forward-able like any other destination. Shared with the
// compact Overview preview, so it stays without a per-row status pill (every
// row is active by definition there - see DES-022); the full table view on
// the Subscriptions page has its own richer row, subscriptionTableRow below.
export const subscriptionRow = (item, discovered = false) => {
  const attention = attentionFor(item)
  const unitPrice = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const href = item.remoteId ? `#${routePath('subscription-detail', { id: item.remoteId })}` : `#${routePath('subscription-detail', { id: item.id })}`
  return `<a class="subscription-row${discovered ? ' discovered' : ''}" href="${href}" data-subscription-id="${escapeHtml(item.id)}" aria-label="Review ${escapeHtml(item.name)} ${escapeHtml(item.plan)}">${serviceIconMarkup(item.name)}<span class="subscription-name"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.plan)}${attention ? ` · <em>${escapeHtml(attention)}</em>` : ''}</span></span><span class="subscription-price">${money(unitPrice)}${unitPrice !== null ? '<small>/mo</small>' : ''}</span><span class="subscription-next"><small>Next renewal</small>${escapeHtml(item.next)}</span><span class="chevron">${NAV_ICONS.chevron}</span></a>`
}

// Whole calendar days from today to `dateStr` (local time, midnight-to-midnight
// so "today" never reads as "in 0 days" due to a few hours of clock drift).
// Returns null when there's no parseable date, rather than a fabricated count.
const daysUntil = (dateStr) => {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const startOfTarget = new Date(date); startOfTarget.setHours(0, 0, 0, 0)
  return Math.round((startOfTarget - startOfToday) / 86400000)
}
const renewalCountdown = (days) => {
  if (days === null) return ''
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// The full table row used on the Subscriptions page itself (as opposed to the
// compact subscriptionRow above): separate Price/Billing/Next renewal/Status
// columns matching the approved Subscriptions table design. Status is always
// "Active" today (rejected items never reach this list, and there is no
// trial/cancelled-but-listed state in the data model) - shown once per row
// here because the approved design calls for a literal table, not because a
// row can currently read anything else.
export const subscriptionTableRow = (item) => {
  const attention = attentionFor(item)
  const unitPrice = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const href = item.remoteId ? `#${routePath('subscription-detail', { id: item.remoteId })}` : `#${routePath('subscription-detail', { id: item.id })}`
  const days = daysUntil(item.next)
  const countdown = renewalCountdown(days)
  return `<a class="subscription-table-row" href="${href}" data-subscription-id="${escapeHtml(item.id)}" aria-label="Review ${escapeHtml(item.name)} ${escapeHtml(item.plan)}">
<span class="st-service">${serviceIconMarkup(item.name)}<span class="subscription-name"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.plan)}${attention ? ` · <em>${escapeHtml(attention)}</em>` : ''}</span></span></span>
<span class="st-price">${unitPrice !== null ? `<strong>${money(unitPrice)}</strong><small>/ month</small>` : '<span class="st-empty">Price not provided</span>'}</span>
<span class="st-billing">${item.cadence === 'yearly' ? 'Yearly' : 'Monthly'}</span>
<span class="st-renewal">${item.next && item.next !== 'Not provided' ? `<strong>${escapeHtml(item.next)}</strong>${countdown ? `<small>${escapeHtml(countdown)}</small>` : ''}` : '<span class="st-empty">Not provided</span>'}</span>
<span class="st-status"><span class="status-pill">${escapeHtml((item.status || 'active').toUpperCase())}</span></span>
<span class="chevron">${NAV_ICONS.chevron}</span>
</a>`
}

const TABLE_HEAD = `<div class="subscription-table-head" data-subscription-table-head role="row"><span>Subscription</span><span>Price</span><span>Billing</span><span>Next renewal</span><span>Status</span><span></span></div>`

const emptyStateMarkup = (hasAnySubscriptions) => hasAnySubscriptions
  ? `<div class="subscriptions-empty"><span class="empty-icon">${ICON_CALENDAR}</span><h2>No matches</h2><p>No subscriptions match your search or filter. Try clearing them.</p><button class="secondary-button" type="button" data-clear-filters>Clear search &amp; filters</button></div>`
  : `<div class="subscriptions-empty"><span class="empty-icon">${ICON_CALENDAR}</span><h2>No subscriptions yet</h2><p>We haven't found any subscriptions in your receipts. Keep scanning - we'll add them here.</p><a class="primary-button" href="#${routePath('overview')}">Go to overview</a></div>`

// Re-rendered on every search/sort/filter change (see wireSubscriptionsPage in
// main.js) without touching the toolbar around it, so focus/scroll position in
// the controls is preserved while typing or toggling a filter.
export const renderSubscriptionRows = (root, subscriptions, hasAnySubscriptions) => {
  const list = root.querySelector('[data-subscription-rows]')
  if (!list) return
  list.innerHTML = subscriptions.length ? subscriptions.map(subscriptionTableRow).join('') : ''
  const empty = root.querySelector('[data-subscriptions-empty]')
  empty.innerHTML = subscriptions.length ? '' : emptyStateMarkup(hasAnySubscriptions)
  empty.hidden = subscriptions.length > 0
  list.hidden = subscriptions.length === 0
  root.querySelector('[data-subscription-table-head]').hidden = subscriptions.length === 0
}

// Pure filter/sort so it's unit-testable without a DOM: search matches service
// name or plan (case-insensitive substring), the billing-cadence filter is the
// only facet offered (see the Filter panel markup below for why a Status
// facet was left out), and sort operates on real fields only.
export const filterAndSortSubscriptions = (subscriptions, { query = '', cadence = 'all', sort = 'next-renewal' } = {}) => {
  const needle = query.trim().toLowerCase()
  let result = subscriptions.filter((item) => {
    if (needle && !`${item.name} ${item.plan}`.toLowerCase().includes(needle)) return false
    if (cadence !== 'all' && item.cadence !== cadence) return false
    return true
  })
  const monthlyCost = (item) => typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const sorters = {
    'next-renewal': (a, b) => {
      const da = daysUntil(a.next); const db = daysUntil(b.next)
      if (da === null) return db === null ? 0 : 1
      if (db === null) return -1
      return da - db
    },
    'price-desc': (a, b) => (monthlyCost(b) ?? -Infinity) - (monthlyCost(a) ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name),
  }
  result = [...result].sort(sorters[sort] || sorters['next-renewal'])
  return result
}

export const subscriptionsPageMarkup = ({ subscriptions = [] }) => {
  const activeCount = subscriptions.filter(item => (item.status || 'active') === 'active').length
  return `<div class="main-content wrap" id="page-subscriptions"><header class="page-header"><div><h1>Your subscriptions</h1><p>All active subscriptions detected by Subtle AI.</p></div><span class="count-badge count-badge-lg">${activeCount} active</span></header>

<div class="subscriptions-toolbar">
<label class="search-field"><span class="sr-only">Search subscriptions</span>${ICON_SEARCH}<input type="search" placeholder="Search subscriptions..." data-subscription-search autocomplete="off"></label>
<div class="toolbar-controls">
<div class="filter-control">
<button class="secondary-button" type="button" data-open-filter aria-haspopup="true" aria-expanded="false">${ICON_FILTER}Filter<span class="filter-count" data-filter-count hidden></span></button>
<div class="filter-panel" data-filter-panel hidden>
<div class="filter-panel-head"><strong>Billing cadence</strong><button type="button" data-clear-filters>Clear</button></div>
<label class="filter-option"><input type="radio" name="cadence" value="all" data-filter-cadence checked>All</label>
<label class="filter-option"><input type="radio" name="cadence" value="monthly" data-filter-cadence>Monthly</label>
<label class="filter-option"><input type="radio" name="cadence" value="yearly" data-filter-cadence>Yearly</label>
</div>
</div>
<label class="sort-control"><span>Sort by</span><select data-subscription-sort><option value="next-renewal">Next renewal</option><option value="price-desc">Price (high to low)</option><option value="name">Name (A-Z)</option></select></label>
<button class="primary-button" data-open-add type="button">Add subscription</button>
</div>
</div>

<section class="panel-card subscriptions-full" aria-label="Your subscriptions">${TABLE_HEAD}<div class="subscription-table-body" data-subscription-rows></div><div data-subscriptions-empty></div></section>
<button class="fab" type="button" data-open-add aria-label="Add subscription">+</button>
</div>`
}
