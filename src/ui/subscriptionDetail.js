const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
export const detailMarkup = () => `<div class="dialog-backdrop" data-detail hidden><section class="dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button class="dialog-close" data-close-dialog aria-label="Close subscription detail">×</button><header class="detail-identity"><p class="eyebrow">What am I paying?</p><h2 id="detail-title"></h2><span data-detail-plan></span><div class="cost-grid"><p><span>Current cost</span><strong data-detail-cost></strong></p><p><span>Next charge</span><strong data-detail-next></strong></p><p><span>Annualized cost</span><strong data-detail-annual></strong></p></div></header><section data-notice><h3>What did Subtle notice?</h3><strong data-notice-title></strong><p data-notice-copy></p><p data-saving hidden><span>Potential savings</span> <strong></strong></p></section><section class="evidence"><h3>How do we know?</h3><dl><div><dt>Current cost</dt><dd data-cost-source></dd></div><div><dt>Billing cadence</dt><dd data-cadence-source></dd></div><div><dt>Next charge</dt><dd data-renewal-source></dd></div><div><dt>Last confirmed</dt><dd data-confirmed></dd></div><div><dt>Evidence confidence</dt><dd data-confidence></dd></div></dl></section><details><summary>Price history</summary><div data-price-history></div></details><details><summary>Billing history</summary><div data-billing-history></div></details></section></div>`

export const fieldProvenance = (item, field) => {
  if (item.source === 'Manual entry') return 'User provided'
  const observation = [...(item.pipelineRecord?.fieldObservations || [])].reverse().find(entry => entry.field === field)
  const state = observation?.provenance || item.pipelineRecord?.confidence?.state
  if (state === 'confirmed') return `Confirmed from ${item.source}`
  if (state === 'inferred') return `Inferred from ${item.source}`
  return `Source: ${item.source || 'Not provided'}`
}

export const renderDetail = (root, item, controller) => {
  const monthlyCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const annualCost = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost : item.cost * 12) : null
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
  root.querySelector('[data-price-history]').innerHTML = item.history.map(([date, value]) => `<p><span>${date}</span><strong>${value}</strong></p>`).join('')
  root.querySelector('[data-billing-history]').innerHTML = item.bills.map(([date, value]) => `<p><span>${date}</span><strong>${value}</strong></p>`).join('')
  controller.open(document.activeElement)
}
