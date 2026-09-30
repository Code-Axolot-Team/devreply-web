// The messenger's CSS, inside a shadow root: the host page's styles can't reach it, and ours never leak
// out. DevReply's "Loud" look (spec 11), the same as iOS and Android. The site passes six colours, for
// light and for dark (DevReply.configure({ theme, darkTheme })); every other colour is derived from them.
// Line widths and shadows are DevReply's: light as always, dark with thin outlines.

/** The messenger's colours, any CSS colour, separately for light and dark. Every other colour (cards,
 *  outlines, secondary text, the header's text…) is derived from these six. Other keys are ignored. */
export interface Theme {
  /** Header and highlight colour. */
  primary?: string
  /** Buttons that act: send, start. */
  accent?: string
  /** The user's own message bubbles. */
  userBubble?: string
  /** Text on `userBubble`. */
  userBubbleText?: string
  /** Page background. */
  background?: string
  /** Text, and (light) outlines and shadows. */
  ink?: string
}

/** The six public colours and their CSS variables. */
const PUBLIC: Record<keyof Theme, string> = {
  primary: 'primary',
  accent: 'accent',
  userBubble: 'user',
  userBubbleText: 'user-text',
  background: 'bg',
  ink: 'ink',
}

/**
 * Every internal colour in light mode: exactly 0.4.3. The six public ones, then those derived from them
 * (`var(--dr-x)` follows x, so a site's `primary` recolours the header and the cards).
 */
export const LIGHT =
  '--dr-primary:#F6EB37;--dr-accent:#FF5FA2;--dr-user:#2B50E0;--dr-user-text:#fff;--dr-bg:#FFFDF2;--dr-ink:#111;' +
  '--dr-surface:#fff;--dr-muted:#4A4740;--dr-error:#B32619;--dr-success:#1FB85A;--dr-resolved:#CFF2E3;' +
  '--dr-outline:var(--dr-ink);--dr-shadow:var(--dr-outline);--dr-ow:1;' +
  '--dr-on-primary:var(--dr-ink);--dr-header:var(--dr-primary);--dr-on-header:var(--dr-on-primary);' +
  '--dr-on-accent:var(--dr-ink);--dr-card:var(--dr-primary);--dr-on-card:var(--dr-ink);' +
  '--dr-team:var(--dr-surface);--dr-team-text:var(--dr-ink);--dr-notice:var(--dr-surface);' +
  '--dr-lemon:#F6EB37;--dr-on-lemon:var(--dr-ink);--dr-badge:#FF5FA2;--dr-badge-outline:var(--dr-outline);--dr-tag-bg:var(--dr-ink);--dr-tag-text:var(--dr-lemon);' +
  '--dr-focus:var(--dr-user);--dr-overlay:rgba(17,17,17,.94);--dr-placeholder:rgba(74,71,64,.7);--dr-grey:#E9E6D8;' +
  '--dr-code:#F1EEE3;'

/** DevReply's dark palette (0.4.4), "Deep blue": `configure({ key, darkTheme })` uses it whenever the
 *  browser prefers dark. The one place the dark defaults live. */
export const darkTheme: Readonly<Theme> = Object.freeze({
  background: '#0E1320',
  ink: '#EEF1F8',
  primary: '#2B50E0',
  accent: '#FF5FA2',
  userBubble: '#3F6BFF',
  userBubbleText: '#FFFFFF',
})

/** A colour for a style attribute: no `;`, `{`, `}` or quotes that could end the declaration. */
const safe = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !/[;{}"'<>]/.test(v)

/** Only the six public colours, and only safe ones: anything else is ignored. */
function pick(t: Theme | null | undefined): Theme {
  const out: Theme = {}
  for (const key of Object.keys(PUBLIC) as (keyof Theme)[]) {
    const v = (t as Record<string, unknown> | null | undefined)?.[key]
    if (safe(v)) out[key] = v.trim()
  }
  return out
}

type RGB = [number, number, number]

/** `#rgb`, `#rrggbb`, `rgb(…)`/`rgba(…)`; null for anything else (named colours, hsl…). */
function parse(color: string): RGB | null {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1]
  if (h) {
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB
  }
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(color)
  return m ? ([m[1], m[2], m[3]].map(Number) as RGB) : null
}

const hex = (c: RGB) => '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('').toUpperCase()

/** `amount` of the way from `a` to `b` (0.08 = 8 %); CSS color-mix when a colour can't be parsed here. */
export function mix(a: string, b: string, amount: number): string {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return `color-mix(in srgb, ${a} ${Math.round((1 - amount) * 100)}%, ${b})`
  return hex(x.map((v, i) => v + (y[i] - v) * amount) as RGB)
}

const luminance = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** #111111 or #FFFFFF, whichever contrasts better with `color` (#111111 if it can't be parsed). */
export function textOn(color: string): string {
  const c = parse(color)
  if (!c) return '#111111'
  const l = luminance(c)
  return 1.05 / (l + 0.05) > (l + 0.05) / (luminance([17, 17, 17]) + 0.05) ? '#FFFFFF' : '#111111'
}

/** A parseable colour at 70 %, for placeholders; any other colour as it is. */
function faded(color: string): string {
  const c = parse(color)
  return c ? `rgba(${c.join(',')},.7)` : color
}

/** The light theme as inline CSS variables, over the stylesheet's 0.4.3 values. */
export function themeVars(t: Theme): string {
  const own = pick(t)
  return (Object.keys(own) as (keyof Theme)[]).map((k) => `--dr-${PUBLIC[k]}:${own[k]};`).join('')
}

/** The dark look: the site's colours over DevReply's dark palette, everything else derived from them. */
export function darkThemeVars(t: Theme): string {
  const c = { ...darkTheme, ...pick(t) } as Required<Theme>
  // Cards and bubbles: 8 % from the page toward the half-way point of the text and primary colours (sRGB).
  const surface = mix(c.background, mix(c.ink, c.primary, 0.5), 0.08)
  const muted = mix(c.ink, c.background, 0.35)
  const onPrimary = textOn(c.primary)
  const vars: Record<string, string> = {
    primary: c.primary,
    accent: c.accent,
    user: c.userBubble,
    'user-text': c.userBubbleText,
    bg: c.background,
    ink: c.ink,
    surface,
    card: surface,
    notice: surface,
    team: surface,
    grey: surface,
    'team-text': c.ink,
    // Code in team replies (0.5.0): a step further from the bubble toward the text.
    code: mix(surface, c.ink, 0.1),
    'on-card': c.ink,
    muted,
    placeholder: faded(muted),
    error: '#FF8A7E',
    outline: c.ink,
    ow: '0.5',
    shadow: mix(c.background, '#000000', 0.6),
    header: c.primary,
    'on-header': onPrimary,
    'on-primary': onPrimary,
    'on-accent': textOn(c.accent),
    // The small brand touches stay lemon: the team tag, avatar tiles, the unread badges.
    lemon: '#F6EB37',
    'on-lemon': '#111111',
    badge: '#F6EB37',
    // Lemon on the lemon launcher: a dark ring keeps the count apart from it.
    'badge-outline': '#111111',
    'tag-bg': '#F6EB37',
    'tag-text': '#111111',
  }
  return Object.entries(vars).map(([k, v]) => `--dr-${k}:${v};`).join('') + 'color-scheme:dark;'
}

/** @font-face has to live in the page (shadow roots can't declare fonts); unique names, so no clash. Latin and
 *  Latin Extended (Polish, Turkish, Czech…): the browser loads the second file only for those letters.
 *  Greek, Cyrillic, Japanese, Korean and Chinese use the system font. */
export function fontFaces(base: string): string {
  return `
@font-face{font-family:"DevReply Archivo Black";src:url("${base}fonts/archivo-black-latin.woff2") format("woff2");font-weight:400;font-display:swap;unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:"DevReply Archivo Black";src:url("${base}fonts/archivo-black-latin-ext.woff2") format("woff2");font-weight:400;font-display:swap;unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:"DevReply Space Grotesk";src:url("${base}fonts/space-grotesk-latin.woff2") format("woff2");font-weight:300 700;font-display:swap;unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:"DevReply Space Grotesk";src:url("${base}fonts/space-grotesk-latin-ext.woff2") format("woff2");font-weight:300 700;font-display:swap;unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}`
}

export const css = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.dr{${LIGHT}
  --dr-text:"DevReply Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --dr-display:"DevReply Archivo Black","Arial Black",ui-sans-serif,system-ui,sans-serif;
  font-family:var(--dr-text);color:var(--dr-ink);font-size:16px;line-height:1.35;-webkit-font-smoothing:antialiased;
  -webkit-tap-highlight-color:transparent}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit}
button:disabled{cursor:default}
button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid var(--dr-focus);outline-offset:2px}
svg{display:block;width:100%;height:100%}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---- launcher ---- */
.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;
  background:#111;border:3px solid #111;box-shadow:4px 4px 0 #FF5FA2;display:grid;place-items:center;
  transition:transform .12s,box-shadow .12s;animation:dr-pop .4s cubic-bezier(.3,1.6,.5,1)}
.launcher:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #FF5FA2}
/* The DevReply star always sits on black (spec 11), like devreply.com's launcher. */
.launcher .mark{width:40px;height:40px}
.launcher .x{width:24px;height:24px;color:#F5EF3D}
.badge{position:absolute;top:-8px;right:-8px;min-width:24px;height:24px;padding:0 6px;border-radius:12px;background:var(--dr-badge);
  border:calc(2.5px * var(--dr-ow)) solid var(--dr-badge-outline);font:700 13px/19px var(--dr-text);text-align:center;color:var(--dr-on-lemon)}
@keyframes dr-pop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}

/* ---- panel ---- */
.panel{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:400px;height:min(700px,calc(100vh - 120px));
  display:flex;flex-direction:column;overflow:hidden;background:var(--dr-bg);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);
  box-shadow:6px 6px 0 var(--dr-shadow);animation:dr-up .22s ease-out}
@keyframes dr-up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@media (max-width:520px){
  .panel{inset:0;width:auto;height:auto;border:0;box-shadow:none;height:100dvh}
  .open .launcher{display:none}
}
.screen{flex:1;display:flex;flex-direction:column;min-height:0}

/* ---- shared ---- */
.kicker{font:700 12px/1 var(--dr-text);letter-spacing:.1em;text-transform:uppercase}
[dir=rtl] .kicker{letter-spacing:0}
.kicker.inv{display:inline-block;background:var(--dr-tag-bg);color:var(--dr-tag-text);padding:5px 8px}
.brutal{background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:5px 5px 0 var(--dr-shadow)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--dr-accent);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);
  box-shadow:4px 4px 0 var(--dr-shadow);color:var(--dr-on-accent);font-weight:700;min-height:44px;padding:0 16px;transition:transform .08s,box-shadow .08s}
.btn:active:not(:disabled){transform:translate(3px,3px);box-shadow:1px 1px 0 var(--dr-shadow)}
.btn:disabled{opacity:.5}
.icon-btn{width:40px;height:40px;display:grid;place-items:center;color:var(--dr-ink);background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow);flex:none}
.icon-btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--dr-shadow)}
.icon-btn .i{width:20px;height:20px}
.avatar{display:grid;place-items:center;flex:none;color:var(--dr-ink);background:var(--dr-surface);border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);font-family:var(--dr-display);line-height:1}
.avatar.on-lemon{color:var(--dr-on-lemon)}
.muted{color:var(--dr-muted)}
.error{color:var(--dr-error);font-weight:700;font-size:13px}
.field{width:100%;height:46px;padding:0 12px;background:var(--dr-surface);border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);border-radius:0;font:17px var(--dr-text);color:var(--dr-ink);outline:none}
.field::placeholder{color:var(--dr-placeholder)}

/* ---- home ---- */
.home{flex:1;overflow-y:auto;overscroll-behavior:contain}
.home-head{color:var(--dr-on-header);background:var(--dr-header);border-bottom:calc(3px * var(--dr-ow)) solid var(--dr-outline);padding:18px 18px 22px}
.home-top{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.home-top .kicker{flex:1}
.greeting{font:34px/1.05 var(--dr-display);margin:0 0 10px}
.intro{font-size:17px;font-weight:500;margin:0 0 16px}
.chip{display:inline-flex;align-items:center;gap:8px;color:var(--dr-ink);background:var(--dr-surface);border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow);
  padding:6px 10px;font-size:14px;font-weight:600}
.dot{width:10px;height:10px;background:var(--dr-success);border:calc(2px * var(--dr-ow)) solid var(--dr-outline)}
.home-body{padding:18px;display:flex;flex-direction:column;gap:14px}
.h2{font:20px/1.1 var(--dr-display);margin:6px 0 0}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tile{display:flex;flex-direction:column;gap:12px;min-height:118px;padding:14px;background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);
  box-shadow:5px 5px 0 var(--dr-shadow);font-weight:700;font-size:16px;transition:transform .08s,box-shadow .08s}
.tile:active{transform:translate(4px,4px);box-shadow:1px 1px 0 var(--dr-shadow)}
.tile .cat{width:36px;height:36px}
.conv{display:flex;gap:12px;align-items:center;width:100%;padding:12px 14px;background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:4px 4px 0 var(--dr-shadow)}
.conv:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--dr-shadow)}
.conv .cat{width:28px;height:28px;flex:none}
.conv-text{flex:1;min-width:0}
.conv-top{display:flex;gap:8px;align-items:baseline}
.conv-top .when{margin-inline-start:auto;font-size:12px;color:var(--dr-muted);white-space:nowrap}
.conv-last{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resolved{font-size:11px;font-weight:700;padding:1px 6px;color:var(--dr-on-lemon);background:var(--dr-resolved);border:calc(1.5px * var(--dr-ow)) solid var(--dr-outline)}
.conv.closed{opacity:.7}
.count{min-width:22px;height:22px;padding:0 5px;border-radius:11px;color:var(--dr-on-lemon);background:var(--dr-badge);border:calc(2px * var(--dr-ow)) solid var(--dr-outline);
  font-size:12px;font-weight:700;text-align:center;line-height:18px}
.powered{font-size:12px;color:var(--dr-muted);text-align:center;padding:6px 0 4px}
.powered a{color:inherit}

/* ---- chat ---- */
.bar{display:flex;align-items:center;gap:12px;padding:10px 14px 12px;color:var(--dr-on-header);background:var(--dr-header);border-bottom:calc(3px * var(--dr-ow)) solid var(--dr-outline);flex:none}
.bar-name{font:16px/1.1 var(--dr-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-sub{font-size:11px;font-weight:500;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-text{flex:1;min-width:0}
.bar .close{margin-inline-start:auto}
/* Inverted: newest at the bottom, pinned there by the layout; nothing ever scrolls in code. */
.thread{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column-reverse;padding:8px 16px 12px}
.thread-inner{display:flex;flex-direction:column;gap:10px}
.empty{flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;padding:32px 20px}
.empty .big{width:100px;height:100px;padding:18px;background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:6px 6px 0 var(--dr-shadow)}
.empty h2{font:26px/1.1 var(--dr-display);margin:0}
.empty p{margin:0;font-size:16px;font-weight:500;color:var(--dr-muted)}
.time{text-align:center;padding-top:12px}
.row.persona{padding-inline-end:48px}
.by{display:flex;align-items:center;gap:7px;margin:4px 0 2px;font-size:13px}
.by b{font-weight:700}
.by .muted{font-size:12px}
.by .avatar{border-width:calc(2px * var(--dr-ow))}
.reply-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.faces{display:flex}
.faces .avatar{margin-inline-start:-8px;box-shadow:none}
.faces .avatar:first-child{margin-inline-start:0}
.row{display:flex;align-items:flex-end;gap:10px}
.row.me{justify-content:flex-end;padding-inline-start:48px}
.row.team{padding-inline-end:48px}
.stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.row.me .stack{align-items:flex-end}
.bubble{padding:11px 14px;font-size:17px;font-weight:500;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:14px}
.bubble.me{background:var(--dr-user);color:var(--dr-user-text)}
.bubble.team{color:var(--dr-team-text);background:var(--dr-team);border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow)}
.bubble.muted{color:var(--dr-muted)}
/* Team replies in Markdown (0.5.0): elements, never HTML strings. Logical sides, so quotes and lists follow RTL. */
.md{display:flex;flex-direction:column;gap:8px;min-width:0}
.md p,.md ul,.md ol,.md blockquote,.md pre{margin:0}
.md .md-h{font-weight:700;font-size:19px;line-height:1.25}
.md ul,.md ol{padding-inline-start:24px;display:flex;flex-direction:column;gap:4px}
.md li::marker{font-weight:700}
.md strong{font-weight:700}
.md a{color:inherit;font-weight:700;text-decoration:underline;text-decoration-color:var(--dr-accent);text-decoration-thickness:3px;text-underline-offset:3px}
.md code{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;padding:1px 5px;background:var(--dr-code);
  border:calc(1.5px * var(--dr-ow)) solid var(--dr-outline);border-radius:4px}
.md pre{overflow-x:auto;padding:10px 12px;background:var(--dr-code);border:calc(2px * var(--dr-ow)) solid var(--dr-outline);border-radius:6px;white-space:pre;
  text-align:left;overscroll-behavior-x:contain}
.md pre code{padding:0;border:0;background:none;font-size:14px;line-height:1.45;border-radius:0}
.md blockquote{padding-inline-start:12px;border-inline-start:4px solid var(--dr-outline);color:var(--dr-muted);font-style:normal}
/* Button replies (0.5.0): the options under the question, Loud like the start tiles. Chosen: the primary
   colour and a check; the rest go quiet. */
.choices{display:flex;flex-direction:column;align-items:stretch;gap:8px;max-width:300px;margin-top:2px}
.choice{display:flex;align-items:center;gap:10px;min-height:44px;padding:10px 14px;text-align:start;color:var(--dr-ink);background:var(--dr-surface);
  border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow);font-size:16px;font-weight:700;line-height:1.25;
  overflow-wrap:anywhere;transition:transform .08s,box-shadow .08s,background-color .08s}
@media (hover:hover){.choice:hover:not(:disabled){color:var(--dr-on-primary);background:var(--dr-primary)}}
.choice:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--dr-shadow)}
.choice-label{flex:1;min-width:0}
.choice-check{flex:none;font-size:17px;line-height:1}
.choice.chosen{color:var(--dr-on-primary);background:var(--dr-primary);border-width:calc(3px * var(--dr-ow))}
.choices.answered .choice:not(.chosen){opacity:.45;box-shadow:none;font-weight:600}
.system{text-align:center;font-size:13px;font-weight:700;color:var(--dr-muted);padding:6px 0}
.photo{display:block;max-width:220px;max-height:260px;border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:4px 4px 0 var(--dr-shadow);background:var(--dr-grey);cursor:zoom-in}
.photo img{display:block;max-width:214px;max-height:254px;object-fit:cover}
.filechip{display:flex;align-items:center;gap:12px;max-width:250px;padding:10px;background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);
  box-shadow:3px 3px 0 var(--dr-shadow);color:var(--dr-ink);text-decoration:none}
.filechip .fi{width:40px;height:44px;flex:none;display:grid;place-items:center;color:var(--dr-on-lemon);background:var(--dr-lemon);border:calc(2px * var(--dr-ow)) solid var(--dr-outline)}
.filechip .fi .i{width:20px;height:20px}
.filechip b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filechip small{font-size:12px;color:var(--dr-muted)}
.pending{opacity:.7}
.failed{display:flex;align-items:center;gap:6px;color:var(--dr-error);font-size:12px;font-weight:700}
.failed .i{width:14px;height:14px}
.notice{display:flex;gap:12px;padding:12px;background:var(--dr-notice);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow);margin:4px 4px 0 0}
.notice b{display:block;font-size:15px;margin-bottom:4px}
.notice p{margin:0;font-size:14px;font-weight:500}

/* ---- bottom: composer, name form, email ask ---- */
.bottom{flex:none}
.card{color:var(--dr-on-card);background:var(--dr-card);border-top:calc(3px * var(--dr-ow)) solid var(--dr-outline);padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.card-row{display:flex;gap:10px;align-items:center}
.card-title{font-weight:700;font-size:15px;flex:1}
.link{font-weight:700;font-size:14px;color:var(--dr-muted)}
.composer{background:var(--dr-surface);border-top:calc(3px * var(--dr-ow)) solid var(--dr-outline);padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
.composer-row{display:flex;gap:10px;align-items:flex-end}
.composer textarea{flex:1;min-height:46px;max-height:140px;padding:11px 14px;border:calc(3px * var(--dr-ow)) solid var(--dr-outline);border-radius:0;resize:none;
  font:17px/1.3 var(--dr-text);color:var(--dr-ink);background:var(--dr-surface);outline:none}
.composer textarea::placeholder{color:var(--dr-placeholder)}
.send{width:46px;height:46px;flex:none;display:grid;place-items:center;color:var(--dr-on-accent);background:var(--dr-accent);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:3px 3px 0 var(--dr-shadow)}
.send .i{width:22px;height:22px}
.send:disabled{opacity:.45}
.send:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--dr-shadow)}
.attach{position:relative}
.attach .icon-btn{width:46px;height:46px}
[dir=rtl] .flips svg{transform:scaleX(-1)}
.menu{position:absolute;bottom:56px;inset-inline-start:0;background:var(--dr-surface);border:calc(3px * var(--dr-ow)) solid var(--dr-outline);box-shadow:4px 4px 0 var(--dr-shadow);display:flex;flex-direction:column;min-width:150px;z-index:2}
.menu button{display:flex;align-items:center;gap:10px;padding:12px 14px;font-weight:600}
.menu button:hover{color:var(--dr-on-lemon);background:var(--dr-lemon)}
.menu .i{width:20px;height:20px}
.staged{display:flex;gap:12px;overflow-x:auto;padding:8px 8px 0 0}
.thumb{position:relative;width:64px;height:64px;flex:none;border:calc(2.5px * var(--dr-ow)) solid var(--dr-outline);color:var(--dr-on-lemon);background:var(--dr-lemon);display:grid;place-items:center;
  font-size:10px;font-weight:700;text-align:center;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover}
.thumb .rm{position:absolute;top:-2px;inset-inline-end:-2px;width:22px;height:22px;color:var(--dr-on-lemon);background:var(--dr-badge);border:calc(2px * var(--dr-ow)) solid var(--dr-outline);display:grid;place-items:center}
.thumb .rm .i{width:12px;height:12px}
.viewer{position:absolute;inset:0;z-index:3;background:var(--dr-overlay);display:grid;place-items:center;padding:20px}
.viewer img{max-width:100%;max-height:100%;object-fit:contain}
.viewer .icon-btn{position:absolute;top:16px;inset-inline-end:16px;color:var(--dr-on-lemon);background:var(--dr-lemon)}
.i{display:inline-block}
.spin{width:24px;height:24px;border:3px solid var(--dr-ink);border-top-color:transparent;border-radius:50%;animation:dr-spin .8s linear infinite;margin:40px auto}
@keyframes dr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`
