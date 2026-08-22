import { NAV_ICONS } from './navigation.js'

const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const attentionFor = (item) => item.takeTone !== 'good' ? item.signal : ''
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths, viewBox = '0 0 24 24') => `<svg width="18" height="18" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const ICONS = {
  spend: svg('<path d="M3 17V9m6 8V5m6 12v-6m6 6V3"/>'),
  annual: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>'),
  active: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m9 12 2 2 4-4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/>'),
  scan: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  records: svg('<path d="M9 3h6a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6"/>'),
  arrow: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  check: svg('<path d="m20 6-11 11-5-5"/>'),
}

export const subscriptionRow = (item, discovered = false) => {
  const attention = attentionFor(item)
  const unitPrice = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  return `<button class="subscription-row${discovered ? ' discovered' : ''}" data-subscription-id="${escapeHtml(item.id)}" type="button" aria-label="Review ${escapeHtml(item.name)} ${escapeHtml(item.plan)}"><span class="service-icon service-${escapeHtml(item.tone)}">${escapeHtml(item.icon)}</span><span class="subscription-name"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.plan)}${attention ? ` · <em>${escapeHtml(attention)}</em>` : ''}</span></span><span class="subscription-price">${money(unitPrice)}${unitPrice !== null ? '<small>/mo</small>' : ''}</span><span class="subscription-next">${escapeHtml(item.next)}</span><span class="chevron">${NAV_ICONS.chevron}</span></button>`
}

// FEATURE-002: an ambiguous candidate is a pending review item, never an
// active subscription - it gets its own row shape (evidence count + explicit
// Confirm/Reject actions) rather than reusing subscriptionRow, which opens
// Subscription Detail and implies an already-discovered record.
export const candidateRow = (candidate) => {
  const evidence = candidate.evidence || []
  const priced = [...evidence].reverse().find((entry) => typeof entry.amount === 'number' && entry.currency)
  const priceLabel = priced ? `${money(priced.amount)}${priced.cadence ? ` every ${priced.cadence === 'yearly' ? 'year' : 'month'}` : ''}` : ''
  return `<article class="candidate-row" data-candidate-id="${escapeHtml(candidate.id)}"><div class="candidate-info"><div class="candidate-title"><strong>${escapeHtml(candidate.canonicalService)}</strong>${priceLabel ? `<span class="candidate-price">${escapeHtml(priceLabel)}</span>` : ''}<span class="uncertain-tag">Uncertain</span></div>${candidate.rawMerchant && candidate.rawMerchant !== candidate.canonicalService ? `<span>${escapeHtml(candidate.rawMerchant)}</span>` : ''}<small>We found ${evidence.length} receipt${evidence.length === 1 ? '' : 's'} but couldn't confirm this is a subscription.</small></div><div class="candidate-actions"><button class="primary-button" data-confirm-candidate type="button" aria-label="Confirm ${escapeHtml(candidate.canonicalService)} as a subscription">Confirm subscription</button><button class="quiet-button" data-reject-candidate type="button" aria-label="${escapeHtml(candidate.canonicalService)} is not a subscription">Not a subscription</button></div></article>`
}

export const renewalRow = (item) => `<p><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.date)}${item.daysLabel ? ` · ${escapeHtml(item.daysLabel)}` : ''}</span><b>${escapeHtml(item.amount)}</b></p>`

export const overviewMarkup = ({ subscriptions, actions, monthlySpend, upcoming = [], candidates = [], greeting = 'Good morning.', dateLabel = '', user = null }) => {
  const potentialSavings = actions.reduce((total, action) => total + (action.monthlySavings || 0), 0)
  const activeCount = subscriptions.length
  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase()
  return `<div class="main-content wrap" id="overview"><header class="overview-header">${dateLabel ? `<p class="eyebrow">${escapeHtml(dateLabel)}</p>` : ''}<h1>${escapeHtml(greeting)}</h1><p>Here’s what your subscriptions are telling you.</p><div class="section-actions"><button class="secondary-button" data-open-add type="button">Add subscription</button></div></header>

<section class="stat-grid" aria-label="Spending summary">
<div class="stat-card" aria-labelledby="spending-title"><p id="spending-title">Monthly recurring spend</p><strong data-spend>${money(monthlySpend)}</strong>${potentialSavings ? `<div><b>Potential savings</b><strong>${money(potentialSavings)}/month</strong></div>` : ''}<small><span data-count>${activeCount}</span> subscriptions</small><span class="stat-icon">${ICONS.spend}</span></div>
<div class="stat-card"><p>Annual spend</p><strong data-annual-spend>${money(monthlySpend * 12)}</strong><span class="stat-meta">Projected</span><span class="stat-icon tone-success">${ICONS.annual}</span></div>
<div class="stat-card"><p>Active subscriptions</p><strong data-active-count>${activeCount}</strong><span class="stat-icon">${ICONS.active}</span></div>
<div class="stat-card"><p>Worth your attention</p><strong data-attention-count>${candidates.length}</strong><span class="stat-meta">${candidates.length ? 'Needs review' : 'All clear'}</span><span class="stat-icon tone-coral">${NAV_ICONS.attention}</span></div>
</section>

<div class="dashboard-grid">
<section class="attention panel-card" id="attention" aria-labelledby="attention-title"><div class="panel-head"><h2 id="attention-title">Worth your attention</h2>${actions.length ? `<span class="count-badge">${actions.length}</span>` : ''}</div><div class="action-feed">${actions.length ? actions.map(action => `<article class="action-card"><p class="action-label">${escapeHtml(action.label)}</p><h3 class="affected-services">${escapeHtml(action.affectedServices.join(' + '))}</h3><p>${escapeHtml(action.body)}</p>${action.saving ? `<p class="impact"><span>${escapeHtml(action.impactLabel)}</span><strong>${escapeHtml(action.saving)}</strong></p>` : ''}<div><button class="primary-button" data-action-target="${escapeHtml(action.id)}" type="button">Review</button>${action.secondary ? `<button class="quiet-button" type="button">${escapeHtml(action.secondary)}</button>` : ''}</div></article>`).join('') : '<p class="empty-state">Nothing needs your attention right now.</p>'}</div></section>

<section class="upcoming panel-card" aria-labelledby="upcoming-title"><div class="panel-head"><h2 id="upcoming-title">Coming up</h2></div><div class="renewals">${upcoming.length ? upcoming.map(renewalRow).join('') : '<p class="empty-state">No upcoming renewals detected yet.</p>'}</div></section>

<section id="subscriptions" class="subscriptions panel-card" aria-labelledby="subscriptions-title"><div class="panel-head"><h2 id="subscriptions-title">Your subscriptions</h2><span class="count-badge" data-subscriptions-count>${activeCount} active</span></div><div class="subscription-list">${subscriptions.length ? subscriptions.map(item => subscriptionRow(item)).join('') : '<p class="empty-state">No subscriptions yet. Connect Gmail or add one manually.</p>'}</div>${subscriptions.length ? `<div class="panel-foot"><a href="#subscriptions">View all subscriptions</a></div>` : ''}</section>

<section class="sync-status panel-card" id="sources" aria-label="Subscription source status"><div class="panel-head"><h2>Sources</h2></div><div class="source-list"><div class="source-row"><span class="service-icon service-red">${ICONS.mail}</span><div class="who"><strong>Gmail</strong><span data-gmail-message>Connect to discover receipts</span></div><span data-gmail-status>Not connected</span></div></div><div class="source-actions"><button class="secondary-button" data-gmail-action="connect" type="button">Find subscriptions from receipts</button><button class="quiet-button" data-gmail-disconnect type="button" hidden>Disconnect Gmail</button></div><div class="discovery-result" data-discovery-result hidden></div></section>
</div>

<section id="candidates-review" class="candidates-review panel-card" aria-labelledby="candidates-title"><div class="panel-head"><h2 id="candidates-title">Needs your review</h2><span class="count-badge">${candidates.length}</span></div><p class="section-hint">Subtle found receipts that might be subscriptions but couldn't confirm automatically.</p><div class="candidate-list">${candidates.length ? candidates.map(candidateRow).join('') : '<p class="empty-state">Nothing to review right now.</p>'}</div></section>

<section class="info-band" aria-label="How Subtle works"><div class="panel-card"><span class="info-icon">${ICONS.shield}</span><h3>Your data is private and secure</h3><p>We only read your emails to find subscription info. Your data is encrypted and never sold.</p></div><div class="panel-card"><h3>How it works</h3><ol class="how-steps"><li><span class="info-icon">${ICONS.scan}</span><h4>1. Scan Gmail</h4><p>We securely scan your Gmail for subscription emails.</p></li><span class="step-arrow">${ICONS.arrow}</span><li><span class="info-icon">${ICONS.search}</span><h4>2. Find &amp; extract</h4><p>We identify subscription emails and extract key details.</p></li><span class="step-arrow">${ICONS.arrow}</span><li><span class="info-icon">${ICONS.records}</span><h4>3. Create records</h4><p>We create subscription records with evidence from your emails.</p></li></ol></div><div class="panel-card"><h3>Last scan results</h3><ul class="scan-checklist" data-last-scan-results><li class="empty-state" style="padding:10px 0;border:0">No scans yet.</li></ul></div></section>

<section id="settings" class="settings-panel panel-card" aria-labelledby="settings-title"><div class="panel-head"><h2 id="settings-title">Settings</h2></div><div class="settings-row"><div><strong>Account</strong><span data-settings-name>${escapeHtml(user?.name || 'Signed in')}</span></div><span class="stat-icon">${initials}</span></div><div class="settings-row"><div><strong>Email</strong><span data-settings-email>${escapeHtml(user?.email || 'Not provided')}</span></div></div><div class="settings-row"><div><strong>Private by design</strong><span>Sign out to end your session on this device.</span></div><button class="secondary-button" data-sign-out type="button">Sign out</button></div></section>
</div>`
}
