// Per-service icon registry, keyed by the exact canonicalService strings
// produced by src/services/subscriptionTemplates.js.
//
// Icon selection policy, in priority order:
//   1. Known mapped service (a SERVICE_ICONS entry) - a distinct, recognizable
//      shape in that service's real brand color. These are original glyphs,
//      not the service's actual trademarked logo file: this app has no
//      licensed source for third-party brand assets, and hot-linking logos
//      from an arbitrary external host (or a search engine) is both a
//      reliability risk and a trademark-guideline risk - so this
//      repo-committed set *is* the approved, maintainable asset source, and
//      it is never recolored or stretched per-surface.
//   2. Unknown/unmapped service with a usable name - a first-letter tile
//      (see letterTileIcon below), styled like the rest of the app's
//      identity tiles (the account avatar's purple-soft/purple-ink pairing -
//      see .sidebar-user .avatar in style.css), never a generic
//      document/image icon and never an invented logo for a service this
//      app doesn't actually recognize.
//   3. No usable service name at all - the neutral FALLBACK_SERVICE_ICON.
// serviceIconFor is the single source of truth every surface (Overview,
// Subscriptions, Subscription Detail, Worth your attention, the correction
// dialog's live preview) calls through, so a given canonicalService always
// resolves to the same tier and the same icon everywhere - including right
// after a FEATURE-002 correction changes canonicalService, since nothing
// caches the old icon.
const glyph = (inner, viewBox = '0 0 24 24') => `<svg viewBox="${viewBox}" width="20" height="20" aria-hidden="true" focusable="false">${inner}</svg>`

const solid = (bg, fg, inner) => ({ bg, fg, svg: glyph(inner) })

// Matches --purple-soft/--purple-ink in style.css - the same pairing already
// used for the account avatar - so a service letter tile reads as the same
// "identity tile" design language, not a new one-off color scheme.
const LETTER_TILE_BG = '#efebff'
const LETTER_TILE_FG = '#4a3ad1'
const letterTileIcon = (letter) => solid(LETTER_TILE_BG, LETTER_TILE_FG, `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" font-family="inherit" fill="currentColor">${letter}</text>`)

// The "first meaningful character": the first letter or digit, skipping any
// leading symbol/whitespace/emoji, uppercased. Returns null when a name has
// no such character at all (empty, whitespace-only, symbols-only) so the
// caller can fall through to the generic icon instead of tiling nothing.
const firstMeaningfulChar = (name) => {
  const match = String(name ?? '').match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : null
}

export const SERVICE_ICONS = {
  Netflix: solid('#E50914', '#ffffff', '<path d="M5 3h4l6 12V3h4v18h-4L9 9v12H5z" fill="currentColor"/>'),
  Spotify: solid('#1DB954', '#0b3d20', '<path d="M6 9.2c4-1.6 8-1.6 12 .3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M5 13c5-2 9-2 14 .3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M4.5 16.8c6-2.6 10-2.6 15 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  'Disney+': solid('#113CCF', '#ffffff', '<path d="M12 3.2 13.9 9l6 .2-4.8 3.6 1.8 5.9L12 15.3l-4.9 3.4 1.8-5.9L4.1 9.2l6-.2Z" fill="currentColor"/>'),
  Hulu: solid('#1CE783', '#08331d', '<path d="M8 5v14M8 12h5.2A2.8 2.8 0 0 1 16 14.8V19" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/>'),
  Max: solid('#0a0f2c', '#ffffff', '<path d="M4.5 18V6l4.3 6L13 6v12M13 18l4.6-8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  Dropbox: solid('#0061FF', '#ffffff', '<path d="M12 4 6.5 7.6 12 11.2 6.5 14.8 12 18.4l5.5-3.6-5.5-3.6 5.5-3.6z" fill="currentColor"/>'),
  Adobe: solid('#FA0F00', '#ffffff', '<path d="M9.3 5H4v14zM14.7 5H20v14zM12 9.7l3.6 8.5h-2.4l-.9-2.3H10l1.6-3.8.8 1.9h.9z" fill="currentColor"/>'),
  Canva: solid('#00C4CC', '#053738', '<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.8 13c.2 1.8 1.6 2.8 3 2.6 1.1-.1 1.9-.8 1.9-1.7 0-.8-.7-1.2-1.5-1.3-.9-.1-1.6.3-1.6.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  NordVPN: solid('#4687FF', '#ffffff', '<path d="M12 3.3 5.5 6v5.2c0 4.7 2.7 7.7 6.5 9.5 3.8-1.8 6.5-4.8 6.5-9.5V6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9 12 2 2 4-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  ExpressVPN: solid('#DA3940', '#ffffff', '<path d="M12 3.3 5.5 6v5.2c0 4.7 2.7 7.7 6.5 9.5 3.8-1.8 6.5-4.8 6.5-9.5V6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.2 8 10 12.6h2.3L11 16l4.2-5.2h-2.2Z" fill="currentColor"/>'),
  'ChatGPT Plus': solid('#10A37F', '#ffffff', '<path d="M12 3.4 19.8 8v8L12 20.6 4.2 16V8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.7" fill="currentColor"/>'),
  'YouTube Premium': solid('#FF0000', '#ffffff', '<rect x="4" y="6.5" width="16" height="11" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.3 9.8v4.4l4.3-2.2Z" fill="currentColor"/>'),
  'Apple Music': solid('#FA233B', '#ffffff', '<circle cx="8.4" cy="17" r="2.2" fill="currentColor"/><circle cx="16.6" cy="15.2" r="2.2" fill="currentColor"/><path d="M10.6 17V6.8L18.8 5v10.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  'iCloud+': solid('#3693F3', '#ffffff', '<path d="M7.3 16.7a3.6 3.6 0 0 1-.4-7.2 4.6 4.6 0 0 1 8.8-1.5 4.1 4.1 0 0 1-.6 8.7Z" fill="currentColor"/>'),
  'Microsoft 365': {
    bg: '#f3f3f3',
    fg: '#1f1f1f',
    svg: glyph('<rect x="3.4" y="3.4" width="8" height="8" fill="#F35325"/><rect x="12.6" y="3.4" width="8" height="8" fill="#81BC06"/><rect x="3.4" y="12.6" width="8" height="8" fill="#05A6F0"/><rect x="12.6" y="12.6" width="8" height="8" fill="#FFBA08"/>'),
  },
  'Google One': {
    bg: '#ffffff',
    fg: '#1f1f1f',
    svg: glyph('<path d="M12 3.4a8.6 8.6 0 0 0-6.1 14.7l2.7-2.1A5.6 5.6 0 0 1 12 6.6Z" fill="#EA4335"/><path d="M5.9 18.1A8.6 8.6 0 0 0 12 20.6v-3.2A5.6 5.6 0 0 1 8.6 16Z" fill="#34A853"/><path d="M12 20.6a8.6 8.6 0 0 0 8.5-7.2H12Z" fill="#4285F4"/><path d="M20.5 13.4c.1-.6.2-1.2.2-1.9 0-.7-.1-1.3-.2-1.9H12v3.8Z" fill="#FBBC05"/>'),
  },
  'Amazon Prime': solid('#232F3E', '#FF9900', '<path d="M5 14.5c3.4 2.6 10.6 2.6 14 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M16.4 12.6l2.4 1.6-2 2.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  'Uber One': solid('#000000', '#ffffff', '<path d="M7 5v9a5 5 0 0 0 10 0V5" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linecap="round"/>'),
}

// Reserved for tier 3 only: no usable service name at all. Never shown for
// an unmapped-but-named service - that's letterTileIcon's job.
export const FALLBACK_SERVICE_ICON = solid('#eceafc', '#5b5f78', '<path d="M4.6 6.4A2 2 0 0 1 6.6 4.4h7l6 6v9a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13.6 4.4v6h6" fill="none" stroke="currentColor" stroke-width="1.5"/>')

export const serviceIconFor = (canonicalService) => {
  if (SERVICE_ICONS[canonicalService]) return SERVICE_ICONS[canonicalService]
  const letter = firstMeaningfulChar(canonicalService)
  return letter ? letterTileIcon(letter) : FALLBACK_SERVICE_ICON
}

const escapeAttr = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

// `size` selects a CSS modifier class (see .service-icon.icon-* in style.css)
// - callers never inline dimensions, so every surface stays visually
// consistent. The label reflects which tier actually rendered: "logo" is
// only claimed for a real known-service icon, never for a letter tile that
// merely stands in for a name Subtle AI doesn't recognize.
export const serviceIconMarkup = (canonicalService, { size = 'md' } = {}) => {
  const icon = serviceIconFor(canonicalService)
  const label = SERVICE_ICONS[canonicalService] ? `${canonicalService} logo` : canonicalService ? escapeAttr(canonicalService) : 'Unknown service'
  return `<span class="service-icon icon-${size}" style="background:${icon.bg};color:${icon.fg}" role="img" aria-label="${label}">${icon.svg}</span>`
}
