import { serviceIconMarkup } from '../services/serviceIcons.js'
import { NAV_ICONS } from './navigation.js'

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>')
const ICON_CHECK = svg('<path d="m20 6-11 11-5-5"/>')
const ICON_TRASH = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>`
const ICON_RECEIPT = svg('<path d="M9 3h6a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6"/>')
const ICON_PERSON = svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.5 4-5.5 7-5.5s5.8 2 7 5.5"/>')

// FEATURE-002: maps the UI-facing field keys already used elsewhere in this
// file to the snake_case field name subscription_corrections/
// correction_conflicts record server-side (see
// migrations/008_feature_002_corrections.sql and server/app.js's
// CORRECTION_FIELD_MAP).
export const CORRECTION_FIELD_FOR = { canonicalService: 'canonical_service', plan: 'plan', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }
// The reverse of the API's CORRECTION_FIELD_MAP - the field select below
// submits these camelCase keys directly to PATCH /api/v1/subscriptions/:id.
export const CORRECTABLE_FIELDS = [
  { value: 'canonicalService', label: 'Service' },
  { value: 'plan', label: 'Plan' },
  { value: 'currentPrice', label: 'Price' },
  { value: 'currency', label: 'Currency (USD or CAD)' },
  { value: 'billingCycle', label: 'Billing cadence (monthly or yearly)' },
  { value: 'nextRenewal', label: 'Next renewal date' },
]
const FRIENDLY_FIELD_LABEL = { canonical_service: 'service', plan: 'plan', current_price: 'price', currency: 'currency', billing_cycle: 'billing cadence', next_renewal: 'next renewal' }
const correctionDisplayValue = (field, value) => field === 'current_price' && typeof value === 'number' ? money(value) : String(value)

// The Subscription Detail *page* - a dedicated destination at
// #/subscriptions/:id, not a modal over Overview. "This looks wrong" and
// "Not a subscription" open their own focused dialogs (correctionDialogMarkup /
// rejectConfirmMarkup) rather than expanding inline, since both are
// consequential, form-shaped actions that benefit from a focused surface.
export const detailMarkup = () => `<div class="main-content wrap" id="page-subscription-detail"><a class="back-link" href="#/subscriptions">${NAV_ICONS.back}Back to Subscriptions</a>

<header class="detail-identity panel-card"><div class="detail-identity-top">${serviceIconMarkup('', { size: 'lg' })}<div class="detail-identity-who"><div class="id-top"><h1 id="detail-title"></h1><span class="status-pill" data-detail-status>Active</span></div><span data-detail-plan></span></div></div><p class="detail-price"><strong data-detail-cost></strong><span class="provenance-pill" data-detail-provenance hidden>${ICON_CHECK}Confirmed by you</span></p><div class="meta-rows"><div><span>Billing cadence</span><strong data-detail-cadence></strong></div><div><span>Next renewal</span><strong data-detail-next></strong></div><div><span>Annualized cost</span><strong data-detail-annual></strong></div></div></header>

<section data-notice class="panel-card" hidden><strong data-notice-title></strong><p data-notice-copy></p><p data-saving hidden><span>Potential savings</span> <strong></strong></p></section>

<section class="panel-card evidence" aria-labelledby="evidence-title"><div class="panel-head"><h2 id="evidence-title">Information source</h2></div><div class="evidence-list" data-evidence-list></div><details data-evidence-more hidden><summary>Show all evidence</summary><div class="evidence-list" data-evidence-list-more></div></details><dl class="provenance-dl"><div><dt>Current cost</dt><dd data-cost-source></dd></div><div><dt>Billing cadence</dt><dd data-cadence-source></dd></div><div><dt>Next renewal</dt><dd data-renewal-source></dd></div><div><dt>Last confirmed</dt><dd data-confirmed></dd></div><div><dt>Evidence confidence</dt><dd data-confidence></dd></div></dl></section>

<section class="panel-card"><details><summary>Price history</summary><div data-price-history></div></details><details><summary>Billing history</summary><div data-billing-history></div></details></section>

<section class="panel-card detail-corrections" data-detail-corrections aria-label="Correct or remove this subscription"><p class="conflict-notice" data-conflict-notice hidden></p><div class="detail-corrections-actions"><button class="secondary-button" type="button" data-toggle-correction>This looks wrong</button><button class="quiet-button danger-text" data-open-reject type="button">Not a subscription</button></div></section>
</div>`

// FEATURE-002 correction entry point. Opened from "This looks wrong" on the
// detail page; explicitly never overwrites receipt evidence - it only writes
// a new subscription_corrections row (see server/app.js), which is why the
// copy below promises the original evidence stays visible.
export const correctionDialogMarkup = () => `<div class="dialog-backdrop" data-correction-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Correct subscription information</p><h2 id="correction-title">Update the details below</h2><p>Your changes will be saved.</p><form class="correction-form" data-correction-form><label>Field<select name="field" data-correction-field>${CORRECTABLE_FIELDS.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('')}</select></label><p class="current-value">Current value: <strong data-correction-current></strong></p><label>Corrected value<input name="value" data-correction-value required autocomplete="off"></label><p class="form-error" data-correction-error hidden role="alert"></p><div class="correction-hint">${ICON_INFO}<span>We'll keep the original receipt evidence so you can always see where this came from.</span></div><div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Save changes</button></div></form></section></div>`

// A dedicated confirmation dialog for "Not a subscription" - consequential
// (it stops the item counting as active spend) but not destructive (evidence
// is preserved), so it gets a clear explanatory step rather than a native
// confirm() or an instant action.
export const rejectConfirmMarkup = () => `<div class="dialog-backdrop" data-reject-dialog hidden><section class="dialog reject-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><div class="reject-icon-wrap">${ICON_TRASH}</div><h2 id="reject-title">Not a subscription?</h2><p>This will remove <strong data-reject-name></strong> from your active subscriptions and recurring spend. You can change this later if needed.</p><div class="reject-whatnext"><strong>What will happen</strong><ul><li>${ICON_CHECK}It won't appear in your active subscriptions</li><li>${ICON_CHECK}It won't be counted in recurring spend</li><li>${ICON_CHECK}We'll remember your decision</li></ul></div><div class="dialog-actions"><button class="danger-button" data-confirm-reject type="button">Mark as not a subscription</button><button class="quiet-button" data-close-dialog type="button">Cancel</button></div></section></div>`

const correctionFieldValue = (item, apiField) => {
  switch (apiField) {
    case 'canonicalService': return item.name
    case 'plan': return item.plan
    case 'currentPrice': return typeof item.cost === 'number' ? item.cost : ''
    case 'currency': return item.currency || ''
    case 'billingCycle': return item.cadence || ''
    case 'nextRenewal': return item.next && item.next !== 'Not provided' ? item.next : ''
    default: return ''
  }
}

export const fieldProvenance = (item, field) => {
  if (item.source === 'Manual entry') return 'User provided'
  const correctionField = CORRECTION_FIELD_FOR[field]
  const hasActiveCorrection = correctionField && (item.pipelineRecord?.corrections || []).some(correction => correction.field === correctionField)
  if (hasActiveCorrection) return 'Confirmed by you'
  const observation = [...(item.pipelineRecord?.fieldObservations || [])].reverse().find(entry => entry.field === field)
  const state = observation?.provenance || item.pipelineRecord?.confidence?.state
  if (state === 'confirmed') return `Confirmed from ${item.source}`
  if (state === 'inferred') return `Inferred from ${item.source}`
  return `Source: ${item.source || 'Not provided'}`
}

const formatDate = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// A unified, reverse-chronological "information source" trail: every raw
// receipt this subscription was built/updated from (from evidence, never
// altered) plus every user correction (from corrections) - each visually
// tagged so a receipt is never mistaken for a user edit or vice versa. This
// is why a correction never rewrites `evidence`: both stay independently
// visible here, per FEATURE-002.
const evidenceRows = (item) => {
  const receipts = (item.pipelineRecord?.evidence || []).map((entry) => ({
    icon: ICON_RECEIPT,
    label: `Receipt from ${entry.canonicalService || entry.rawMerchant || item.name}`,
    value: typeof entry.amount === 'number' ? money(entry.amount) : '—',
    date: formatDate(entry.receivedAt),
    tagClass: '',
    tagText: 'From receipt',
    sortKey: entry.receivedAt || '',
  }))
  const corrections = (item.pipelineRecord?.corrections || []).map((correction) => ({
    icon: ICON_PERSON,
    label: `You updated ${FRIENDLY_FIELD_LABEL[correction.field] || correction.field}`,
    value: correctionDisplayValue(correction.field, correction.value),
    date: formatDate(correction.createdAt),
    tagClass: 'tag-you',
    tagText: 'Confirmed by you',
    sortKey: correction.createdAt || '',
  }))
  return [...corrections, ...receipts].sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)))
}

const evidenceRowMarkup = (row) => `<div class="evidence-item"><span class="evidence-icon">${row.icon}</span><div class="who"><strong>${escapeHtml(row.label)}</strong><span>${row.date ? escapeHtml(row.date) : 'Date not provided'}</span></div><span class="amount">${escapeHtml(row.value)}</span><span class="tag ${row.tagClass}">${row.tagText}</span></div>`

export const renderDetail = (root, item) => {
  const monthlyCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const annualCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost : item.cost * 12) : null
  root.dataset.subscriptionId = item.remoteId || ''
  root.querySelector('.detail-identity-top').querySelector('.service-icon').outerHTML = serviceIconMarkup(item.name, { size: 'lg' })
  root.querySelector('#detail-title').textContent = item.name
  root.querySelector('[data-detail-plan]').textContent = item.plan
  root.querySelector('[data-detail-status]').textContent = (item.status || 'active').toUpperCase()
  root.querySelector('[data-detail-cost]').textContent = monthlyCost === null ? money(null) : `${money(monthlyCost)} / month`
  root.querySelector('[data-detail-cadence]').textContent = item.cadence === 'yearly' ? 'Yearly' : 'Monthly'
  root.querySelector('[data-detail-next]').textContent = item.next
  root.querySelector('[data-detail-annual]').textContent = money(annualCost)
  root.querySelector('[data-detail-provenance]').hidden = fieldProvenance(item, 'amount') !== 'Confirmed by you'

  // A real, specific signal only - never the constant placeholder every
  // backend record otherwise carries (see subscriptionMapper.js), which
  // would just be noise repeated on every subscription's page.
  const notice = root.querySelector('[data-notice]')
  const hasRealNotice = Boolean(item.comparison) || item.takeTone === 'urgent'
  notice.hidden = !hasRealNotice
  if (hasRealNotice) {
    root.querySelector('[data-notice-title]').textContent = item.analysisTitle
    root.querySelector('[data-notice-copy]').textContent = item.analysisCopy
    const saving = root.querySelector('[data-saving]')
    saving.hidden = !item.comparison
    if (item.comparison) saving.querySelector('strong').textContent = item.comparison.savings
  }

  root.querySelector('[data-cost-source]').textContent = fieldProvenance(item, 'amount')
  root.querySelector('[data-cadence-source]').textContent = fieldProvenance(item, 'cadence')
  root.querySelector('[data-renewal-source]').textContent = fieldProvenance(item, 'nextRenewal')
  root.querySelector('[data-confirmed]').textContent = item.confirmed || 'Not provided'
  root.querySelector('[data-confidence]').textContent = item.confidence || 'Not provided'

  const rows = evidenceRows(item)
  root.querySelector('[data-evidence-list]').innerHTML = rows.slice(0, 2).map(evidenceRowMarkup).join('') || '<p class="empty-state">No evidence recorded yet.</p>'
  const moreDetails = root.querySelector('[data-evidence-more]')
  const rest = rows.slice(2)
  moreDetails.hidden = rest.length === 0
  moreDetails.open = false
  moreDetails.querySelector('summary').textContent = `Show all evidence (${rows.length})`
  root.querySelector('[data-evidence-list-more]').innerHTML = rest.map(evidenceRowMarkup).join('')

  const renderHistory = (container, entries) => {
    container.replaceChildren(...entries.map(([date, value]) => {
      const row = document.createElement('p')
      const dateEl = document.createElement('span'); dateEl.textContent = date
      const valueEl = document.createElement('strong'); valueEl.textContent = value
      row.append(dateEl, valueEl)
      return row
    }))
  }
  renderHistory(root.querySelector('[data-price-history]'), item.history)
  renderHistory(root.querySelector('[data-billing-history]'), item.bills)

  // FEATURE-002: corrections and "Not a subscription" only apply to real,
  // backend-derived records - manual entries have no server-side subscription
  // to correct or reject.
  root.querySelector('[data-detail-corrections]').hidden = !item.remoteId
  if (item.remoteId) {
    const conflicts = item.pipelineRecord?.conflicts || []
    const conflictNotice = root.querySelector('[data-conflict-notice]')
    conflictNotice.hidden = conflicts.length === 0
    if (conflicts.length) conflictNotice.textContent = `A newer receipt reported a different value than your correction for ${conflicts.length === 1 ? 'one field' : `${conflicts.length} fields`}. Your correction is being kept.`
  }
}

export const renderCorrectionDialog = (root, item) => {
  const fieldSelect = root.querySelector('[data-correction-field]')
  const currentValueEl = root.querySelector('[data-correction-current]')
  const valueInput = root.querySelector('[data-correction-value]')
  const updateCurrentValue = () => {
    const value = correctionFieldValue(item, fieldSelect.value)
    currentValueEl.textContent = value === '' || value === null || value === undefined ? 'Not provided' : String(value)
    valueInput.value = ''
  }
  fieldSelect.value = 'currentPrice'
  fieldSelect.onchange = updateCurrentValue
  updateCurrentValue()
  root.querySelector('[data-correction-error]').hidden = true
}
