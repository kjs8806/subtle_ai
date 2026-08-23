// Predefined subscription-service templates used by subscriptionClassifier.js
// as a *confidence signal*, never an allow-list: a template match alone is
// worth +3 points, well below the "subscription" threshold (5) on its own -
// it must combine with at least one recurrence signal from the email itself.
// See docs/engineering/SUBSCRIPTION_CLASSIFICATION.md for the full rationale.
//
// Two shapes of template, by design:
//
// - Single-purpose services (Netflix, Spotify, Dropbox, ...) have no
//   meaningful one-time product line, so matching the sender's domain alone
//   is a safe signal. These carry both `merchantPatterns` (content) and
//   `senderPatterns` (domain) - either is sufficient to match.
//
// - Multi-product companies (Google, Apple, Amazon, Microsoft, Uber) sell
//   both one-time and recurring products from the same sending domain, so a
//   bare domain match would be a false signal (see PROBLEM/section 1 of the
//   classification brief). These templates deliberately omit
//   `senderPatterns` - only content naming the specific recurring product
//   (e.g. "Google One", "Prime membership", "Uber One") counts as a match.
export const SUBSCRIPTION_TEMPLATES = [
  // Single-purpose services
  { canonicalService: 'Netflix', category: 'Entertainment', merchantPatterns: [/netflix/i], senderPatterns: [/@netflix\.com$/i] },
  { canonicalService: 'Spotify', category: 'Entertainment', merchantPatterns: [/spotify/i], senderPatterns: [/@spotify\.com$/i] },
  { canonicalService: 'Disney+', category: 'Entertainment', merchantPatterns: [/disney\+|disney\s*plus/i], senderPatterns: [/@disneyplus\.com$/i] },
  { canonicalService: 'Hulu', category: 'Entertainment', merchantPatterns: [/hulu/i], senderPatterns: [/@hulu\.com$/i] },
  { canonicalService: 'Max', category: 'Entertainment', merchantPatterns: [/\bmax\b/i], senderPatterns: [/@max\.com$/i] },
  { canonicalService: 'Dropbox', category: 'Cloud storage', merchantPatterns: [/dropbox/i], senderPatterns: [/@dropbox\.com$/i] },
  { canonicalService: 'Adobe', category: 'Work tools', merchantPatterns: [/adobe|creative\s*cloud/i], senderPatterns: [/@adobe\.com$/i] },
  { canonicalService: 'Canva', category: 'Work tools', merchantPatterns: [/canva/i], senderPatterns: [/@canva\.com$/i] },
  { canonicalService: 'NordVPN', category: 'Security', merchantPatterns: [/nordvpn/i], senderPatterns: [/@nordvpn\.com$/i] },
  { canonicalService: 'ExpressVPN', category: 'Security', merchantPatterns: [/expressvpn/i], senderPatterns: [/@expressvpn\.com$/i] },
  { canonicalService: 'ChatGPT Plus', category: 'Work tools', merchantPatterns: [/chatgpt/i], senderPatterns: [/@openai\.com$/i] },

  // Multi-product companies - domain alone never matches; the specific
  // recurring product must be named in the message content.
  { canonicalService: 'YouTube Premium', category: 'Entertainment', merchantPatterns: [/youtube\s*premium/i] },
  { canonicalService: 'Apple Music', category: 'Entertainment', merchantPatterns: [/apple\s*music/i] },
  { canonicalService: 'iCloud+', category: 'Cloud storage', merchantPatterns: [/icloud\+?/i] },
  { canonicalService: 'Google One', category: 'Cloud storage', merchantPatterns: [/google\s*(one|storage)|google\s*\*/i] },
  { canonicalService: 'Microsoft 365', category: 'Work tools', merchantPatterns: [/microsoft\s*365|office\s*365/i] },
  { canonicalService: 'Amazon Prime', category: 'Membership', merchantPatterns: [/amazon\s*prime/i, /prime\s*membership/i, /prime\s*(video\s*)?renew/i] },
  { canonicalService: 'Uber One', category: 'Membership', merchantPatterns: [/uber\s*one/i] },
]

export const findSubscriptionTemplate = (rawText, sender) => SUBSCRIPTION_TEMPLATES.find((template) =>
  (template.merchantPatterns || []).some((pattern) => pattern.test(rawText)) ||
  (template.senderPatterns || []).some((pattern) => pattern.test(sender)),
)
