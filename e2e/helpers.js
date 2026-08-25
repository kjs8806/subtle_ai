import { expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Shared across e2e specs: signs in with the mock Google provider
// (GMAIL_PROVIDER=mock, see playwright.e2e.config.js) and waits for the
// authenticated shell to render. No real Google credentials are used or
// needed - see server/gmail/fakeProvider.js. Each call drives the real
// "Continue with Google" redirect round trip, so (per fakeProvider.js's
// mock-success:<uuid> code) it also mints its own fresh, isolated backend
// account rather than reusing one shared mock account across tests.
export const signIn = async (page) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Continue with Google/i }).click()
  await page.getByRole('heading', { name: /Good morning/i }).waitFor()
}

// #43 automated accessibility gate: scans the current page/dialog against
// WCAG 2.0/2.1/2.2 A+AA rule sets. Per the #43 QA plan, zero axe violations
// is evidence, not certification - manual keyboard/screen-reader/visual
// review still applies. A critical or serious finding fails the check
// immediately (a launch-blocking automated signal); moderate/minor findings
// are logged for the manual QA review record instead of failing the build,
// since axe-core's static analysis can't judge every moderate finding's
// real-world impact the way a human reviewer can.
export const expectNoSeriousA11yViolations = async (page, label) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const describe = (violation) => `${violation.id} [${violation.impact}] (${violation.nodes.length} node(s)): ${violation.help} - ${violation.helpUrl}`
  if (results.violations.length) {
    console.log(`[a11y] ${label}: ${results.violations.length} violation(s)\n${results.violations.map(describe).join('\n')}`)
  }
  const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  expect(blocking.map(describe), `${label}: critical/serious accessibility violation(s) found`).toEqual([])
}
