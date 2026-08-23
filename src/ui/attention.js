import { serviceIconMarkup } from '../services/serviceIcons.js'

const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])

export const actionCard = (action) => `<article class="action-card"><p class="action-label">${escapeHtml(action.label)}</p><h3 class="affected-services">${escapeHtml(action.affectedServices.join(' + '))}</h3><p>${escapeHtml(action.body)}</p>${action.saving ? `<p class="impact"><span>${escapeHtml(action.impactLabel)}</span><strong>${escapeHtml(action.saving)}</strong></p>` : ''}<div><button class="primary-button" data-action-target="${escapeHtml(action.id)}" type="button">Review subscription</button>${action.secondary ? `<button class="quiet-button" type="button">${escapeHtml(action.secondary)}</button>` : ''}</div></article>`

// FEATURE-002: an ambiguous candidate is a pending review item, never an
// active subscription - it visually differs from a confirmed subscription
// row (no chevron/no detail link, an explicit "Uncertain" tag, and an
// evidence-count line) and never contributes to confirmed recurring spend
// until the user confirms it.
export const candidateRow = (candidate) => {
  const evidence = candidate.evidence || []
  const priced = [...evidence].reverse().find((entry) => typeof entry.amount === 'number' && entry.currency)
  const priceLabel = priced ? `${money(priced.amount)}${priced.cadence ? ` every ${priced.cadence === 'yearly' ? 'year' : 'month'}` : ''}` : ''
  return `<article class="candidate-row" data-candidate-id="${escapeHtml(candidate.id)}">${serviceIconMarkup(candidate.canonicalService)}<div class="candidate-info"><div class="candidate-title"><strong>${escapeHtml(candidate.canonicalService)}</strong>${priceLabel ? `<span class="candidate-price">${escapeHtml(priceLabel)}</span>` : ''}<span class="uncertain-tag">Uncertain</span></div><span>Possible subscription${candidate.rawMerchant && candidate.rawMerchant !== candidate.canonicalService ? ` · ${escapeHtml(candidate.rawMerchant)}` : ''}</span><div class="candidate-why"><strong>Why we're unsure</strong><p>We found ${evidence.length} receipt${evidence.length === 1 ? '' : 's'} but couldn't confirm this is a subscription.</p></div></div><div class="candidate-actions"><button class="primary-button" data-confirm-candidate type="button" aria-label="Confirm ${escapeHtml(candidate.canonicalService)} as a subscription">Confirm subscription</button><button class="quiet-button" data-reject-candidate type="button" aria-label="${escapeHtml(candidate.canonicalService)} is not a subscription">Not a subscription</button></div></article>`
}

export const attentionPageMarkup = ({ actions = [], candidates = [] }) => `<div class="main-content wrap" id="page-attention"><header class="page-header"><div><p class="eyebrow">${actions.length + candidates.length} to review</p><h1>Worth your attention</h1><p>Things Subtle AI believes may need a decision.</p></div></header>

<section class="panel-card attention-full" aria-labelledby="attention-title"><div class="panel-head"><h2 id="attention-title">Needs a decision</h2>${actions.length ? `<span class="count-badge">${actions.length}</span>` : ''}</div><div class="action-feed">${actions.length ? actions.map(actionCard).join('') : '<p class="empty-state">Nothing needs your attention right now.</p>'}</div></section>

<section class="panel-card candidates-full" aria-labelledby="candidates-title"><div class="panel-head"><h2 id="candidates-title">Needs your review</h2><span class="count-badge">${candidates.length}</span></div><p class="section-hint">Items Subtle AI is unsure about won't affect your totals until you decide.</p><div class="candidate-list">${candidates.length ? candidates.map(candidateRow).join('') : '<p class="empty-state">Nothing to review right now.</p>'}</div></section>
</div>`
