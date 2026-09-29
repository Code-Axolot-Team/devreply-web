// The messenger's CSS, inside a shadow root: the host page's styles can't reach it, and ours never leak
// out. DevReply's "Loud" look (spec 11), the same as iOS and Android. Colours come from CSS variables,
// so the host app can pass its own (DevReply.configure({ theme })).

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
  /** Outlines, shadows, text. */
  ink?: string
}

export function themeVars(t: Theme): string {
  const v = (name: string, value: string | undefined) => (value ? `--dr-${name}:${value};` : '')
  return (
    v('primary', t.primary) +
    v('accent', t.accent) +
    v('user', t.userBubble) +
    v('user-text', t.userBubbleText) +
    v('bg', t.background) +
    v('ink', t.ink)
  )
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
.dr{--dr-primary:#F6EB37;--dr-accent:#FF5FA2;--dr-user:#2B50E0;--dr-user-text:#fff;--dr-bg:#FFFDF2;--dr-ink:#111;
  --dr-lemon:#F6EB37;--dr-pink:#FF5FA2;--dr-muted:#4A4740;--dr-grey:#E9E6D8;--dr-error:#B32619;--dr-online:#1FB85A;
  --dr-text:"DevReply Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --dr-display:"DevReply Archivo Black","Arial Black",ui-sans-serif,system-ui,sans-serif;
  font-family:var(--dr-text);color:var(--dr-ink);font-size:16px;line-height:1.35;-webkit-font-smoothing:antialiased;
  -webkit-tap-highlight-color:transparent}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit}
button:disabled{cursor:default}
button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid var(--dr-user);outline-offset:2px}
svg{display:block;width:100%;height:100%}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---- launcher ---- */
.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;
  background:var(--dr-lemon);border:3px solid var(--dr-ink);box-shadow:4px 4px 0 var(--dr-ink);display:grid;place-items:center;
  transition:transform .12s,box-shadow .12s;animation:dr-pop .4s cubic-bezier(.3,1.6,.5,1)}
.launcher:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--dr-ink)}
.launcher .mark{width:32px;height:32px;margin-top:3px}
.launcher .x{width:24px;height:24px;color:var(--dr-ink)}
.badge{position:absolute;top:-8px;right:-8px;min-width:24px;height:24px;padding:0 6px;border-radius:12px;background:var(--dr-pink);
  border:2.5px solid var(--dr-ink);font:700 13px/19px var(--dr-text);text-align:center;color:var(--dr-ink)}
@keyframes dr-pop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}

/* ---- panel ---- */
.panel{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:400px;height:min(700px,calc(100vh - 120px));
  display:flex;flex-direction:column;overflow:hidden;background:var(--dr-bg);border:3px solid var(--dr-ink);
  box-shadow:6px 6px 0 var(--dr-ink);animation:dr-up .22s ease-out}
@keyframes dr-up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@media (max-width:520px){
  .panel{inset:0;width:auto;height:auto;border:0;box-shadow:none;height:100dvh}
  .open .launcher{display:none}
}
.screen{flex:1;display:flex;flex-direction:column;min-height:0}

/* ---- shared ---- */
.kicker{font:700 12px/1 var(--dr-text);letter-spacing:.1em;text-transform:uppercase}
.kicker.inv{display:inline-block;background:var(--dr-ink);color:var(--dr-lemon);padding:5px 8px}
.brutal{background:#fff;border:3px solid var(--dr-ink);box-shadow:5px 5px 0 var(--dr-ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--dr-accent);border:3px solid var(--dr-ink);
  box-shadow:4px 4px 0 var(--dr-ink);font-weight:700;min-height:44px;padding:0 16px;transition:transform .08s,box-shadow .08s}
.btn:active:not(:disabled){transform:translate(3px,3px);box-shadow:1px 1px 0 var(--dr-ink)}
.btn:disabled{opacity:.5}
.icon-btn{width:40px;height:40px;display:grid;place-items:center;background:#fff;border:3px solid var(--dr-ink);box-shadow:3px 3px 0 var(--dr-ink);flex:none}
.icon-btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--dr-ink)}
.icon-btn .i{width:20px;height:20px}
.avatar{display:grid;place-items:center;flex:none;background:#fff;border:2.5px solid var(--dr-ink);font-family:var(--dr-display);line-height:1}
.muted{color:var(--dr-muted)}
.error{color:var(--dr-error);font-weight:700;font-size:13px}
.field{width:100%;height:46px;padding:0 12px;background:#fff;border:2.5px solid var(--dr-ink);border-radius:0;font:17px var(--dr-text);color:var(--dr-ink);outline:none}
.field::placeholder{color:rgba(74,71,64,.7)}

/* ---- home ---- */
.home{flex:1;overflow-y:auto;overscroll-behavior:contain}
.home-head{background:var(--dr-primary);border-bottom:3px solid var(--dr-ink);padding:18px 18px 22px}
.home-top{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.home-top .kicker{flex:1}
.greeting{font:34px/1.05 var(--dr-display);margin:0 0 10px}
.intro{font-size:17px;font-weight:500;margin:0 0 16px}
.chip{display:inline-flex;align-items:center;gap:8px;background:#fff;border:2.5px solid var(--dr-ink);box-shadow:3px 3px 0 var(--dr-ink);
  padding:6px 10px;font-size:14px;font-weight:600}
.dot{width:10px;height:10px;background:var(--dr-online);border:2px solid var(--dr-ink)}
.home-body{padding:18px;display:flex;flex-direction:column;gap:14px}
.h2{font:20px/1.1 var(--dr-display);margin:6px 0 0}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tile{display:flex;flex-direction:column;gap:12px;min-height:118px;padding:14px;background:#fff;border:3px solid var(--dr-ink);
  box-shadow:5px 5px 0 var(--dr-ink);font-weight:700;font-size:16px;transition:transform .08s,box-shadow .08s}
.tile:active{transform:translate(4px,4px);box-shadow:1px 1px 0 var(--dr-ink)}
.tile .cat{width:36px;height:36px}
.conv{display:flex;gap:12px;align-items:center;width:100%;padding:12px 14px;background:#fff;border:3px solid var(--dr-ink);box-shadow:4px 4px 0 var(--dr-ink)}
.conv:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--dr-ink)}
.conv .cat{width:28px;height:28px;flex:none}
.conv-text{flex:1;min-width:0}
.conv-top{display:flex;gap:8px;align-items:baseline}
.conv-top .when{margin-left:auto;font-size:12px;color:var(--dr-muted);white-space:nowrap}
.conv-last{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resolved{font-size:11px;font-weight:700;padding:1px 6px;background:#CFF2E3;border:1.5px solid var(--dr-ink)}
.conv.closed{opacity:.7}
.count{min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--dr-pink);border:2px solid var(--dr-ink);
  font-size:12px;font-weight:700;text-align:center;line-height:18px}
.powered{font-size:12px;color:var(--dr-muted);text-align:center;padding:6px 0 4px}
.powered a{color:inherit}

/* ---- chat ---- */
.bar{display:flex;align-items:center;gap:12px;padding:10px 14px 12px;background:var(--dr-primary);border-bottom:3px solid var(--dr-ink);flex:none}
.bar-name{font:16px/1.1 var(--dr-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-sub{font-size:11px;font-weight:500;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-text{flex:1;min-width:0}
.bar .close{margin-left:auto}
/* Inverted: newest at the bottom, pinned there by the layout; nothing ever scrolls in code. */
.thread{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column-reverse;padding:8px 16px 12px}
.thread-inner{display:flex;flex-direction:column;gap:10px}
.empty{flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;padding:32px 20px}
.empty .big{width:100px;height:100px;padding:18px;background:#fff;border:3px solid var(--dr-ink);box-shadow:6px 6px 0 var(--dr-ink)}
.empty h2{font:26px/1.1 var(--dr-display);margin:0}
.empty p{margin:0;font-size:16px;font-weight:500;color:var(--dr-muted)}
.time{text-align:center;padding-top:12px}
.row.persona{padding-right:48px}
.by{display:flex;align-items:center;gap:7px;margin:4px 0 2px;font-size:13px}
.by b{font-weight:700}
.by .muted{font-size:12px}
.by .avatar{border-width:2px}
.reply-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.faces{display:flex}
.faces .avatar{margin-left:-8px;box-shadow:none}
.faces .avatar:first-child{margin-left:0}
.row{display:flex;align-items:flex-end;gap:10px}
.row.me{justify-content:flex-end;padding-left:48px}
.row.team{padding-right:48px}
.stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.row.me .stack{align-items:flex-end}
.bubble{padding:11px 14px;font-size:17px;font-weight:500;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:14px}
.bubble.me{background:var(--dr-user);color:var(--dr-user-text)}
.bubble.team{background:#fff;border:2.5px solid var(--dr-ink);box-shadow:3px 3px 0 var(--dr-ink)}
.bubble.muted{color:var(--dr-muted)}
.system{text-align:center;font-size:13px;font-weight:700;color:var(--dr-muted);padding:6px 0}
.photo{display:block;max-width:220px;max-height:260px;border:3px solid var(--dr-ink);box-shadow:4px 4px 0 var(--dr-ink);background:var(--dr-grey);cursor:zoom-in}
.photo img{display:block;max-width:214px;max-height:254px;object-fit:cover}
.filechip{display:flex;align-items:center;gap:12px;max-width:250px;padding:10px;background:#fff;border:3px solid var(--dr-ink);
  box-shadow:3px 3px 0 var(--dr-ink);color:var(--dr-ink);text-decoration:none}
.filechip .fi{width:40px;height:44px;flex:none;display:grid;place-items:center;background:var(--dr-lemon);border:2px solid var(--dr-ink)}
.filechip .fi .i{width:20px;height:20px}
.filechip b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filechip small{font-size:12px;color:var(--dr-muted)}
.pending{opacity:.7}
.failed{display:flex;align-items:center;gap:6px;color:var(--dr-error);font-size:12px;font-weight:700}
.failed .i{width:14px;height:14px}
.notice{display:flex;gap:12px;padding:12px;background:#fff;border:3px solid var(--dr-ink);box-shadow:3px 3px 0 var(--dr-ink);margin:4px 4px 0 0}
.notice b{display:block;font-size:15px;margin-bottom:4px}
.notice p{margin:0;font-size:14px;font-weight:500}

/* ---- bottom: composer, name form, email ask ---- */
.bottom{flex:none}
.card{background:var(--dr-lemon);border-top:3px solid var(--dr-ink);padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.card-row{display:flex;gap:10px;align-items:center}
.card-title{font-weight:700;font-size:15px;flex:1}
.link{font-weight:700;font-size:14px;color:var(--dr-muted)}
.composer{background:#fff;border-top:3px solid var(--dr-ink);padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
.composer-row{display:flex;gap:10px;align-items:flex-end}
.composer textarea{flex:1;min-height:46px;max-height:140px;padding:11px 14px;border:3px solid var(--dr-ink);border-radius:0;resize:none;
  font:17px/1.3 var(--dr-text);color:var(--dr-ink);background:#fff;outline:none}
.composer textarea::placeholder{color:rgba(74,71,64,.7)}
.send{width:46px;height:46px;flex:none;display:grid;place-items:center;background:var(--dr-accent);border:3px solid var(--dr-ink);box-shadow:3px 3px 0 var(--dr-ink)}
.send .i{width:22px;height:22px}
.send:disabled{opacity:.45}
.send:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--dr-ink)}
.attach{position:relative}
.attach .icon-btn{width:46px;height:46px}
.menu{position:absolute;bottom:56px;left:0;background:#fff;border:3px solid var(--dr-ink);box-shadow:4px 4px 0 var(--dr-ink);display:flex;flex-direction:column;min-width:150px;z-index:2}
.menu button{display:flex;align-items:center;gap:10px;padding:12px 14px;font-weight:600}
.menu button:hover{background:var(--dr-lemon)}
.menu .i{width:20px;height:20px}
.staged{display:flex;gap:12px;overflow-x:auto;padding:8px 8px 0 0}
.thumb{position:relative;width:64px;height:64px;flex:none;border:2.5px solid var(--dr-ink);background:var(--dr-lemon);display:grid;place-items:center;
  font-size:10px;font-weight:700;text-align:center;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover}
.thumb .rm{position:absolute;top:-2px;right:-2px;width:22px;height:22px;background:var(--dr-pink);border:2px solid var(--dr-ink);display:grid;place-items:center}
.thumb .rm .i{width:12px;height:12px}
.viewer{position:absolute;inset:0;z-index:3;background:rgba(17,17,17,.94);display:grid;place-items:center;padding:20px}
.viewer img{max-width:100%;max-height:100%;object-fit:contain}
.viewer .icon-btn{position:absolute;top:16px;right:16px;background:var(--dr-lemon)}
.i{display:inline-block}
.spin{width:24px;height:24px;border:3px solid var(--dr-ink);border-top-color:transparent;border-radius:50%;animation:dr-spin .8s linear infinite;margin:40px auto}
@keyframes dr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`
