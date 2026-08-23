import { serviceIconFor, serviceIconMarkup } from '../services/serviceIcons.js'
import { SUBSCRIPTION_TEMPLATES } from '../services/subscriptionTemplates.js'
import { NAV_ICONS } from './navigation.js'

const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
// Currency is shown explicitly whenever it's known (FEATURE-001/002 supports
// USD and CAD, and a bare "$" doesn't distinguish them) - "$" is only used
// as the currency-neutral fallback for amounts with no resolved currency.
const moneyWithCurrency = (amount, currency) => typeof amount !== 'number' ? 'Price not provided' : currency ? `${currency} ${amount.toFixed(2)}` : `$${amount.toFixed(2)}`
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
const FRIENDLY_FIELD_LABEL = { canonical_service: 'service', plan: 'plan', current_price: 'price', currency: 'currency', billing_cycle: 'billing cadence', next_renewal: 'next renewal' }
const KNOWN_SERVICES = [...new Set(SUBSCRIPTION_TEMPLATES.map(({ canonicalService }) => canonicalService))].sort((a, b) => a.localeCompare(b))

// The Subscription Detail *page* - a dedicated destination at
// #/subscriptions/:id, not a modal over Overview. "This looks wrong" and
// "Not a subscription" open their own focused dialogs (correctionDialogMarkup /
// rejectConfirmMarkup) rather than expanding inline, since both are
// consequential, form-shaped actions that benefit from a focused surface.
export const detailMarkup = () => `<div class="main-content wrap" id="page-subscription-detail"><a class="back-link" href="#/subscriptions">${NAV_ICONS.back}Back to Subscriptions</a>

<header class="detail-identity panel-card"><div class="detail-identity-top">${serviceIconMarkup('', { size: 'lg' })}<div class="detail-identity-who"><div class="id-top"><h1 id="detail-title"></h1><span class="status-pill" data-detail-status>Active</span></div><span data-detail-plan></span></div></div><p class="detail-price"><strong data-detail-cost></strong><span class="provenance-pill" data-detail-provenance hidden>${ICON_CHECK}Confirmed by you</span></p><div class="meta-rows"><div><span>Billing cadence</span><strong data-detail-cadence></strong></div><div><span data-detail-next-label>Next renewal</span><strong data-detail-next></strong></div><div><span>Annualized cost</span><strong data-detail-annual></strong></div><div><span>Status</span><strong data-detail-status-meta></strong></div></div></header>

<section data-notice class="panel-card" hidden><strong data-notice-title></strong><p data-notice-copy></p><p data-saving hidden><span>Potential savings</span> <strong></strong></p></section>

<section class="panel-card evidence" aria-labelledby="evidence-title"><div class="panel-head"><h2 id="evidence-title">Information source</h2></div><div class="evidence-list" data-evidence-list></div><details data-evidence-more hidden><summary>Show all evidence</summary><div class="evidence-list" data-evidence-list-more></div></details><dl class="provenance-dl"><div><dt>Last confirmed</dt><dd data-confirmed></dd></div><div><dt>Evidence confidence</dt><dd data-confidence></dd></div></dl></section>

<section class="panel-card"><details><summary>Price history</summary><div data-price-history></div></details><details><summary>Billing history</summary><div data-billing-history></div></details></section>

<section class="panel-card detail-corrections" data-detail-corrections aria-label="Correct or remove this subscription"><p class="conflict-notice" data-conflict-notice hidden></p><div class="detail-corrections-actions"><button class="secondary-button" type="button" data-toggle-correction>This looks wrong</button><button class="quiet-button danger-text" data-open-reject type="button">Not a subscription</button></div></section>
</div>`

// FEATURE-002 correction entry point. One form with every supported field,
// not a "pick a field, then a value" workflow - the user inspects the whole
// subscription and can change one or several fields before a single Save.
// Only fields that actually change end up submitted (see
// collectChangedCorrections), so an untouched field never becomes
// "Confirmed by you" merely because the form was submitted.
export const correctionDialogMarkup = () => `<div class="dialog-backdrop correction-backdrop" data-correction-dialog hidden><section class="dialog correction-dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Correct subscription information</p><h2 id="correction-title">Update the details below</h2><p class="dialog-subtitle">Your changes will be saved.</p><form class="correction-form" data-correction-form>

<label class="field-label" for="corr-service">Service</label>
<div class="service-field"><span class="service-icon icon-sm" data-correction-service-icon aria-hidden="true"></span><select id="corr-service" data-correction-service>${KNOWN_SERVICES.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></div>

<label class="field-label" for="corr-plan">Plan</label>
<input id="corr-plan" type="text" data-correction-plan placeholder="Plan not provided" autocomplete="off">

<label class="field-label" for="corr-price">Price</label>
<div class="price-field-row"><input id="corr-price" type="number" min="0" step="0.01" inputmode="decimal" data-correction-price placeholder="0.00"><select data-correction-currency aria-label="Currency"><option value="">Currency</option><option value="USD">USD</option><option value="CAD">CAD</option></select></div>

<label class="field-label" for="corr-cadence">Billing cadence</label>
<select id="corr-cadence" data-correction-cadence><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>

<label class="field-label" for="corr-renewal">Next renewal date</label>
<input id="corr-renewal" type="date" data-correction-renewal>

<p class="form-error" data-correction-error hidden role="alert"></p>

<div class="correction-hint">${ICON_INFO}<span>We'll keep the original receipt evidence so you can always see where this came from.</span></div>

<div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit" data-correction-submit disabled>Save changes</button></div>
</form></section></div>`

// A dedicated confirmation dialog for "Not a subscription" - consequential
// (it stops the item counting as active spend) but not destructive (evidence
// is preserved), so it gets a clear explanatory step rather than a native
// confirm() or an instant action. Kept entirely separate from the correction
// dialog above - this is a classification action, not a field edit.
export const rejectConfirmMarkup = () => `<div class="dialog-backdrop" data-reject-dialog hidden><section class="dialog reject-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><div class="reject-icon-wrap">${ICON_TRASH}</div><h2 id="reject-title">Not a subscription?</h2><p>This will remove <strong data-reject-name></strong> from your active subscriptions and recurring spend. You can change this later if needed.</p><div class="reject-whatnext"><strong>What will happen</strong><ul><li>${ICON_CHECK}It won't appear in your active subscriptions</li><li>${ICON_CHECK}It won't be counted in recurring spend</li><li>${ICON_CHECK}We'll remember your decision</li></ul></div><div class="dialog-actions"><button class="danger-button" data-confirm-reject type="button">Mark as not a subscription</button><button class="quiet-button" data-close-dialog type="button">Cancel</button></div></section></div>`

const applyServiceIcon = (el, name) => {
  const icon = serviceIconFor(name)
  el.style.background = icon.bg
  el.style.color = icon.fg
  el.innerHTML = icon.svg
  el.setAttribute('aria-label', name ? `${name} logo` : 'Unknown service')
}

// Local calendar-date components, not toISOString() - the latter converts
// through UTC and can shift the displayed day depending on the viewer's
// timezone, which is exactly wrong for a "which day does this renew" field.
const toIsoDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

// FEATURE-003: a renewal date backed by a confirmed observation or a user
// correction is presented as fact ("Next renewal"); one only inferred from
// weaker signals is labeled "Expected renewal" instead, so it's never shown
// with the same certainty as a confirmed date. No label games are played
// when there's no date at all - toDisplayItem/subscriptionMapper.js already
// leaves item.next as "Not provided" rather than inventing one.
export const renewalLabel = (item) => {
  if (!item.next || item.next === 'Not provided') return 'Next renewal'
  return fieldProvenance(item, 'nextRenewal').startsWith('Inferred from') ? 'Expected renewal' : 'Next renewal'
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
    tone: 'coral',
    label: `Receipt from ${entry.canonicalService || entry.rawMerchant || item.name}`,
    value: moneyWithCurrency(entry.amount, entry.currency),
    date: formatDate(entry.receivedAt),
    tagClass: 'tag-receipt',
    tagText: 'From receipt',
    sortKey: entry.receivedAt || '',
  }))
  const corrections = (item.pipelineRecord?.corrections || []).map((correction) => ({
    icon: ICON_PERSON,
    tone: 'purple',
    label: `You updated ${FRIENDLY_FIELD_LABEL[correction.field] || correction.field}`,
    // A price correction has no currency of its own - it's paired with the
    // subscription's current currency, the same way the header price is.
    value: correction.field === 'current_price' ? moneyWithCurrency(correction.value, item.currency) : String(correction.value),
    date: formatDate(correction.createdAt),
    tagClass: 'tag-you',
    tagText: 'Confirmed by you',
    sortKey: correction.createdAt || '',
  }))
  return [...corrections, ...receipts].sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)))
}

const evidenceRowMarkup = (row) => `<div class="evidence-item"><span class="evidence-icon evidence-icon-${row.tone}">${row.icon}</span><div class="who"><strong>${escapeHtml(row.label)}</strong><span>${row.date ? escapeHtml(row.date) : 'Date not provided'}</span></div><div class="evidence-right"><span class="amount">${escapeHtml(row.value)}</span><span class="tag ${row.tagClass}">${row.tagText}</span></div></div>`

export const renderDetail = (root, item) => {
  const monthlyCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const annualCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost : item.cost * 12) : null
  root.dataset.subscriptionId = item.remoteId || ''
  root.querySelector('.detail-identity-top').querySelector('.service-icon').outerHTML = serviceIconMarkup(item.name, { size: 'lg' })
  root.querySelector('#detail-title').textContent = item.name
  root.querySelector('[data-detail-plan]').textContent = item.plan
  root.querySelector('[data-detail-status]').textContent = (item.status || 'active').toUpperCase()
  root.querySelector('[data-detail-status-meta]').textContent = (item.status || 'active').charAt(0).toUpperCase() + (item.status || 'active').slice(1)
  root.querySelector('[data-detail-cost]').textContent = monthlyCost === null ? moneyWithCurrency(null) : `${moneyWithCurrency(monthlyCost, item.currency)} / month`
  root.querySelector('[data-detail-cadence]').textContent = item.cadence === 'yearly' ? 'Yearly' : 'Monthly'
  root.querySelector('[data-detail-next-label]').textContent = renewalLabel(item)
  root.querySelector('[data-detail-next]').textContent = item.next
  root.querySelector('[data-detail-annual]').textContent = moneyWithCurrency(annualCost, item.currency)
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

// Populates every field with Subtle AI's current value and stamps each
// control with its starting value (data-initial) so collectChangedCorrections
// can tell a genuine edit from an untouched field later.
export const renderCorrectionDialog = (root, item) => {
  const serviceSelect = root.querySelector('[data-correction-service]')
  const serviceIconEl = root.querySelector('[data-correction-service-icon]')
  const planInput = root.querySelector('[data-correction-plan]')
  const priceInput = root.querySelector('[data-correction-price]')
  const currencySelect = root.querySelector('[data-correction-currency]')
  const cadenceSelect = root.querySelector('[data-correction-cadence]')
  const renewalInput = root.querySelector('[data-correction-renewal]')

  const currentService = item.name || ''
  serviceSelect.querySelector('[data-custom-service]')?.remove()
  if (currentService && !KNOWN_SERVICES.includes(currentService)) {
    const customOption = document.createElement('option')
    customOption.value = currentService
    customOption.textContent = currentService
    customOption.dataset.customService = 'true'
    serviceSelect.prepend(customOption)
  }
  serviceSelect.value = currentService
  serviceSelect.dataset.initial = currentService
  applyServiceIcon(serviceIconEl, currentService)

  const planValue = item.plan && item.plan !== 'Plan not provided' ? item.plan : ''
  planInput.value = planValue
  planInput.dataset.initial = planValue

  const priceValue = typeof item.cost === 'number' ? String(item.cost) : ''
  priceInput.value = priceValue
  priceInput.dataset.initial = priceValue

  const currencyValue = item.currency || ''
  currencySelect.value = currencyValue
  currencySelect.dataset.initial = currencyValue

  const cadenceValue = item.cadence === 'yearly' ? 'yearly' : 'monthly'
  cadenceSelect.value = cadenceValue
  cadenceSelect.dataset.initial = cadenceValue

  const renewalIso = item.next && item.next !== 'Not provided' ? toIsoDate(item.next) : ''
  renewalInput.value = renewalIso
  renewalInput.dataset.initial = renewalIso

  root.querySelector('[data-correction-error]').hidden = true
  root.querySelector('[data-correction-submit]').disabled = true
}

// Wired once (the dialog is persistent shell, not re-created per subscription):
// keeps the service icon in sync with the select, and Save disabled until at
// least one field actually differs from where it started.
export const wireCorrectionDialogInteractions = (root) => {
  const serviceSelect = root.querySelector('[data-correction-service]')
  const serviceIconEl = root.querySelector('[data-correction-service-icon]')
  serviceSelect.addEventListener('change', () => applyServiceIcon(serviceIconEl, serviceSelect.value))

  const submitButton = root.querySelector('[data-correction-submit]')
  const fields = ['[data-correction-service]', '[data-correction-plan]', '[data-correction-price]', '[data-correction-currency]', '[data-correction-cadence]', '[data-correction-renewal]'].map(selector => root.querySelector(selector))
  const updateSaveState = () => { submitButton.disabled = fields.every(field => field.value === field.dataset.initial) }
  fields.forEach(field => { field.addEventListener('input', updateSaveState); field.addEventListener('change', updateSaveState) })
}

// Diffs the form against the values renderCorrectionDialog stamped in, and
// returns only the fields that actually changed, each already coerced to the
// shape PATCH /api/v1/subscriptions/:id expects. An untouched field is never
// included, so it never becomes "Confirmed by you" just because the form was
// submitted (FEATURE-002).
export const collectChangedCorrections = (root) => {
  const serviceSelect = root.querySelector('[data-correction-service]')
  const planInput = root.querySelector('[data-correction-plan]')
  const priceInput = root.querySelector('[data-correction-price]')
  const currencySelect = root.querySelector('[data-correction-currency]')
  const cadenceSelect = root.querySelector('[data-correction-cadence]')
  const renewalInput = root.querySelector('[data-correction-renewal]')

  const changes = []
  if (serviceSelect.value && serviceSelect.value !== serviceSelect.dataset.initial) changes.push({ field: 'canonicalService', value: serviceSelect.value })
  const plan = planInput.value.trim()
  if (plan && plan !== planInput.dataset.initial) changes.push({ field: 'plan', value: plan })
  if (priceInput.value !== '' && priceInput.value !== priceInput.dataset.initial) {
    const parsed = Number(priceInput.value)
    if (Number.isFinite(parsed)) changes.push({ field: 'currentPrice', value: parsed })
  }
  if (currencySelect.value && currencySelect.value !== currencySelect.dataset.initial) changes.push({ field: 'currency', value: currencySelect.value })
  if (cadenceSelect.value !== cadenceSelect.dataset.initial) changes.push({ field: 'billingCycle', value: cadenceSelect.value })
  if (renewalInput.value && renewalInput.value !== renewalInput.dataset.initial) changes.push({ field: 'nextRenewal', value: renewalInput.value })
  return changes
}
