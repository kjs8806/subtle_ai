import { NAV_ICONS } from './navigation.js'
import { subscriptionRow } from './subscriptions.js'
import { serviceIconMarkup } from '../services/serviceIcons.js'

const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths, viewBox = '0 0 24 24') => `<svg width="18" height="18" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const ICONS = {
  spend: svg('<path d="M3 17V9m6 8V5m6 12v-6m6 6V3"/>'),
  annual: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>'),
  active: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m9 12 2 2 4-4"/>'),
}

const PREVIEW_LIMIT = 5
const ATTENTION_PREVIEW_LIMIT = 3

// Overview's job is orientation, not management: a limited subscriptions
// preview (full list lives on /subscriptions), a limited attention preview
// (full review lives on /attention), and one small read-only source-status
// card (management lives on /sources). No settings, no full candidate review,
// no interactive Gmail controls belong here.
const attentionPreviewItem = (candidate) => `<a class="attention-preview-item" href="#/attention">${serviceIconMarkup(candidate.canonicalService, { size: 'sm' })}<span class="who"><strong>${escapeHtml(candidate.canonicalService)}</strong><span>Possible subscription · Uncertain</span></span>${NAV_ICONS.chevron}</a>`

export const overviewMarkup = ({ subscriptions = [], actions = [], monthlySpend, candidates = [], greeting = 'Good morning.', dateLabel = '', gmailSource, gmailSourceUnavailable = false }) => {
  const activeCount = subscriptions.length
  const attentionTotal = actions.length + candidates.length
  const preview = subscriptions.slice(0, PREVIEW_LIMIT)
  const attentionPreview = [...actions.map(action => ({ isAction: true, action })), ...candidates.map(candidate => ({ isAction: false, candidate }))].slice(0, ATTENTION_PREVIEW_LIMIT)

  const connected = !gmailSourceUnavailable && gmailSource?.status === 'connected'
  const lastScan = connected && gmailSource?.lastScanAt ? new Date(gmailSource.lastScanAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  const sourceStatusText = gmailSourceUnavailable ? "Status unavailable" : connected ? (lastScan ? `Last scan ${lastScan}` : 'Connected · ready to scan') : 'Not connected'

  return `<div class="main-content wrap" id="page-overview"><header class="overview-header">${dateLabel ? `<p class="eyebrow">${escapeHtml(dateLabel)}</p>` : ''}<h1>${escapeHtml(greeting)}</h1><p>Here’s what your subscriptions are telling you.</p></header>

<section class="stat-grid" aria-label="Spending summary">
<div class="stat-card" aria-labelledby="spending-title"><p id="spending-title">Monthly recurring spend</p><strong data-spend>${money(monthlySpend)}</strong><small><span data-count>${activeCount}</span> subscriptions</small><span class="stat-icon">${ICONS.spend}</span></div>
<div class="stat-card"><p>Annual spend</p><strong data-annual-spend>${money(monthlySpend * 12)}</strong><span class="stat-meta">Projected</span><span class="stat-icon tone-success">${ICONS.annual}</span></div>
<div class="stat-card"><p>Active subscriptions</p><strong data-active-count>${activeCount}</strong><span class="stat-icon">${ICONS.active}</span></div>
<div class="stat-card"><p>Worth your attention</p><strong data-attention-count>${attentionTotal}</strong><span class="stat-meta">${attentionTotal ? 'Needs review' : 'All clear'}</span><span class="stat-icon tone-coral">${NAV_ICONS.attention}</span></div>
</section>

<div class="overview-grid">
<section class="panel-card subscriptions-preview" aria-labelledby="subscriptions-title"><div class="panel-head"><h2 id="subscriptions-title">Your subscriptions</h2><span class="count-badge">${activeCount} active</span></div><div class="subscription-list">${preview.length ? preview.map(item => subscriptionRow(item)).join('') : '<p class="empty-state">No subscriptions yet. Connect Gmail or add one manually.</p>'}</div>${subscriptions.length ? `<div class="panel-foot"><a href="#/subscriptions">View all subscriptions</a></div>` : ''}</section>

<div class="overview-side">
<section class="panel-card attention-preview" aria-labelledby="attention-title"><div class="panel-head"><h2 id="attention-title">Worth your attention</h2>${attentionTotal ? `<span class="count-badge">${attentionTotal}</span>` : ''}</div><div class="attention-preview-list">${attentionPreview.length ? attentionPreview.map(entry => entry.isAction ? `<a class="attention-preview-item" href="#/attention"><span class="action-icon">${NAV_ICONS.attention}</span><span class="who"><strong>${escapeHtml(entry.action.label)}</strong><span>${escapeHtml(entry.action.affectedServices.join(' + '))}</span></span>${NAV_ICONS.chevron}</a>` : attentionPreviewItem(entry.candidate)).join('') : '<p class="empty-state">Nothing needs your attention right now.</p>'}</div>${attentionTotal ? `<div class="panel-foot"><a href="#/attention">View all</a></div>` : ''}</section>

<section class="panel-card source-status-card" aria-labelledby="source-status-title"><div class="panel-head"><h2 id="source-status-title">Sources</h2></div><div class="source-status-row"><span class="service-icon icon-md" style="background:#fdece2;color:#b84f22">${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}</span><span class="who"><strong>Gmail</strong><span data-gmail-status-preview>${escapeHtml(sourceStatusText)}</span></span></div><div class="panel-foot"><a href="#/sources">Manage sources</a></div></section>
</div>
</div>
</div>`
}
