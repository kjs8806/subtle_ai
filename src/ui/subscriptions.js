import { serviceIconMarkup } from '../services/serviceIcons.js'
import { NAV_ICONS } from './navigation.js'
import { routePath } from './router.js'

const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const attentionFor = (item) => item.takeTone !== 'good' ? item.signal : ''
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])

// A real link to the subscription's own route (not a button opening a modal) -
// "clicking anywhere on the row" navigates, and the URL itself is shareable/
// bookmarkable/back-forward-able like any other destination.
export const subscriptionRow = (item, discovered = false) => {
  const attention = attentionFor(item)
  const unitPrice = typeof item.cost === 'number' ? (item.cadence === 'yearly' ? item.cost / 12 : item.cost) : null
  const href = item.remoteId ? `#${routePath('subscription-detail', { id: item.remoteId })}` : `#${routePath('subscription-detail', { id: item.id })}`
  return `<a class="subscription-row${discovered ? ' discovered' : ''}" href="${href}" data-subscription-id="${escapeHtml(item.id)}" aria-label="Review ${escapeHtml(item.name)} ${escapeHtml(item.plan)}">${serviceIconMarkup(item.name)}<span class="subscription-name"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.plan)}${attention ? ` · <em>${escapeHtml(attention)}</em>` : ''}</span></span><span class="subscription-price">${money(unitPrice)}${unitPrice !== null ? '<small>/mo</small>' : ''}</span><span class="subscription-next"><small>Next renewal</small>${escapeHtml(item.next)}</span><span class="chevron">${NAV_ICONS.chevron}</span></a>`
}

export const subscriptionsPageMarkup = ({ subscriptions = [] }) => `<div class="main-content wrap" id="page-subscriptions"><header class="page-header"><div><p class="eyebrow">${subscriptions.length} subscriptions</p><h1>Subscriptions</h1><p>Everything Subtle AI currently believes you're paying for.</p></div><button class="secondary-button" data-open-add type="button">Add subscription</button></header><section class="panel-card subscriptions-full" aria-label="Your subscriptions"><div class="subscription-list">${subscriptions.length ? subscriptions.map(item => subscriptionRow(item)).join('') : '<p class="empty-state">No subscriptions yet. Connect Gmail from Sources or add one manually.</p>'}</div></section></div>`
