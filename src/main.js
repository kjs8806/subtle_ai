import './style.css'
import { feature001Api } from './services/feature001Api.js'
import { toDisplayItem, toManualDisplayItem } from './services/subscriptionMapper.js'
import { monthlySpendFor } from './data/subscriptionModel.js'
import { createDialogController, createLiveRegion } from './ui/accessibility.js'
import { gmailDisclosureMarkup } from './ui/gmailDisclosure.js'
import { initializeNavigation, NAV_ICONS, navigationMarkup } from './ui/navigation.js'
import { currentRoute, navigate, onRouteChange, routePath } from './ui/router.js'
import { overviewMarkup } from './ui/overview.js'
import { subscriptionsPageMarkup } from './ui/subscriptions.js'
import { attentionPageMarkup } from './ui/attention.js'
import { sourcesPageMarkup } from './ui/sources.js'
import { settingsPageMarkup } from './ui/settings.js'
import { correctionDialogMarkup, detailMarkup, rejectConfirmMarkup, renderCorrectionDialog, renderDetail } from './ui/subscriptionDetail.js'
import { loadingMarkup, sessionErrorMarkup, signedOutMarkup } from './ui/signedOut.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'Your AI subscription optimizer' }
const brandMark = `<svg class="brand-mark" viewBox="0 0 192 192" width="32" height="32" aria-hidden="true"><rect width="192" height="192" rx="44" fill="var(--purple)"/><text x="96" y="132" text-anchor="middle" fill="var(--paper)" font-family="Georgia, serif" font-size="124" font-style="italic">s</text></svg>`
const brand = `<a class="brand" href="#${routePath('overview')}" aria-label="${APP_CONFIG.name} home">${brandMark}<span class="brand-text"><span class="brand-name">${APP_CONFIG.name}</span><span class="brand-tagline">${APP_CONFIG.tagline}</span></span></a>`
const shellHeader = `<header class="pre-auth-header wrap">${brand}</header>`
const addDialogMarkup = `<div class="dialog-backdrop" data-add-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Manual entry</p><h2 id="add-title">Add a subscription</h2><form class="subscription-form"><label>Service name<input name="name" placeholder="e.g. Netflix" required></label><div class="form-row"><label>Cost<input name="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="22.99" required></label><label>Billing cadence<select name="cadence"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><button class="primary-button form-submit" type="submit">Add to overview</button></form></section></div>`

// Sidebar footer summary (mini Gmail status + account link). Kept read-only
// (no independent scan/connect controls) so the interactive Gmail source
// control stays a single instance - see the Sources page - avoiding two
// independently-wired copies of the same async control.
const sidebarFooterMarkup = (user, gmailSource) => {
  const connected = gmailSource?.status === 'connected'
  const lastScan = gmailSource?.lastScanAt ? new Date(gmailSource.lastScanAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase()
  return `<div class="sidebar-source-card"><div class="source-row">${NAV_ICONS.sources}<span>${connected ? 'Gmail connected' : 'Gmail not connected'}</span></div><p>${connected ? (lastScan ? `Last scan: ${lastScan}` : 'Ready to scan') : 'Connect from Sources'}</p></div><a class="sidebar-user" href="#${routePath('settings')}"><span class="avatar">${initials}</span><span class="who"><strong>${user?.name || 'Account'}</strong><span>${user?.email || ''}</span></span>${NAV_ICONS.chevron}</a>`
}

document.title = APP_CONFIG.name
const app = document.querySelector('#app')
const live = createLiveRegion()

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
  // they're tracked separately from backend-sourced ones and always re-merged
  // - a Gmail-triggered refresh must never make them disappear.
  let manualSubscriptions = []
  let backendItems = []
  let candidates = []
  let gmailSource = { status: 'not_connected', scanStatus: 'idle' }
  let gmailSourceUnavailable = false
  const actions = [] // no live recommendation engine yet - kept as an empty,
  // always-defined list so Worth your attention's "needs a decision" section
  // and Subscription Detail's notice both already support real entries.

  const [subsResult, sourceResult, candidatesResult] = await Promise.allSettled([
    feature001Api.listSubscriptions(),
    feature001Api.getGmailSource(),
    feature001Api.listCandidates(),
  ])
  if (subsResult.status === 'fulfilled') backendItems = (subsResult.value.subscriptions || []).map(toDisplayItem)
  if (sourceResult.status === 'fulfilled') gmailSource = sourceResult.value
  else gmailSourceUnavailable = true
  if (candidatesResult.status === 'fulfilled') candidates = candidatesResult.value.candidates || []

  const greeting = user?.name ? `Good morning, ${user.name.split(' ')[0]}.` : 'Good morning.'
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const allItems = () => [...manualSubscriptions, ...backendItems]
  const findSubscription = id => allItems().find(item => String(item.id) === String(id))

  // ---- persistent shell (sidebar, dialogs, footer) -----------------------
  app.innerHTML = `<div class="app-shell">${navigationMarkup(brand, { activeRoute: currentRoute().name, attentionCount: candidates.length })}<div class="main-col"><div data-page-root></div></div></div>${gmailDisclosureMarkup()}${correctionDialogMarkup()}${rejectConfirmMarkup()}${addDialogMarkup}`
  initializeNavigation(app)

  const pageRoot = document.querySelector('[data-page-root]')
  const gmailRoot = document.querySelector('[data-gmail-dialog]'); const gmailDialog = createDialogController(gmailRoot)
  const addRoot = document.querySelector('[data-add-dialog]'); const addDialog = createDialogController(addRoot)
  const correctionRoot = document.querySelector('[data-correction-dialog]'); const correctionDialog = createDialogController(correctionRoot)
  const rejectRoot = document.querySelector('[data-reject-dialog]'); const rejectDialog = createDialogController(rejectRoot)

  const renderSidebarFooter = () => { const slot = document.querySelector('[data-sidebar-footer]'); if (slot) slot.innerHTML = sidebarFooterMarkup(user, gmailSourceUnavailable ? null : gmailSource) }
  const updateNavActive = (routeName) => {
    const effective = routeName === 'subscription-detail' ? 'subscriptions' : routeName
    document.querySelectorAll('[data-route-link]').forEach(link => {
      if (link.dataset.routeLink === effective) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }
  const updateAttentionBadge = () => {
    document.querySelectorAll('[data-route-link="attention"]').forEach(link => {
      link.querySelector('.nav-badge')?.remove()
      if (candidates.length) link.insertAdjacentHTML('beforeend', `<span class="nav-badge">${candidates.length}</span>`)
    })
  }

  // ---- Gmail source state -> live UI, defensive against the Sources page
  // not currently being mounted (querySelector returns null; every update
  // below just no-ops rather than throwing). -------------------------------
  const setGmailState = (state, copy, action, { disabled = false } = {}) => {
    const status = document.querySelector('[data-gmail-status]'); if (!status) return
    const message = document.querySelector('[data-gmail-message]')
    const gmailButton = document.querySelector('[data-gmail-action]')
    const disconnectButton = document.querySelector('[data-gmail-disconnect]')
    status.textContent = state; status.dataset.state = state.toLowerCase().replace(/\s+/g, '-'); message.textContent = copy
    gmailButton.dataset.gmailAction = action
    gmailButton.textContent = action === 'scan' ? 'Scan receipts' : 'Find subscriptions from receipts'
    gmailButton.disabled = disabled
    disconnectButton.hidden = gmailSource.status !== 'connected'
  }
  const applyGmailSource = () => {
    if (gmailSourceUnavailable) setGmailState('Unavailable', "Gmail status couldn't be loaded. Try refreshing the page.", 'connect', { disabled: true })
    else if (gmailSource.status !== 'connected') setGmailState('Not connected', 'Connect to discover receipts', 'connect')
    else if (gmailSource.scanStatus === 'scanning') setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true })
    else if (gmailSource.scanStatus === 'error') setGmailState('Scan error', 'The last scan failed. You can try again.', 'scan')
    else setGmailState('Connected', 'Ready to scan receipts', 'scan')
    renderSidebarFooter()
  }
  const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>'
  const renderScanResults = (result) => {
    const list = document.querySelector('[data-last-scan-results]'); if (!list) return
    const items = [`${result.found || 0} subscription${result.found === 1 ? '' : 's'} found`]
    if (result.ambiguous) items.push(`${result.ambiguous} need${result.ambiguous === 1 ? 's' : ''} your review`)
    list.innerHTML = items.map(text => `<li>${CHECK_ICON}<span>${text}</span></li>`).join('')
  }
  const showDiscovery = (items) => {
    const discovery = document.querySelector('[data-discovery-result]'); if (!discovery) return
    discovery.hidden = false
    discovery.innerHTML = `<strong>${items.length} subscription${items.length === 1 ? '' : 's'} found.</strong><button class="primary-button" type="button">Review subscription${items.length === 1 ? '' : 's'}</button>`
    discovery.querySelector('button').addEventListener('click', () => items.length === 1 ? navigate('subscription-detail', { id: items[0].id }) : navigate('subscriptions'))
  }

  // ---- route rendering -----------------------------------------------------
  let currentSubscriptionId = null

  const renderSubscriptionDetailRoute = async (id) => {
    const summary = findSubscription(id)
    currentSubscriptionId = null
    if (!summary) {
      pageRoot.innerHTML = `<div class="main-content wrap"><a class="back-link" href="#${routePath('subscriptions')}">${NAV_ICONS.back}Back to Subscriptions</a><p class="empty-state">This subscription could not be found.</p></div>`
      return
    }
    pageRoot.innerHTML = detailMarkup()
    const detailRoot = pageRoot
    let item = summary
    if (summary.remoteId) {
      try { item = toDisplayItem(await feature001Api.getSubscription(summary.remoteId)) }
      catch { live.announce('Latest evidence could not be loaded; showing the last known details.') }
    }
    currentSubscriptionId = item.remoteId || null
    renderDetail(detailRoot, item)
    detailRoot.querySelector('[data-toggle-correction]')?.addEventListener('click', () => {
      renderCorrectionDialog(correctionRoot, item)
      correctionDialog.open(document.activeElement)
    })
    detailRoot.querySelector('[data-open-reject]')?.addEventListener('click', (event) => {
      rejectRoot.querySelector('[data-reject-name]').textContent = item.name
      rejectDialog.open(event.currentTarget)
    })
  }

  const renderRoute = async () => {
    const route = currentRoute()
    updateNavActive(route.name)
    const items = allItems()
    switch (route.name) {
      case 'subscriptions':
        pageRoot.innerHTML = subscriptionsPageMarkup({ subscriptions: items })
        pageRoot.querySelector('[data-open-add]')?.addEventListener('click', event => addDialog.open(event.currentTarget))
        break
      case 'subscription-detail':
        await renderSubscriptionDetailRoute(route.params.id)
        break
      case 'attention':
        pageRoot.innerHTML = attentionPageMarkup({ actions, candidates })
        wireCandidateList(pageRoot)
        break
      case 'sources':
        pageRoot.innerHTML = sourcesPageMarkup()
        wireSourcesPage()
        applyGmailSource()
        if (gmailError) { document.querySelector('[data-gmail-message]').textContent = GMAIL_ERROR_MESSAGES[gmailError] || "Gmail couldn't be connected. Please try again."; live.announce(document.querySelector('[data-gmail-message]').textContent) }
        break
      case 'settings':
        pageRoot.innerHTML = settingsPageMarkup({ user })
        pageRoot.querySelector('[data-sign-out]').addEventListener('click', signOut)
        break
      default:
        pageRoot.innerHTML = overviewMarkup({ subscriptions: items, actions, monthlySpend: monthlySpendFor(items), candidates, greeting, dateLabel, gmailSource, gmailSourceUnavailable })
    }
    updateAttentionBadge()
    window.scrollTo(0, 0)
  }

  onRouteChange(renderRoute)
  await renderRoute()
  renderSidebarFooter()

  // ---- FEATURE-002: ambiguous-candidate review. Confirm/reject act on the
  // whole pending candidate, not a subscription (there is no subscription
  // yet), and both remove the candidate from the pending list either way. --
  const wireCandidateList = (root) => {
    root.querySelector('.candidate-list')?.addEventListener('click', async (event) => {
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
        const { subscriptions: rawList } = await feature001Api.listSubscriptions()
        backendItems = (rawList || []).map(toDisplayItem)
        await renderRoute()
      } catch {
        button.disabled = false
        live.announce("That couldn't be completed. Please try again.")
      }
    })
  }

  // ---- FEATURE-002: corrections ("This looks wrong") and "Not a
  // subscription" rejection, both scoped to `currentSubscriptionId`
  // (stamped by renderSubscriptionDetailRoute whenever that route renders).
  const coerceCorrectionValue = (field, raw) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : raw
    if (field === 'currentPrice') { const parsed = Number(trimmed); return Number.isFinite(parsed) ? parsed : trimmed }
    if (field === 'currency') return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed
    return trimmed
  }
  correctionRoot.querySelector('[data-correction-form]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorEl = correctionRoot.querySelector('[data-correction-error]')
    errorEl.hidden = true
    if (!currentSubscriptionId) return
    const field = correctionRoot.querySelector('[data-correction-field]').value
    const rawValue = correctionRoot.querySelector('[data-correction-value]').value
    if (!rawValue.trim()) { errorEl.hidden = false; errorEl.textContent = 'Enter a corrected value.'; return }
    const submitButton = event.currentTarget.querySelector('button[type="submit"]')
    submitButton.disabled = true
    try {
      const updated = await feature001Api.correctSubscription(currentSubscriptionId, field, coerceCorrectionValue(field, rawValue))
      backendItems = backendItems.map(item => item.remoteId === updated.id ? toDisplayItem(updated) : item)
      correctionDialog.close()
      await renderRoute()
      live.announce('Correction saved.')
    } catch (error) {
      errorEl.hidden = false
      errorEl.textContent = error.message || "That value couldn't be saved. Please try again."
    } finally {
      submitButton.disabled = false
    }
  })
  rejectRoot.querySelector('[data-confirm-reject]').addEventListener('click', async (event) => {
    if (!currentSubscriptionId) return
    event.currentTarget.disabled = true
    try {
      await feature001Api.rejectSubscription(currentSubscriptionId)
      backendItems = backendItems.filter(item => item.remoteId !== currentSubscriptionId)
      rejectDialog.close()
      live.announce('No longer counted as an active subscription.')
      navigate('subscriptions')
    } catch {
      live.announce("That couldn't be completed. Please try again.")
    } finally {
      event.currentTarget.disabled = false
    }
  })

  const signOut = async (event) => {
    event.currentTarget.disabled = true
    try { await feature001Api.logout() } catch { /* session cookie is cleared server-side regardless of network hiccups on our end */ }
    boot()
  }

  addRoot.querySelector('form').addEventListener('submit', event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = data.get('name').trim(); const cost = Number(data.get('cost')); const cadence = data.get('cadence')
    manualSubscriptions.push(toManualDisplayItem({ name, cost, cadence }))
    event.currentTarget.reset(); addDialog.close(); live.announce(`${name} added.`)
    renderRoute()
  })

  // ---- Gmail: connect/scan/disconnect (Sources page only) ------------------
  const refreshGmailSource = async () => {
    try { gmailSource = await feature001Api.getGmailSource(); gmailSourceUnavailable = false }
    catch { gmailSourceUnavailable = true }
    applyGmailSource()
  }
  const runScan = async () => {
    const gmailButton = document.querySelector('[data-gmail-action]')
    if (!gmailButton || gmailButton.disabled) return
    const discovery = document.querySelector('[data-discovery-result]'); if (discovery) discovery.hidden = true
    setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true }); live.announce('Scanning receipts…')
    try {
      const result = await feature001Api.scanGmail()
      const previousIds = new Set(allItems().map(item => item.id))
      const { subscriptions: rawList } = await feature001Api.listSubscriptions()
      backendItems = (rawList || []).map(toDisplayItem)
      const newIds = new Set(allItems().filter(item => !previousIds.has(item.id)).map(item => item.id))
      try { candidates = (await feature001Api.listCandidates()).candidates || [] } catch { /* the review page just keeps showing its last known state */ }
      await refreshGmailSource()
      await renderRoute()
      renderScanResults(result)
      const copy = result.found ? `${result.found} subscription${result.found === 1 ? '' : 's'} found.` : 'No qualifying subscription receipts found.'
      live.announce(copy)
      const discovered = allItems().filter(item => newIds.has(item.id))
      if (discovered.length) showDiscovery(discovered)
    } catch (error) {
      if (error.code === 'scan_already_running') { setGmailState('Scanning', 'A scan is already running…', 'scan', { disabled: true }); live.announce('A scan is already in progress.') }
      else if (error.code === 'source_not_connected') { await refreshGmailSource(); live.announce('Connect Gmail before scanning.') }
      else { setGmailState('Scan error', "Gmail is connected, but receipts couldn't be scanned. You can try again.", 'scan'); live.announce('Receipts could not be scanned.') }
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
  const wireSourcesPage = () => {
    document.querySelector('[data-gmail-action]').addEventListener('click', event => event.currentTarget.dataset.gmailAction === 'scan' ? runScan() : gmailDialog.open(event.currentTarget))
    document.querySelector('[data-gmail-disconnect]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true
      setGmailState('Disconnecting', 'Disconnecting Gmail…', 'scan', { disabled: true }); live.announce('Disconnecting Gmail…')
      try {
        await feature001Api.disconnectGmail()
        const { subscriptions: rawList } = await feature001Api.listSubscriptions()
        backendItems = (rawList || []).map(toDisplayItem)
        await refreshGmailSource()
        await renderRoute()
        applyGmailSource()
        live.announce('Gmail disconnected.')
      } catch {
        applyGmailSource()
        live.announce("Gmail couldn't be disconnected. Please try again.")
      } finally {
        const stillPresent = document.querySelector('[data-gmail-disconnect]')
        if (stillPresent) stillPresent.disabled = false
      }
    })
  }
  gmailRoot.querySelector('[data-continue-gmail]').addEventListener('click', async event => {
    event.currentTarget.disabled = true
    setGmailState('Authorizing', 'Waiting for Gmail authorization…', 'connect', { disabled: true }); live.announce('Waiting for Gmail authorization.')
    gmailDialog.close()
    await connectGmail()
    event.currentTarget.disabled = false
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
    renderSessionError("Subtle AI couldn't reach the server. Check your connection and try again.")
    return
  }
  if (!session.authenticated) { renderSignedOut(authError ? (AUTH_ERROR_MESSAGES[authError] || "Sign-in couldn't be completed. Please try again.") : undefined); return }
  await renderAuthenticated(session.user, gmailError)
}

boot()
