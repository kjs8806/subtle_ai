const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'

// FEATURE-002: maps the UI-facing field keys already used elsewhere in this
// file (the same keys fieldProvenance was already called with) to the
// snake_case field name subscription_corrections/correction_conflicts record
// server-side (see migrations/008_feature_002_corrections.sql and
// server/app.js's CORRECTION_FIELD_MAP).
export const CORRECTION_FIELD_FOR = { canonicalService: 'canonical_service', plan: 'plan', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }
// The reverse of the API's CORRECTION_FIELD_MAP - the field select below
// submits these camelCase keys directly to PATCH /api/v1/subscriptions/:id.
export const CORRECTABLE_FIELDS = [
  { value: 'canonicalService', label: 'Service name' },
  { value: 'plan', label: 'Plan' },
  { value: 'currentPrice', label: 'Price' },
  { value: 'currency', label: 'Currency (USD or CAD)' },
  { value: 'billingCycle', label: 'Billing cadence (monthly or yearly)' },
  { value: 'nextRenewal', label: 'Next renewal date' },
]

export const detailMarkup = () => `<div class="dialog-backdrop" data-detail hidden><section class="dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button class="dialog-close" data-close-dialog aria-label="Close subscription detail">×</button><header class="detail-identity"><p class="eyebrow">What am I paying?</p><h2 id="detail-title"></h2><span data-detail-plan></span><div class="cost-grid"><p><span>Current cost</span><strong data-detail-cost></strong></p><p><span>Next charge</span><strong data-detail-next></strong></p><p><span>Annualized cost</span><strong data-detail-annual></strong></p></div></header><section data-notice><h3>What did Subtle notice?</h3><strong data-notice-title></strong><p data-notice-copy></p><p data-saving hidden><span>Potential savings</span> <strong></strong></p></section><section class="evidence"><h3>How do we know?</h3><dl><div><dt>Current cost</dt><dd data-cost-source></dd></div><div><dt>Billing cadence</dt><dd data-cadence-source></dd></div><div><dt>Next charge</dt><dd data-renewal-source></dd></div><div><dt>Last confirmed</dt><dd data-confirmed></dd></div><div><dt>Evidence confidence</dt><dd data-confidence></dd></div></dl></section><details><summary>Price history</summary><div data-price-history></div></details><details><summary>Billing history</summary><div data-billing-history></div></details><section class="detail-corrections" data-detail-corrections><h3>Something not right?</h3><p class="conflict-notice" data-conflict-notice hidden></p><form class="correction-form" data-correction-form><label>Field<select name="field" data-correction-field>${CORRECTABLE_FIELDS.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('')}</select></label><p>Current value: <strong data-correction-current></strong></p><label>Corrected value<input name="value" data-correction-value required autocomplete="off"></label><p class="form-error" data-correction-error hidden role="alert"></p><button class="primary-button" type="submit">Save correction</button></form><button class="quiet-button" data-open-reject type="button">Not a subscription</button></section></section></div>`

// A dedicated confirmation dialog for "Not a subscription" - consequential
// (it stops the item counting as active spend) but not destructive (evidence
// is preserved), so it gets a clear explanatory step rather than a native
// confirm() or an instant action.
export const rejectConfirmMarkup = () => `<div class="dialog-backdrop" data-reject-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="reject-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Not a subscription</p><h2 id="reject-title">Stop counting this as a subscription?</h2><p>This removes <strong data-reject-name></strong> from your subscription list and recurring spend total. Its receipt evidence is kept, and this can be corrected again later.</p><div class="dialog-actions"><button class="primary-button" data-confirm-reject type="button">Yes, not a subscription</button><button class="quiet-button" data-close-dialog type="button">Cancel</button></div></section></div>`

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

export const renderDetail = (root, item, controller) => {
  const monthlyCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const annualCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost : item.cost * 12) : null
  root.dataset.subscriptionId = item.remoteId || ''
  root.querySelector('#detail-title').textContent = item.name
  root.querySelector('[data-detail-plan]').textContent = item.plan
  root.querySelector('[data-detail-cost]').textContent = monthlyCost === null ? money(null) : `${money(monthlyCost)} / month`
  root.querySelector('[data-detail-next]').textContent = item.next
  root.querySelector('[data-detail-annual]').textContent = money(annualCost)
  const notice = root.querySelector('[data-notice]'); notice.hidden = item.takeTone === 'good'
  root.querySelector('[data-notice-title]').textContent = item.analysisTitle; root.querySelector('[data-notice-copy]').textContent = item.analysisCopy
  const saving = root.querySelector('[data-saving]'); saving.hidden = !item.comparison; if (item.comparison) saving.querySelector('strong').textContent = item.comparison.savings
  root.querySelector('[data-cost-source]').textContent = fieldProvenance(item, 'amount')
  root.querySelector('[data-cadence-source]').textContent = fieldProvenance(item, 'cadence')
  root.querySelector('[data-renewal-source]').textContent = fieldProvenance(item, 'nextRenewal')
  root.querySelector('[data-confirmed]').textContent = item.confirmed || 'Not provided'; root.querySelector('[data-confidence]').textContent = item.confidence || 'Not provided'
  const renderHistory = (container, rows) => {
    container.replaceChildren(...rows.map(([date, value]) => {
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
  const correctionsSection = root.querySelector('[data-detail-corrections]')
  correctionsSection.hidden = !item.remoteId
  if (item.remoteId) {
    const fieldSelect = root.querySelector('[data-correction-field]')
    const currentValueEl = root.querySelector('[data-correction-current]')
    const valueInput = root.querySelector('[data-correction-value]')
    const updateCurrentValue = () => {
      const value = correctionFieldValue(item, fieldSelect.value)
      currentValueEl.textContent = value === '' || value === null || value === undefined ? 'Not provided' : String(value)
      valueInput.value = ''
    }
    fieldSelect.onchange = updateCurrentValue
    updateCurrentValue()
    root.querySelector('[data-correction-error]').hidden = true

    const conflicts = item.pipelineRecord?.conflicts || []
    const conflictNotice = root.querySelector('[data-conflict-notice]')
    conflictNotice.hidden = conflicts.length === 0
    if (conflicts.length) conflictNotice.textContent = `A newer receipt reported a different value than your correction for ${conflicts.length === 1 ? 'one field' : `${conflicts.length} fields`}. Your correction is being kept.`
  }
  controller.open(document.activeElement)
}
