// The DevReply web API, shared by the script tag (index.tsx) and the npm package (module.ts).
// Nothing here touches the page until configure() runs in a browser, so importing it during
// server rendering (Next.js, Remix, SvelteKit…) is safe.
import { render } from 'preact'
import { type Category, CATEGORIES, SDK_VERSION, contextOf } from './api'
import { setLocaleOverride } from './i18n'
import { type Attribute, type DevReplyEvent, type DevReplyEvents, type LauncherMode, store } from './store'
import { type Theme, css, darkTheme, darkThemeVars, fontFaces, themeVars } from './styles'
import { App } from './ui/App'

const DEFAULT_API = 'https://api.devreply.com'
/** Where the brand fonts are served; the script tag passes its own folder. */
let fontsBase = 'https://api.devreply.com/sdk/web/v0/'

export function setFontsBase(base: string) {
  fontsBase = base
}

export interface Options {
  /** The app's web public key (`pk_…`), from DevReply → Settings → Platforms → Web. Safe in the page. */
  key: string
  /** `always` (default): the round button bottom right. `unread`: only while a reply waits. `none`: your own button. */
  launcher?: LauncherMode
  /** Your colours. */
  theme?: Theme
  /** Colours for when the browser prefers dark (0.4.4), e.g. DevReply's own `darkTheme` preset. Left out
   *  (the default), the chat stays light. Colours you leave out come from the preset. */
  darkTheme?: Theme
  /** Shown to the team as the "app version" (default: the site's hostname). */
  appVersion?: string
  /** Override only for local development. */
  apiUrl?: string
  /** `devreply` (default): the brand fonts from api.devreply.com. `system`: the device's fonts, nothing loaded. */
  fonts?: 'devreply' | 'system'
  /** The chat's language, e.g. `es` or `pt-BR`. Default: the browser's. */
  locale?: string
}

/** What `open` / `present` takes (0.4.4). */
export interface OpenOptions {
  /** Straight into a new conversation of this kind. */
  category?: Category
  /** Prefills the composer of the new conversation this opens (never sent by itself; the user can edit it). */
  message?: string
  /** Context the team sees on that new conversation only: at most 20, text, number or true/false. */
  attributes?: Record<string, string | number | boolean>
}

let mounted = false
let useBrandFonts = true

function setTheme(themes: { light?: Theme | null; dark?: Theme | null }) {
  const next = { ...store.theme }
  if (themes.light !== undefined) next.light = themes.light ? themeVars(themes.light) : ''
  if (themes.dark !== undefined) next.dark = themes.dark ? darkThemeVars(themes.dark) : null
  store.theme = next
  store.emit()
}

/** `open()`, `open('bug')`, `open({ category, message, attributes })` or `open('bug', { message, attributes })`. */
function open(categoryOrOptions?: Category | OpenOptions | null, more?: OpenOptions): boolean {
  const o: OpenOptions =
    categoryOrOptions && typeof categoryOrOptions === 'object'
      ? categoryOrOptions
      : { ...more, category: categoryOrOptions ?? more?.category }
  const c = o.category && CATEGORIES.includes(o.category) ? o.category : null
  const message = typeof o.message === 'string' && o.message.trim() ? o.message : undefined
  const context = contextOf(o.attributes)
  return store.open(c ? { screen: 'chat', conversationId: null, category: c } : undefined, {
    ...(message ? { message } : {}),
    ...(Object.keys(context).length ? { context } : {}),
  })
}

function mount() {
  if (mounted) return
  mounted = true
  if (useBrandFonts && !document.getElementById('devreply-fonts')) {
    const fonts = document.createElement('style')
    fonts.id = 'devreply-fonts'
    fonts.textContent = fontFaces(fontsBase)
    document.head.appendChild(fonts)
  }
  const host = document.createElement('div')
  host.id = 'devreply-root'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  root.appendChild(style)
  const container = document.createElement('div')
  root.appendChild(container)
  render(<App />, container)
}

function configure(options: Options | string) {
  if (typeof window === 'undefined') return // server rendering: nothing to do
  const o: Options = typeof options === 'string' ? { key: options } : options
  if (!o.key?.startsWith('pk_')) {
    console.warn('DevReply: configure needs the web public key (pk_…). Never put a secret key (sk_…) in a page.')
    return
  }
  if (o.launcher) store.launcher = o.launcher
  if (o.theme || o.darkTheme) setTheme({ light: o.theme, dark: o.darkTheme })
  if (o.fonts === 'system') useBrandFonts = false
  if (o.locale) setLocaleOverride(o.locale)
  store.configure(o.key, o.apiUrl ?? DEFAULT_API, o.appVersion)
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
  // Opened from a DevReply email ("Reply in the app"): straight into that conversation.
  handle(window.location.href, true)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A DevReply link (`…?devreply=<conversation id>`) opens that conversation. Returns whether it was one. */
function handle(url: string | URL, cleanAddressBar = false): boolean {
  let parsed: URL
  try {
    parsed = new URL(String(url), typeof window === 'undefined' ? 'https://x.invalid' : window.location.href)
  } catch {
    return false
  }
  const id = parsed.searchParams.get('devreply')
  if (!id || !UUID.test(id)) return false
  if (cleanAddressBar && typeof history !== 'undefined') {
    parsed.searchParams.delete('devreply')
    history.replaceState(history.state, '', parsed.pathname + parsed.search + parsed.hash)
  }
  void store.openFromLink(id.toLowerCase())
  return true
}

export const DevReply = {
  version: SDK_VERSION,
  configure,
  /**
   * Opens the messenger. With a category, straight into a new conversation. `message` prefills that new
   * conversation's composer (with no category: once the user picks a start button); `attributes` go with
   * it as its context. Returns false, showing nothing, when DevReply isn't configured or the team
   * switched the chat off (`isAvailable`).
   */
  open,
  /** The same as `open`, named like the iOS and Android SDKs' `present`. */
  present: open,
  close() {
    store.close()
  },
  /**
   * Opens the conversation a DevReply link points to (`?devreply=<id>`, the button in DevReply's
   * emails). `configure()` already does this for the page's own URL; call it for URLs your router
   * handles itself. Returns false for any other URL.
   */
  handle(url: string | URL): boolean {
    return handle(url)
  },
  /**
   * The chat's language: `es`, `pt-BR`, `ja`… (15 languages; others fall back to English), or null to
   * follow the browser. Takes effect at once, even with the chat open.
   */
  setLocale(tag: string | null) {
    store.setLocale(tag)
  },
  /** The language the chat shows now, e.g. `es`. */
  get language(): string {
    return store.language
  },
  /** After your user signs in: your own id for them (never an email or a secret). If someone else was
   *  signed in in this browser, DevReply logs them out first. */
  login(userId: string) {
    store.login(userId)
  },
  /** When your user signs out: this browser forgets their chats; the next person starts empty. */
  logout() {
    store.logout()
  },
  /**
   * When your user deletes their account: deletes their data, conversations and files from DevReply,
   * and this browser forgets the user (like `logout`). Resolves to true when the server deleted it now;
   * false when it couldn't be reached (or failed): the browser has already forgotten the user, and
   * DevReply keeps retrying the deletion on every page load and whenever the tab comes back.
   */
  deleteUser(): Promise<boolean> {
    return store.deleteUser()
  },
  /** Who the user is, if the site knows. With a name set, the chat doesn't ask for one. */
  setUser(user: { name?: string; email?: string }) {
    store.setUser(user)
  },
  /** Custom attributes the team sees next to the user. `null` removes one. Text, number or true/false. */
  setAttributes(attributes: Record<string, Attribute>) {
    store.setAttributes(attributes)
  },
  /**
   * False when DevReply isn't configured or the team switched the chat off in the dashboard: then `open`
   * does nothing and the launcher hides. True before the first config arrives.
   */
  get isAvailable(): boolean {
    return store.isAvailable
  },
  /**
   * For your analytics: `open`, `close`, `conversationStarted` ({ conversationId, category }) and
   * `messageSent` ({ conversationId }, after the server accepted it). Returns a function that stops it.
   */
  on<E extends DevReplyEvent>(event: E, fn: (payload: DevReplyEvents[E]) => void): () => void {
    return store.on(event, fn)
  },
  /** Changes the colours at any time: `light` (null: DevReply's), `dark` (null: stays light). */
  setTheme,
  /** DevReply's own dark palette, for `configure({ key, darkTheme: DevReply.darkTheme })`. */
  darkTheme,
  /** Unread replies from the team. */
  get unreadCount() {
    return store.unreadCount
  },
  /** Called with the unread count whenever it changes. Returns a function that stops it. */
  onUnreadChange(fn: (count: number) => void): () => void {
    let last = store.unreadCount
    fn(last)
    return store.subscribe(() => {
      if (store.unreadCount !== last) fn((last = store.unreadCount))
    })
  },
  /** `always`, `unread` or `none`. */
  set launcher(mode: LauncherMode) {
    store.launcher = mode
    store.emit()
  },
  get launcher(): LauncherMode {
    return store.launcher
  },
  refresh: () => store.refresh(),
}

export type DevReplyApi = typeof DevReply


