import './style.css'
import { feature001Api } from './services/feature001Api.js'
import { toDisplayItem, toManualDisplayItem } from './services/subscriptionMapper.js'
import { toAttentionAction } from './services/attentionMapper.js'
import { monthlySpendFor } from './data/subscriptionModel.js'
import { createDialogController, createLiveRegion } from './ui/accessibility.js'
import { gmailDisclosureMarkup } from './ui/gmailDisclosure.js'
import { initializeNavigation, navigationMarkup } from './ui/navigation.js'
import { actionCard, candidateRow, overviewMarkup, subscriptionRow } from './ui/overview.js'
import { detailMarkup, rejectConfirmMarkup, renderDetail } from './ui/subscriptionDetail.js'
import { loadingMarkup, sessionErrorMarkup, signedOutMarkup } from './ui/signedOut.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'your AI subscription optimizer' }
const money = value => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
const brandMark = `<svg class="brand-mark" viewBox="0 0 192 192" width="32" height="32" aria-hidden="true"><rect width="192" height="192" rx="44" fill="var(--coral)"/><text x="96" y="132" text-anchor="middle" fill="var(--paper)" font-family="Georgia, serif" font-size="124" font-style="italic">s</text></svg>`
const brand = `<a class="brand" href="#overview" aria-label="${APP_CONFIG.name} home">${brandMark}<span>${APP_CONFIG.name}</span></a>`
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

// The OAuth callbacks are reached via a real top-level browser navigation (see
// server/app.js), so they redirect back to '/' with the outcome carried as a
// query param rather than a JSON body the frontend could read directly. This
// reads that signal once on boot and strips it so a page refresh doesn't
// re-show a stale error.
const AUTH_ERROR_MESSAGES = {
  invalid_oauth_state: 'That sign-in attempt expired or was invalid. Please try again.',
  missing_subject: "Google sign-in didn't return the information we needed. Please try again.",
  cancelled: 'Sign-in was cancelled.',
}
const GMAIL_ERROR_MESSAGES = {
  invalid_oauth_state: 'That connection attempt expired or was invalid. Please try again.',
  identity_mismatch: 'The Gmail account you selected does not match the Google account you signed in with.',
  missing_refresh_token: 'Gmail did not grant access. Please try connecting again.',
  cancelled: 'Gmail connection was cancelled.',
}
const consumeRedirectSignal = () => {
  const params = new URLSearchParams(location.search)
  const authError = params.get('auth_error')
  const gmailError = params.get('gmail_error')
  if (authError || gmailError) history.replaceState(null, '', location.pathname + location.hash)
  return { authError, gmailError }
}

const renderSessionError = (message) => {
  app.innerHTML = shellHeader + sessionErrorMarkup(message)
  const retry = document.querySelector('[data-retry-session]')
  retry.addEventListener('click', boot)
  // Full-view transitions (unlike dialogs) replace whatever previously held
  // focus, so it must be moved deliberately rather than left to fall back to
  // <body>.
  retry.focus()
}

const renderSignedOut = (initialError) => {
  app.innerHTML = shellHeader + signedOutMarkup()
  const button = document.querySelector('[data-google-sign-in]')
  const errorEl = document.querySelector('[data-session-error]')
  if (initialError) { errorEl.hidden = false; errorEl.textContent = initialError }
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

const renderAuthenticated = async (user, gmailError) => {
  // Manual entries are frontend-only (no manual-subscription API exists), so
  // they're tracked separately from backend-sourced ones and always re-merged -
  // a Gmail-triggered refresh must never make them disappear.
  let manualSubscriptions = []
  let backendItems = []
  let candidates = []
  // FEATURE-003: the "Worth your attention" feed - material price-change
  // events and renewal reminders from GET /api/v1/subscriptions/attention,
  // mapped into the action-card shape overview.js's actionCard() expects.
  let actions = []
  let gmailSource = { status: 'not_connected', scanStatus: 'idle' }
  let gmailSourceUnavailable = false

  const [subsResult, sourceResult, candidatesResult, attentionResult] = await Promise.allSettled([
    feature001Api.listSubscriptions(),
    feature001Api.getGmailSource(),
    feature001Api.listCandidates(),
    feature001Api.getAttention(),
  ])
  if (subsResult.status === 'fulfilled') backendItems = (subsResult.value.subscriptions || []).map(toDisplayItem)
  if (sourceResult.status === 'fulfilled') gmailSource = sourceResult.value
  else gmailSourceUnavailable = true
  if (candidatesResult.status === 'fulfilled') candidates = candidatesResult.value.candidates || []
  if (attentionResult.status === 'fulfilled') actions = (attentionResult.value.items || []).map(toAttentionAction)

  const greeting = user?.name ? `Good morning, ${user.name.split(' ')[0]}.` : 'Good morning.'
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const allItems = () => [...manualSubscriptions, ...backendItems]

  app.innerHTML = `<main class="app-shell">${navigationMarkup(brand)}${overviewMarkup({ subscriptions: allItems(), actions, monthlySpend: monthlySpendFor(allItems()), upcoming: deriveUpcoming(allItems()), candidates, greeting, dateLabel })}<footer class="app-footer wrap">${brand}<div><span>Private by design</span><button class="quiet-button" data-sign-out type="button">Sign out</button></div></footer></main>${gmailDisclosureMarkup()}${detailMarkup()}${rejectConfirmMarkup()}${addDialogMarkup}`

  initializeNavigation(app)
  const detailRoot = document.querySelector('[data-detail]'); const detailDialog = createDialogController(detailRoot)
  const gmailRoot = document.querySelector('[data-gmail-dialog]'); const gmailDialog = createDialogController(gmailRoot)
  const addRoot = document.querySelector('[data-add-dialog]'); const addDialog = createDialogController(addRoot)
  const rejectRoot = document.querySelector('[data-reject-dialog]'); const rejectDialog = createDialogController(rejectRoot)
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

  // FEATURE-003: "Worth your attention" feed. Re-rendered (not just fetched
  // once at boot) after any action that could change price-change/renewal
  // intelligence - a scan, a correction, a rejection, or a candidate
  // confirmation - so a stale attention item never lingers past the action
  // that resolved it. A fetch failure here leaves the last known feed in
  // place rather than clearing it, same defensive pattern as refreshGmailSource.
  const renderActions = () => {
    const section = document.querySelector('#attention')
    if (!section) return
    section.querySelector('.eyebrow').textContent = `${actions.length} actionable opportunities`
    section.querySelector('.action-feed').innerHTML = actions.length ? actions.map(actionCard).join('') : '<p class="empty-state">Nothing needs your attention right now.</p>'
  }
  const refreshAttention = async () => {
    try { actions = ((await feature001Api.getAttention()).items || []).map(toAttentionAction) }
    catch { /* the attention feed just keeps showing its last known state */ }
    renderActions()
  }
  // The feed is fully re-rendered each time, so a single delegated listener
  // (rather than re-wiring every card's button) is enough to open Subscription
  // Detail for the action's subscription - same target id used by wireRows.
  document.querySelector('.action-feed').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action-target]')
    if (!button) return
    openDetail(button.dataset.actionTarget)
  })

  // FEATURE-002: ambiguous-candidate review. Confirm/reject act on the whole
  // pending candidate, not a subscription (there is no subscription yet), and
  // both remove the candidate from the pending list either way.
  const renderCandidates = () => {
    const section = document.querySelector('#candidates-review')
    if (!section) return
    section.querySelector('.eyebrow').textContent = `${candidates.length} to review`
    section.querySelector('.candidate-list').innerHTML = candidates.length ? candidates.map(candidateRow).join('') : '<p class="empty-state">Nothing to review right now.</p>'
  }
  document.querySelector('.candidate-list').addEventListener('click', async (event) => {
    const confirmButton = event.target.closest('[data-confirm-candidate]')
    const rejectButton = event.target.closest('[data-reject-candidate]')
    const button = confirmButton || rejectButton
    if (!button) return
    const candidateId = event.target.closest('[data-candidate-id]')?.dataset.candidateId
    if (!candidateId) return
    button.disabled = true
    try {
      if (confirmButton) { await feature001Api.confirmCandidate(candidateId); live.announce('Subscription confirmed.') }
      else { await feature001Api.rejectCandidate(candidateId); live.announce('Marked as not a subscription.') }
      candidates = candidates.filter(candidate => candidate.id !== candidateId)
      renderCandidates()
      const { subscriptions: rawList } = await feature001Api.listSubscriptions()
      backendItems = (rawList || []).map(toDisplayItem)
      renderList()
      await refreshAttention()
    } catch {
      button.disabled = false
      live.announce("That couldn't be completed. Please try again.")
    }
  })

  // FEATURE-002: corrections ("This looks wrong") and "Not a subscription"
  // rejection, both scoped to the subscription id the detail dialog is
  // currently showing (renderDetail stamps it onto detailRoot.dataset).
  const coerceCorrectionValue = (field, raw) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : raw
    if (field === 'currentPrice') { const parsed = Number(trimmed); return Number.isFinite(parsed) ? parsed : trimmed }
    if (field === 'currency') return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed
    return trimmed
  }
  const applyUpdatedSubscription = (updated) => {
    backendItems = backendItems.map(item => item.remoteId === updated.id ? toDisplayItem(updated) : item)
    renderList()
  }
  detailRoot.querySelector('[data-correction-form]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const subscriptionId = detailRoot.dataset.subscriptionId
    const errorEl = detailRoot.querySelector('[data-correction-error]')
    errorEl.hidden = true
    if (!subscriptionId) return
    const field = detailRoot.querySelector('[data-correction-field]').value
    const rawValue = detailRoot.querySelector('[data-correction-value]').value
    if (!rawValue.trim()) { errorEl.hidden = false; errorEl.textContent = 'Enter a corrected value.'; return }
    const submitButton = event.currentTarget.querySelector('button[type="submit"]')
    submitButton.disabled = true
    try {
      const updated = await feature001Api.correctSubscription(subscriptionId, field, coerceCorrectionValue(field, rawValue))
      applyUpdatedSubscription(updated)
      renderDetail(detailRoot, toDisplayItem(updated), detailDialog)
      live.announce('Correction saved.')
      await refreshAttention()
    } catch (error) {
      errorEl.hidden = false
      errorEl.textContent = error.message || "That value couldn't be saved. Please try again."
    } finally {
      submitButton.disabled = false
    }
  })
  detailRoot.querySelector('[data-open-reject]').addEventListener('click', (event) => {
    rejectRoot.querySelector('[data-reject-name]').textContent = detailRoot.querySelector('#detail-title').textContent
    rejectDialog.open(event.currentTarget)
  })
  rejectRoot.querySelector('[data-confirm-reject]').addEventListener('click', async (event) => {
    const subscriptionId = detailRoot.dataset.subscriptionId
    if (!subscriptionId) return
    event.currentTarget.disabled = true
    try {
      await feature001Api.rejectSubscription(subscriptionId)
      backendItems = backendItems.filter(item => item.remoteId !== subscriptionId)
      renderList()
      rejectDialog.close()
      detailDialog.close()
      live.announce('No longer counted as an active subscription.')
      await refreshAttention()
    } catch {
      live.announce("That couldn't be completed. Please try again.")
    } finally {
      event.currentTarget.disabled = false
    }
  })

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
    status.textContent = state; status.dataset.state = state.toLowerCase().replace(/\s+/g, '-'); message.textContent = copy; gmailButton.dataset.gmailAction = action
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
  if (gmailError) {
    message.textContent = GMAIL_ERROR_MESSAGES[gmailError] || "Gmail couldn't be connected. Please try again."
    live.announce(message.textContent)
  }

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
      try { candidates = (await feature001Api.listCandidates()).candidates || [] } catch { /* the review section just keeps showing its last known state */ }
      renderCandidates()
      await refreshAttention()
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
  const { authError, gmailError } = consumeRedirectSignal()
  app.innerHTML = shellHeader + loadingMarkup()
  let session
  try {
    session = await feature001Api.getSession()
  } catch {
    renderSessionError("Subtle couldn't reach the server. Check your connection and try again.")
    return
  }
  if (!session.authenticated) { renderSignedOut(authError ? (AUTH_ERROR_MESSAGES[authError] || "Sign-in couldn't be completed. Please try again.") : undefined); return }
  await renderAuthenticated(session.user, gmailError)
}

boot()
