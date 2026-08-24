// Shared across e2e specs: signs in with the mock Google provider
// (GMAIL_PROVIDER=mock, see playwright.config.js) and waits for the
// authenticated shell to render. No real Google credentials are used or
// needed - see server/gmail/fakeProvider.js.
export const signIn = async (page) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Continue with Google/i }).click()
  await page.getByRole('heading', { name: /Good morning/i }).waitFor()
}
