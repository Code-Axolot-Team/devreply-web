// The DevReply web API, shared by the script tag (index.tsx) and the npm package (module.ts).
// Nothing here touches the page until configure() runs in a browser, so importing it during
// server rendering (Next.js, Remix, SvelteKit…) is safe.
import { render } from 'preact'
import { type Category, CATEGORIES, SDK_VERSION } from './api'
import { setLocaleOverride } from './i18n'
import { type Attribute, type LauncherMode, store } from './store'
import { type Theme, css, fontFaces, themeVars } from './styles'
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
  /** Shown to the team as the "app version" (default: the site's hostname). */
  appVersion?: string
  /** Override only for local development. */
  apiUrl?: string
  /** `devreply` (default): the brand fonts from api.devreply.com. `system`: the device's fonts, nothing loaded. */
  fonts?: 'devreply' | 'system'
  /** The chat's language, e.g. `es` or `pt-BR`. Default: the browser's. */
  locale?: string
}

let mounted = false
let themeStyle = ''
let useBrandFonts = true

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
  render(<App themeStyle={themeStyle} />, container)
}

function configure(options: Options | string) {
  if (typeof window === 'undefined') return // server rendering: nothing to do
  const o: Options = typeof options === 'string' ? { key: options } : options
  if (!o.key?.startsWith('pk_')) {
    console.warn('DevReply: configure needs the web public key (pk_…). Never put a secret key (sk_…) in a page.')
    return
  }
  if (o.launcher) store.launcher = o.launcher
  if (o.theme) themeStyle = themeVars(o.theme)
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
  /** Opens the messenger. With a category, straight into a new conversation. */
  open(category?: Category) {
    const c = category && CATEGORIES.includes(category) ? category : null
    store.open(c ? { screen: 'chat', conversationId: null, category: c } : undefined)
  },
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
  /** When your user deletes their account: deletes their data, conversations and files from DevReply,
   *  then logs out. Resolves to false if DevReply couldn't be reached. */
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


