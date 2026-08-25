import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
const root = stylesheet.match(/:root\s*\{(?<tokens>[^}]+)\}/)?.groups.tokens ?? ''
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]{6})/gi)].map(([, name, value]) => [name, value]),
)

const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

test('small-text color token pairings meet WCAG AA contrast', () => {
  const pairs = [
    ['severity high', tokens.danger, tokens['danger-soft']],
    ['severity low, uncertain tag, and conflict notice', tokens.warning, tokens['warning-soft']],
    ['severity medium', tokens['coral-ink'], tokens['coral-soft']],
    ['navigation badge', '#ffffff', tokens.coral],
    ['muted copy on surface', tokens['muted-soft'], tokens.surface],
    ['muted copy on paper', tokens['muted-soft'], tokens.paper],
  ]

  for (const [usage, foreground, background] of pairs) {
    assert.ok(foreground && background, `${usage} must reference defined color tokens`)
    const ratio = contrast(foreground, background)
    assert.ok(ratio >= 4.5, `${usage} contrast is ${ratio.toFixed(2)}:1; expected at least 4.5:1`)
  }
})
