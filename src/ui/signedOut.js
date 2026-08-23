// No signed-out screen exists in the approved DESIGN-001 layout (it only
// specifies the authenticated overview/subscriptions/detail/Gmail-connect
// experience), so this is the minimal entry point needed to gate that
// experience behind a real session - reusing existing classes/typography
// rather than introducing new visual language.
export const signedOutMarkup = () => `<div class="main-content wrap" id="signed-out"><header class="overview-header"><p class="eyebrow">Welcome</p><h1>Sign in to Subtle AI</h1><p>Sign in with your Google account to see your subscriptions and connect Gmail receipt discovery.</p></header><button class="primary-button" data-google-sign-in type="button">Sign in with Google</button><p class="empty-state" data-session-error hidden></p></div>`

export const loadingMarkup = (message = 'Loading…') => `<div class="main-content wrap" id="loading"><p class="empty-state" role="status">${message}</p></div>`

export const sessionErrorMarkup = (message = "Subtle AI couldn't reach the server.") => `<div class="main-content wrap" id="session-error"><header class="overview-header"><p class="eyebrow">Connection problem</p><h1>Something went wrong</h1><p>${message}</p></header><button class="primary-button" data-retry-session type="button">Try again</button></div>`
