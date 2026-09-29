// SDK 0.4.4 units: node --test tests/v044.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const out = await build({
  stdin: { contents: "export * from './src/api.ts'; export * from './src/styles.ts'", resolveDir: '.', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { __SDK_VERSION__: '"0.4.4"' },
})
const { contextOf, parseConfig, placeholderConfig, themeVars, darkThemeVars, darkTheme, LIGHT, mix, textOn } = await import(
  'data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text)
)

test('context: text, number, true/false; bad names, nulls and non-finite numbers left out', () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.deepEqual(
      contextOf({ plan: 'pro', seats: 3, trial: false, 'screen.name 2-b_c': 'x', 'bad key!': 1, gone: null, nan: NaN, obj: {}, ['k'.repeat(41)]: 1, 'é': 1 }),
      { plan: 'pro', seats: 3, trial: false, 'screen.name 2-b_c': 'x' },
    )
    assert.deepEqual(contextOf(undefined), {})
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]))
    assert.equal(Object.keys(contextOf(many)).length, 20)
    assert.equal(contextOf({ long: 'a'.repeat(600) }).long.length, 500)
  } finally {
    console.warn = warn
  }
})

test('config: enabled unless the server says false (older servers: on)', () => {
  assert.equal(parseConfig({}, 'X').enabled, true)
  assert.equal(parseConfig({ enabled: true }, 'X').enabled, true)
  assert.equal(parseConfig({ enabled: false }, 'X').enabled, false)
  assert.equal(parseConfig({ enabled: 'no' }, 'X').enabled, true)
  assert.equal(placeholderConfig('X').enabled, true)
})

test('themes: only the six public colours; nothing given, nothing changed', () => {
  assert.equal(themeVars({}), '')
  assert.equal(themeVars({ primary: '#123456' }), '--dr-primary:#123456;')
  assert.equal(
    themeVars({ primary: '#1', accent: '#2', userBubble: '#3', userBubbleText: '#4', background: '#5', ink: '#6' }),
    '--dr-primary:#1;--dr-accent:#2;--dr-user:#3;--dr-user-text:#4;--dr-bg:#5;--dr-ink:#6;',
  )
  assert.equal(themeVars({ header: '#000', surface: '#000', outlineWidth: 2, nope: 1 }), '') // other keys ignored
  assert.equal(themeVars({ primary: 'red;display:none' }), '') // can't break out of the style attribute
})

test('light: 0.4.3 values; header and cards follow primary, outlines and text on primary follow ink', () => {
  for (const v of ['--dr-primary:#F6EB37', '--dr-accent:#FF5FA2', '--dr-user:#2B50E0', '--dr-bg:#FFFDF2', '--dr-ink:#111', '--dr-surface:#fff',
    '--dr-muted:#4A4740', '--dr-error:#B32619', '--dr-ow:1', '--dr-outline:var(--dr-ink)', '--dr-shadow:var(--dr-outline)',
    '--dr-header:var(--dr-primary)', '--dr-card:var(--dr-primary)', '--dr-on-primary:var(--dr-ink)', '--dr-badge:#FF5FA2', '--dr-lemon:#F6EB37'])
    assert.ok(LIGHT.includes(v + ';'), v)
})

test('mix and textOn', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(mix('#0E1320', '#EEF1F8', 0.08), '#202531')
  assert.equal(mix('red', '#FFFFFF', 0.08), 'color-mix(in srgb, red 92%, #FFFFFF)')
  assert.equal(textOn('#2B50E0'), '#FFFFFF')
  assert.equal(textOn('#F6EB37'), '#111111')
  assert.equal(textOn('#FF5FA2'), '#111111')
  assert.equal(textOn('rgb(0, 0, 0)'), '#FFFFFF')
})

test('dark: the "Deep blue" preset and what is derived from it', () => {
  assert.ok(Object.isFrozen(darkTheme))
  assert.deepEqual({ ...darkTheme }, {
    background: '#0E1320', ink: '#EEF1F8', primary: '#2B50E0', accent: '#FF5FA2', userBubble: '#3F6BFF', userBubbleText: '#FFFFFF',
  })
  const vars = Object.fromEntries(darkThemeVars({}).split(';').filter(Boolean).map((d) => d.split(/:(.*)/s).slice(0, 2)))
  assert.deepEqual(
    { surface: vars['--dr-surface'], card: vars['--dr-card'], notice: vars['--dr-notice'], team: vars['--dr-team'], muted: vars['--dr-muted'],
      outline: vars['--dr-outline'], ow: vars['--dr-ow'], shadow: vars['--dr-shadow'], header: vars['--dr-header'], onHeader: vars['--dr-on-header'],
      onPrimary: vars['--dr-on-primary'], onAccent: vars['--dr-on-accent'], error: vars['--dr-error'], badge: vars['--dr-badge'],
      tag: vars['--dr-tag-bg'] + '/' + vars['--dr-tag-text'], scheme: vars['color-scheme'] },
    { surface: '#181E30', card: '#181E30', notice: '#181E30', team: '#181E30', muted: '#A0A3AC', outline: '#EEF1F8', ow: '0.5',
      shadow: '#06080D', header: '#2B50E0', onHeader: '#FFFFFF', onPrimary: '#FFFFFF', onAccent: '#111111', error: '#FF8A7E',
      badge: '#F6EB37', tag: '#F6EB37/#111111', scheme: 'dark' },
  )
  // The site's colours over the preset; anything else ignored.
  const own = darkThemeVars({ accent: '#00FF00', surface: '#FF0000' })
  assert.match(own, /--dr-accent:#00FF00;/)
  assert.match(own, /--dr-bg:#0E1320;/)
  assert.match(own, /--dr-surface:#181E30;/)
})
