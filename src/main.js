import './style.css'
import { feature001Api } from './services/feature001Api.js'
import { toDisplayItem, toManualDisplayItem } from './services/subscriptionMapper.js'
import { monthlySpendFor } from './data/subscriptionModel.js'
import { createDialogController, createLiveRegion } from './ui/accessibility.js'
import { gmailDisclosureMarkup } from './ui/gmailDisclosure.js'
import { initializeNavigation, navigationMarkup } from './ui/navigation.js'
import { overviewMarkup, subscriptionRow } from './ui/overview.js'
import { detailMarkup, renderDetail } from './ui/subscriptionDetail.js'
import { loadingMarkup, sessionErrorMarkup, signedOutMarkup } from './ui/signedOut.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'your AI subscription optimizer' }
const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const brand = `<a class="brand" href="#overview" aria-label="${APP_CONFIG.name} home"><span class="brand-mark" aria-hidden="true">s</span><span>${APP_CONFIG.name}</span></a>`
const shellHeader = `<header class="global-nav wrap">${brand}</header>`
const addDialogMarkup = `<div class="dialog-backdrop" data-add-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Manual entry</p><h2 id="add-title">Add a subscription</h2><form class="subscription-form"><label>Service name<input name="name" placeholder="e.g. Netflix" required></label><div class="form-row"><label>Cost<input name="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="22.99" required></label><label>Billing cadence<select name="cadence"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><button class="primary-button form-submit" type="submit">Add to overview</button></form></section></div>`

document.title = `${APP_CONFIG.name} — ${APP_CONFIG.tagline}`
const app = document.querySelector('#app')
const live = createLiveRegion()

// A subscription's `next` field is either an ISO timestamp (backend-derived) or
// the literal 'Not provided' - only the former can be sorted/formatted as a date.
const deriveUpcoming = (items) => items
  .map((item) => ({ item, date: new Date(item.next) }))
  .filter(({ date }) => !Number.isNaN(date.getTime()))
  .sort((a, b) => a.date - b.date)
  .slice(0, 3)
  .map(({ item, date }) => ({ name: item.name, date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), amount: money(item.cost) }))

const renderSessionError = (message) => {
  app.innerHTML = shellHeader + sessionErrorMarkup(message)
  const retry = document.querySelector('[data-retry-session]')
  retry.addEventListener('click', boot)
  // Full-view transitions (unlike dialogs) replace whatever previously held
  // focus, so it must be moved deliberately rather than left to fall back to
  // <body>.
  retry.focus()
}

const renderSignedOut = () => {
  app.innerHTML = shellHeader + signedOutMarkup()
  const button = document.querySelector('[data-google-sign-in]')
  const errorEl = document.querySelector('[data-session-error]')
  button.focus()
  button.addEventListener('click', async () => {
    button.disabled = true
    errorEl.hidden = true
    try {
      const { url } = await feature001Api.startGoogleSignIn()
      if (!url) throw new Error('No authorization URL returned')
      window.location.href = url
    } catch {
      errorEl.hidden = false
      errorEl.textContent = "Sign-in couldn't start. Please try again."
      button.disabled = false
    }
  })
}

const renderAuthenticated = async (user) => {
  // Manual entries are frontend-only (no manual-subscription API exists), so
  // they're tracked separately from backend-sourced ones and always re-merged -
  // a Gmail-triggered refresh must never make them disappear.
  let manualSubscriptions = []
  let backendItems = []
  let gmailSource = { status: 'not_connected', scanStatus: 'idle' }
  let gmailSourceUnavailable = false

  const [subsResult, sourceResult] = await Promise.allSettled([
    feature001Api.listSubscriptions(),
    feature001Api.getGmailSource(),
  ])
  if (subsResult.status === 'fulfilled') backendItems = (subsResult.value.subscriptions || []).map(toDisplayItem)
  if (sourceResult.status === 'fulfilled') gmailSource = sourceResult.value
  else gmailSourceUnavailable = true

  const greeting = user?.name ? `Good morning, ${user.name.split(' ')[0]}.` : 'Good morning.'
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const allItems = () => [...manualSubscriptions, ...backendItems]

  app.innerHTML = `<main class="app-shell">${navigationMarkup(brand)}${overviewMarkup({ subscriptions: allItems(), actions: [], monthlySpend: monthlySpendFor(allItems()), upcoming: deriveUpcoming(allItems()), greeting, dateLabel })}<footer class="app-footer wrap">${brand}<div><span>Private by design</span><button class="quiet-button" data-sign-out type="button">Sign out</button></div></footer></main>${gmailDisclosureMarkup()}${detailMarkup()}${addDialogMarkup}`

  initializeNavigation(app)
  const detailRoot = document.querySelector('[data-detail]'); const detailDialog = createDialogController(detailRoot)
  const gmailRoot = document.querySelector('[data-gmail-dialog]'); const gmailDialog = createDialogController(gmailRoot)
  const addRoot = document.querySelector('[data-add-dialog]'); const addDialog = createDialogController(addRoot)
  const status = document.querySelector('[data-gmail-status]'); const message = document.querySelector('[data-gmail-message]')
  const gmailButton = document.querySelector('[data-gmail-action]'); const disconnectButton = document.querySelector('[data-gmail-disconnect]')
  const discovery = document.querySelector('[data-discovery-result]')

  const findSubscription = id => allItems().find(item => String(item.id) === String(id))
  const wireRows = root => root.querySelectorAll('[data-subscription-id]:not([data-wired])').forEach(row => { row.dataset.wired = ''; row.addEventListener('click', () => openDetail(row.dataset.subscriptionId)) })

  const openDetail = async (id) => {
    const summary = findSubscription(id)
    if (!summary) return
    // Manual entries have no backend record to re-fetch; render what's local.
    if (!summary.remoteId) { renderDetail(detailRoot, summary, detailDialog); return }
    try {
      const record = await feature001Api.getSubscription(summary.remoteId)
      renderDetail(detailRoot, toDisplayItem(record), detailDialog)
    } catch {
      renderDetail(detailRoot, summary, detailDialog)
      live.announce('Latest evidence could not be loaded; showing the last known details.')
    }
  }

  const renderList = ({ newIds = new Set() } = {}) => {
    const items = allItems()
    document.querySelector('[data-spend]').textContent = money(monthlySpendFor(items))
    document.querySelector('[data-count]').textContent = items.length
    const list = document.querySelector('.subscription-list')
    list.innerHTML = items.length ? items.map(item => subscriptionRow(item, newIds.has(item.id))).join('') : '<p class="empty-state">No subscriptions yet. Connect Gmail or add one manually.</p>'
    wireRows(list)
    const upcoming = deriveUpcoming(items)
    document.querySelector('.renewals').innerHTML = upcoming.length ? upcoming.map(item => `<p><strong>${item.name}</strong><span>${item.date}</span><b>${item.amount}</b></p>`).join('') : '<p class="empty-state">No upcoming renewals detected yet.</p>'
  }
  wireRows(document)

  document.querySelector('[data-sign-out]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true
    try { await feature001Api.logout() } catch { /* session cookie is cleared server-side regardless of network hiccups on our end */ }
    boot()
  })

  document.querySelector('[data-open-add]').addEventListener('click', event => addDialog.open(event.currentTarget))
  addRoot.querySelector('form').addEventListener('submit', event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = data.get('name').trim(); const cost = Number(data.get('cost')); const cadence = data.get('cadence')
    const item = toManualDisplayItem({ name, cost, cadence })
    manualSubscriptions.push(item)
    renderList()
    event.currentTarget.reset(); addDialog.close(); live.announce(`${name} added.`)
  })

  const setGmailState = (state, copy, action, { disabled = false } = {}) => {
    status.textContent = state; message.textContent = copy; gmailButton.dataset.gmailAction = action
    gmailButton.textContent = action === 'scan' ? 'Scan receipts' : 'Find subscriptions from receipts'
    gmailButton.disabled = disabled
    disconnectButton.hidden = gmailSource.status !== 'connected'
  }

  const applyGmailSource = () => {
    if (gmailSourceUnavailable) { setGmailState('Unavailable', "Gmail status couldn't be loaded. Try refreshing the page.", 'connect', { disabled: true }); return }
    if (gmailSource.status !== 'connected') { setGmailState('Not connected', 'Connect to discover receipts', 'connect'); return }
    if (gmailSource.scanStatus === 'scanning') { setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true }); return }
    if (gmailSource.scanStatus === 'error') { setGmailState('Scan error', "The last scan failed. You can try again.", 'scan'); return }
    setGmailState('Connected', 'Ready to scan receipts', 'scan')
  }
  applyGmailSource()

  const showDiscovery = items => {
    discovery.hidden = false; discovery.innerHTML = `<strong>${items.length} subscription${items.length === 1 ? '' : 's'} found.</strong><button class="primary-button" type="button">Review subscription${items.length === 1 ? '' : 's'}</button>`
    discovery.querySelector('button').addEventListener('click', () => items.length === 1 ? openDetail(items[0].id) : (location.hash = 'subscriptions'))
  }

  const refreshGmailSource = async () => {
    try { gmailSource = await feature001Api.getGmailSource(); gmailSourceUnavailable = false }
    catch { gmailSourceUnavailable = true }
    applyGmailSource()
  }

  const runScan = async () => {
    if (gmailButton.disabled) return
    discovery.hidden = true
    setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true }); live.announce('Scanning receipts…')
    try {
      const result = await feature001Api.scanGmail()
      const previousIds = new Set(allItems().map(item => item.id))
      const { subscriptions: rawList } = await feature001Api.listSubscriptions()
      backendItems = (rawList || []).map(toDisplayItem)
      const newIds = new Set(allItems().filter(item => !previousIds.has(item.id)).map(item => item.id))
      renderList({ newIds })
      await refreshGmailSource()
      const copy = result.found ? `${result.found} subscription${result.found === 1 ? '' : 's'} found.` : 'No qualifying subscription receipts found.'
      live.announce(copy)
      const discovered = allItems().filter(item => newIds.has(item.id))
      if (discovered.length) showDiscovery(discovered)
    } catch (error) {
      if (error.code === 'scan_already_running') { setGmailState('Scanning', 'A scan is already running…', 'scan', { disabled: true }); live.announce('A scan is already in progress.') }
      else if (error.code === 'source_not_connected') { await refreshGmailSource(); live.announce('Connect Gmail before scanning.') }
      else { setGmailState('Scan error', "Gmail is connected, but receipts couldn't be scanned. You can try again.", 'scan'); live.announce("Receipts could not be scanned.") }
    }
  }

  const connectGmail = async () => {
    try {
      const result = await feature001Api.authorizeGmail()
      if (result.url) { window.location.href = result.url; return }
      // The mock provider connects synchronously with no redirect.
      await refreshGmailSource()
      if (gmailSource.status === 'connected') await runScan()
    } catch {
      setGmailState('Not connected', "Gmail couldn't be connected. Please try again.", 'connect')
      live.announce("Gmail couldn't be connected.")
    }
  }

  gmailButton.addEventListener('click', event => gmailButton.dataset.gmailAction === 'scan' ? runScan() : gmailDialog.open(event.currentTarget))
  gmailRoot.querySelector('[data-continue-gmail]').addEventListener('click', async event => {
    event.currentTarget.disabled = true
    setGmailState('Authorizing', 'Waiting for Gmail authorization…', 'connect', { disabled: true }); live.announce('Waiting for Gmail authorization.')
    gmailDialog.close()
    await connectGmail()
    event.currentTarget.disabled = false
  })

  disconnectButton.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true
    setGmailState('Disconnecting', 'Disconnecting Gmail…', 'scan', { disabled: true }); live.announce('Disconnecting Gmail…')
    try {
      await feature001Api.disconnectGmail()
      const { subscriptions: rawList } = await feature001Api.listSubscriptions()
      backendItems = (rawList || []).map(toDisplayItem)
      renderList()
      await refreshGmailSource()
      live.announce('Gmail disconnected.')
    } catch {
      applyGmailSource()
      live.announce("Gmail couldn't be disconnected. Please try again.")
    } finally {
      event.currentTarget.disabled = false
    }
  })

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

async function boot() {
  app.innerHTML = shellHeader + loadingMarkup()
  let session
  try {
    session = await feature001Api.getSession()
  } catch {
    renderSessionError("Subtle couldn't reach the server. Check your connection and try again.")
    return
  }
  if (!session.authenticated) { renderSignedOut(); return }
  await renderAuthenticated(session.user)
}

boot()
