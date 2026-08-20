import './style.css'
import { demoSubscriptions, savingsActions } from './data/demoSubscriptions.js'
import { createPipelineRecords, monthlySpendFor } from './data/subscriptionModel.js'
import { feature001Api } from './services/feature001Api.js'
import { createDialogController, createLiveRegion } from './ui/accessibility.js'
import { gmailDisclosureMarkup } from './ui/gmailDisclosure.js'
import { initializeNavigation, navigationMarkup } from './ui/navigation.js'
import { overviewMarkup, subscriptionRow } from './ui/overview.js'
import { detailMarkup, renderDetail } from './ui/subscriptionDetail.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'your AI subscription optimizer' }
const subscriptions = demoSubscriptions.map(item => ({ ...item }))
createPipelineRecords(subscriptions).forEach((record, index) => { subscriptions[index].pipelineRecord = record })
const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const brand = `<a class="brand" href="#overview" aria-label="${APP_CONFIG.name} home"><span class="brand-mark" aria-hidden="true">s</span><span>${APP_CONFIG.name}</span></a>`

document.title = `${APP_CONFIG.name} — ${APP_CONFIG.tagline}`
const app = document.querySelector('#app')
app.innerHTML = `<main class="app-shell">${navigationMarkup(brand)}${overviewMarkup({ subscriptions, actions: savingsActions, monthlySpend: monthlySpendFor(subscriptions) })}<footer class="app-footer wrap">${brand}<span>Private by design</span></footer></main>${gmailDisclosureMarkup()}${detailMarkup()}<div class="dialog-backdrop" data-add-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><h2 id="add-title">Add a subscription</h2><form><label>Service name<input required></label><button class="primary-button" type="submit">Add to overview</button></form></section></div>`

initializeNavigation(app)
const live = createLiveRegion()
const detailRoot = document.querySelector('[data-detail]'); const detailDialog = createDialogController(detailRoot)
const gmailRoot = document.querySelector('[data-gmail-dialog]'); const gmailDialog = createDialogController(gmailRoot)
const addRoot = document.querySelector('[data-add-dialog]'); const addDialog = createDialogController(addRoot)
const status = document.querySelector('[data-gmail-status]'); const message = document.querySelector('[data-gmail-message]'); const gmailButton = document.querySelector('[data-gmail-action]'); const discovery = document.querySelector('[data-discovery-result]')

const findSubscription = id => subscriptions.find(item => String(item.id) === String(id))
const wireRows = root => root.querySelectorAll('[data-subscription-id]:not([data-wired])').forEach(row => { row.dataset.wired = ''; row.addEventListener('click', () => renderDetail(detailRoot, findSubscription(row.dataset.subscriptionId), detailDialog)) })
wireRows(document)
document.querySelectorAll('[data-action-target]').forEach(button => button.addEventListener('click', () => {
  const names = { overlap: 'Dropbox', renewal: 'NordVPN', price: 'Canva' }
  renderDetail(detailRoot, subscriptions.find(item => item.name === names[button.dataset.actionTarget]), detailDialog)
}))
document.querySelector('[data-open-add]').addEventListener('click', event => addDialog.open(event.currentTarget))
addRoot.querySelector('form').addEventListener('submit', event => { event.preventDefault(); addDialog.close(); live.announce('Subscription entry ready to be added.') })

const setGmailState = (state, copy, action = 'connect') => {
  status.textContent = state; message.textContent = copy; gmailButton.dataset.gmailAction = action
  gmailButton.textContent = action === 'scan' ? 'Scan receipts' : 'Find subscriptions from receipts'
}
const addDiscovered = records => records.map(record => {
  const existing = subscriptions.find(item => item.remoteId === record.id); if (existing) return existing
  const item = { id: record.id, remoteId: record.id, name: record.canonicalService, plan: record.plan || 'Plan not provided', category: 'Other', cost: record.currentPrice, cadence: record.billingCycle === 'yearly' ? 'yearly' : 'monthly', next: record.nextRenewal || 'Not provided', icon: record.canonicalService.charAt(0), tone: 'blue', takeTone: 'review', signal: 'New from receipt', analysisTitle: 'Receipt-backed discovery', analysisCopy: 'Review the detected fields and receipt evidence for this subscription.', source: 'Gmail receipt', confirmed: record.evidence?.[0]?.receivedAt || 'Not provided', confidence: record.confidence?.state || 'Receipt evidence', history: (record.priceHistory || []).map(value => [value.observedAt, money(value.amount)]), bills: (record.billingHistory || []).map(value => [value.billedAt, money(value.amount)]), pipelineRecord: record }
  subscriptions.push(item); document.querySelector('.subscription-list').insertAdjacentHTML('beforeend', subscriptionRow(item, true)); const row = document.querySelector(`[data-subscription-id="${CSS.escape(String(item.id))}"]`); wireRows(row.parentElement); return item
})
const showDiscovery = items => {
  discovery.hidden = false; discovery.innerHTML = `<strong>${items.length} subscription${items.length === 1 ? '' : 's'} found.</strong><button class="primary-button" type="button">Review subscription${items.length === 1 ? '' : 's'}</button>`
  discovery.querySelector('button').addEventListener('click', event => items.length === 1 ? renderDetail(detailRoot, items[0], detailDialog) : (location.hash = 'subscriptions'))
}
const runScan = async () => {
  if (gmailButton.disabled) return
  gmailButton.disabled = true; setGmailState('Scanning', 'Scanning receipts…', 'scan'); live.announce('Scanning receipts…')
  try {
    const result = await feature001Api.scan(); const records = result.found ? (await feature001Api.listSubscriptions()).subscriptions : []; const items = addDiscovered(records)
    const copy = result.found ? `${result.found} subscription${result.found === 1 ? '' : 's'} found.` : 'No qualifying subscription receipts found.'
    setGmailState('Connected', copy, 'scan'); if (items.length) showDiscovery(items); live.announce(copy)
  } catch (error) { setGmailState('Connected', "Gmail is connected, but receipts couldn't be scanned.", 'scan'); live.announce(`Receipts could not be scanned. ${error.message}`) }
  finally { gmailButton.disabled = false }
}
gmailButton.addEventListener('click', event => gmailButton.dataset.gmailAction === 'scan' ? runScan() : gmailDialog.open(event.currentTarget))
gmailRoot.querySelector('[data-continue-gmail]').addEventListener('click', async event => {
  event.currentTarget.disabled = true; setGmailState('Authorizing', 'Waiting for Gmail authorization…'); live.announce('Waiting for Gmail authorization.')
  try { const authorization = await feature001Api.startAuthorization(); await feature001Api.completeAuthorization(authorization.url); gmailDialog.close(); setGmailState('Connected', 'Ready to scan receipts', 'scan'); await runScan() }
  catch { gmailDialog.close(); setGmailState('Not connected', "Gmail couldn't be connected."); live.announce("Gmail couldn't be connected.") }
  finally { event.currentTarget.disabled = false }
})

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
