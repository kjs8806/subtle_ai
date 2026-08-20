import { expect, test } from '@playwright/test'

const receipt = {
  id: 'remote-netflix', canonicalService: 'Netflix', rawMerchant: 'Netflix', plan: null,
  currentPrice: 22.99, billingCycle: 'monthly', nextRenewal: 'Sep 12', source: 'Gmail receipt',
  confidence: { state: 'confirmed', score: 0.98 }, priceHistory: [{ amount: 22.99, observedAt: '2026-08-19' }],
  billingHistory: [{ amount: 22.99, billedAt: '2026-08-19' }],
  evidence: [{ id: 'evidence-1', sender: 'billing@netflix.com', subject: 'Netflix renewal receipt', receivedAt: '2026-08-19' }],
}

const mockApi = async (page, scenario = 'success') => {
  let authenticated = false
  let connected = false
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/v1/session') return json(200, { authenticated })
    if (path === '/api/v1/auth/google/start') return scenario === 'auth-failure' ? json(502, { error: { code: 'authorization_failed', message: 'Authorization failed' } }) : json(200, { url: '/api/v1/auth/google/callback?state=state&code=mock-success' })
    if (path === '/api/v1/auth/google/callback') { authenticated = true; connected = true; return json(200, { status: 'authorized' }) }
    if (path === '/api/v1/sources/gmail' && route.request().method() === 'GET') return json(200, { status: connected ? 'connected' : 'not_connected' })
    if (path === '/api/v1/sources/gmail/disconnect') { connected = false; return json(200, { status: 'not_connected' }) }
    if (path === '/api/v1/sources/gmail/scan') {
      if (!connected) return json(409, { error: { code: 'source_not_connected', message: 'Connect Gmail before scanning' } })
      if (scenario === 'scan-failure') return json(502, { error: { code: 'scan_failed', message: 'Gmail receipts could not be scanned' } })
      if (scenario === 'expired') return json(401, { error: { code: 'reconnect_required', message: 'Gmail permission expired' } })
      if (scenario === 'empty') return json(200, { found: 0, ambiguous: 0 })
      if (scenario === 'ambiguous') return json(200, { found: 0, ambiguous: 1 })
      return json(200, { found: 1, ambiguous: 0 })
    }
    if (path === '/api/v1/subscriptions') return json(200, { subscriptions: scenario === 'unknown' ? [{ ...receipt, id: 'remote-unknown', currentPrice: null, billingCycle: null, nextRenewal: null, priceHistory: [], billingHistory: [] }] : [receipt] })
    if (path.startsWith('/api/v1/subscriptions/')) return json(200, receipt)
    return json(404, { error: { code: 'not_found' } })
  })
}

const connect = async (page) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Gmail' }).click()
  await page.getByRole('button', { name: /Continue to Gmail/ }).click()
}

test('disclosure can be cancelled with Not now', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Gmail' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect Gmail' })).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByText('Authorization cancelled')).toBeVisible()
})

test('successful authorization scans and creates a discovered row', async ({ page }) => {
  await mockApi(page)
  await connect(page)
  await expect(page.locator('[data-remote-id="remote-netflix"]')).toContainText('Netflix')
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeVisible()
})

test('remote-id review opens matching evidence', async ({ page }) => {
  await mockApi(page)
  await connect(page)
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await expect(page.getByRole('dialog', { name: /Netflix/ })).toContainText('billing@netflix.com')
  await expect(page.getByRole('dialog', { name: /Netflix/ })).not.toContainText('Your monthly payment')
})

for (const [scenario, expected] of [['empty', 'No supported subscription receipt found.'], ['ambiguous', 'Receipt needs review; no subscriptions were merged.']]) {
  test(`${scenario} scan state`, async ({ page }) => { await mockApi(page, scenario); await connect(page); await expect(page.getByText(expected)).toBeVisible() })
}

test('authorization failure is distinct and retryable', async ({ page }) => {
  await mockApi(page, 'auth-failure'); await connect(page)
  await expect(page.getByText('Authorization failed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled()
})

test('scan failure keeps retry action available', async ({ page }) => {
  await mockApi(page, 'scan-failure'); await connect(page)
  await expect(page.getByText('Scan failed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scan receipts' })).toBeEnabled()
})

test('expired permission requires reconnect', async ({ page }) => {
  await mockApi(page, 'expired'); await connect(page)
  await expect(page.getByText('Reconnect required')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconnect Gmail' })).toBeEnabled()
})

test('disconnect prevents scanning in the UI', async ({ page }) => {
  await mockApi(page); await connect(page)
  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('Disconnected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scan receipts' })).toHaveCount(0)
})

test('seeded subscription detail and manual entry still work', async ({ page }) => {
  await mockApi(page); await page.goto('/')
  await page.locator('[data-subscription-id="1"]').click()
  await expect(page.getByRole('dialog')).toContainText('Netflix')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Add subscription/ }).click()
  await expect(page.getByRole('dialog', { name: 'Add a subscription' })).toBeVisible()
})

test('switching subscriptions clears stale detail history', async ({ page }) => {
  await mockApi(page, 'unknown'); await connect(page)
  await page.locator('[data-subscription-id="3"]').click()
  await page.keyboard.press('Escape')
  await page.locator('[data-remote-id="remote-unknown"]').click()
  await expect(page.getByRole('dialog')).toContainText('No confirmed billing history.')
})

test('unknown values are not fabricated or added to spend', async ({ page }) => {
  await mockApi(page, 'unknown'); await page.goto('/')
  const before = await page.locator('[data-spend]').innerText()
  await page.getByRole('button', { name: 'Connect Gmail' }).click(); await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.locator('[data-remote-id="remote-unknown"]')).toContainText('Not included')
  await expect(page.locator('[data-spend]')).toHaveText(before)
})

test('dialog traps focus, supports Escape, restores focus and announces state', async ({ page }) => {
  await mockApi(page); await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Connect Gmail' }); await trigger.focus(); await trigger.click()
  await expect(page.getByRole('button', { name: 'Close Gmail connection dialog' })).toBeFocused()
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '')
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  await expect(page.getByRole('status')).toContainText('Authorization cancelled')
})

test('visible brand and document title use the centralized app name', async ({ page }) => {
  await mockApi(page); await page.goto('/')
  await expect(page).toHaveTitle('Subtle AI — your AI subscription optimizer')
  await expect(page.locator('.brand').first()).toContainText('Subtle AI')
})