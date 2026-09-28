// App-wide messenger state (spec 05), the web twin of the mobile `Messenger`: the install, the config,
// the user's conversations and profile. Views subscribe and re-render on change.

import {
  ApiClient,
  type Category,
  type Config,
  type Conversation,
  type Device,
  DevReplyError,
  type Message,
  type Outgoing,
  type Profile,
  SDK_VERSION,
  plainText,
  parseConfig,
  placeholderConfig,
} from './api'

export type Attribute = string | number | boolean | null
export type LauncherMode = 'always' | 'unread' | 'none'

export type Route = { screen: 'home' } | { screen: 'chat'; conversationId: string | null; category: Category | null }

type Listener = () => void

/** Local storage that never throws (private windows, blocked storage): the SDK still works, just forgets. */
const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* not available */
    }
  },
}

/** The first pattern that matches, formatted with its first group. */
function first(ua: string, rules: [RegExp, (v: string) => string][], otherwise: string): string {
  for (const [re, fmt] of rules) {
    const m = re.exec(ua)
    if (m) return fmt(m[1] ?? '')
  }
  return otherwise
}

/** What the team sees under "Device": browser, OS, site (spec 05). No fingerprinting beyond that. */
function device(appVersion?: string): Device {
  const ua = navigator.userAgent
  const browser = first(ua, [
    [/Edg\/(\d+)/, (v) => `Edge ${v}`],
    [/Firefox\/(\d+)/, (v) => `Firefox ${v}`],
    [/(?:Chrome|CriOS)\/(\d+)/, (v) => `Chrome ${v}`],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, (v) => `Safari ${v}`],
  ], 'Browser')
  const os = first(ua, [
    [/iPhone OS (\d+)/, (v) => `iOS ${v}`],
    [/iPad; CPU OS (\d+)/, (v) => `iPadOS ${v}`],
    [/Android (\d+)/, (v) => `Android ${v}`],
    [/(Mac OS X)/, () => 'macOS'],
    [/(Windows)/, () => 'Windows'],
    [/(Linux)/, () => 'Linux'],
  ], 'Unknown')
  return {
    platform: 'web',
    device_model: browser.slice(0, 100),
    os_version: os.slice(0, 100),
    app_version: (appVersion ?? location.hostname).slice(0, 100),
    sdk_version: SDK_VERSION,
  }
}

class Store {
  client: ApiClient | null = null
  publicKey: string | null = null
  appVersion: string | undefined
  config: Config = placeholderConfig(document.title || location.hostname)
  conversations: Conversation[] = []
  profile: Profile | null = null
  lastError: DevReplyError | null = null
  isOpen = false
  route: Route[] = [{ screen: 'home' }]
  launcher: LauncherMode = 'always'
  /** Conversation on screen (no unread for what the user is looking at). */
  visibleConversation: string | null = null

  private listeners = new Set<Listener>()
  private registering: Promise<string> | null = null
  private hostUser: { name?: string; email?: string } | null = null
  private pendingAttributes: Record<string, Attribute> = {}
  private polling: number | null = null

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  get unreadCount(): number {
    return this.conversations.reduce((n, c) => n + c.unread, 0)
  }

  get needsName(): boolean {
    return !this.profile?.name?.trim()
  }

  configure(publicKey: string, apiUrl: string, appVersion?: string) {
    this.publicKey = publicKey
    this.client = new ApiClient(apiUrl)
    this.appVersion = appVersion
    this.registering = null
    this.conversations = []
    const cached = storage.get(this.configKey)
    if (cached) {
      try {
        this.config = parseConfig(JSON.parse(cached), this.config.appName)
      } catch {
        /* ignore a bad cache */
      }
    }
    this.emit()
    void (async () => {
      if (this.hostUser) await this.saveProfile(this.hostUser).catch(() => undefined)
      await this.flushAttributes()
      await this.refresh()
    })()
    this.startPolling()
  }

  private get tokenKey() {
    return `devreply:token:${this.client?.baseUrl ?? ''}|${this.publicKey ?? ''}`
  }

  private get configKey() {
    return `devreply:config:${this.publicKey ?? ''}`
  }

  /** The install token, registering this browser first if needed. Concurrent callers share one registration. */
  async token(): Promise<string> {
    const client = this.client
    const pk = this.publicKey
    if (!client || !pk) throw new DevReplyError('invalid', 'Call DevReply.configure first')
    const stored = storage.get(this.tokenKey)
    if (stored) return stored
    if (!this.registering) {
      this.registering = client
        .register(pk, device(this.appVersion))
        .then((t) => {
          storage.set(this.tokenKey, t)
          return t
        })
        .finally(() => {
          this.registering = null
        })
    }
    return this.registering
  }

  /** Runs `call` with the token. If the token was revoked, registers again once and retries. */
  async authorized<T>(call: (api: ApiClient, token: string) => Promise<T>): Promise<T> {
    const client = this.client
    if (!client) throw new DevReplyError('invalid', 'Call DevReply.configure first')
    try {
      return await call(client, await this.token())
    } catch (e) {
      if (e instanceof DevReplyError && e.kind === 'unauthenticated') {
        storage.set(this.tokenKey, null)
        return call(client, await this.token())
      }
      throw e
    }
  }

  async refresh() {
    if (!this.client) return
    try {
      const [config, list, me] = await Promise.all([
        this.authorized((api, t) => api.config(t, this.config.appName)),
        this.authorized((api, t) => api.conversations(t)),
        this.authorized((api, t) => api.profile(t)),
      ])
      this.config = config.config
      storage.set(this.configKey, JSON.stringify(config.raw))
      this.conversations = list
      this.profile = me
      this.lastError = null
    } catch (e) {
      this.lastError = e instanceof DevReplyError ? e : new DevReplyError('network')
    }
    this.emit()
  }

  async loadProfileIfNeeded() {
    if (this.profile) return
    this.profile = await this.authorized((api, t) => api.profile(t)).catch(() => null)
    this.emit()
  }

  async saveProfile(patch: { name?: string; email?: string }) {
    this.profile = await this.authorized((api, t) => api.updateProfile(t, patch))
    this.emit()
  }

  setUser(user: { name?: string; email?: string }) {
    this.hostUser = user
    if (this.client) void this.saveProfile(user).catch(() => undefined)
  }

  setAttributes(attributes: Record<string, Attribute>) {
    Object.assign(this.pendingAttributes, attributes)
    if (this.client) void this.flushAttributes()
  }

  private async flushAttributes() {
    const batch = { ...this.pendingAttributes }
    if (Object.keys(batch).length === 0) return
    try {
      await this.authorized((api, t) => api.updateProfile(t, { attributes: batch }))
      for (const [k, v] of Object.entries(batch)) if (this.pendingAttributes[k] === v) delete this.pendingAttributes[k]
    } catch {
      /* next time */
    }
  }

  upsert(c: Conversation) {
    this.conversations = [c, ...this.conversations.filter((x) => x.id !== c.id)].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    )
    this.emit()
  }

  // ---- the panel ----

  open(route?: Route) {
    this.route = route && route.screen === 'chat' ? [{ screen: 'home' }, route] : [{ screen: 'home' }]
    this.isOpen = true
    this.emit()
    void this.refresh()
  }

  close() {
    this.isOpen = false
    this.visibleConversation = null
    this.emit()
    void this.refresh()
  }

  push(route: Route) {
    this.route = [...this.route, route]
    this.emit()
  }

  back() {
    if (this.route.length > 1) this.route = this.route.slice(0, -1)
    this.emit()
  }

  /** While the page is open and the chat closed, look for replies every 30 s, and when the tab comes back. */
  private startPolling() {
    if (this.polling !== null) return
    this.polling = window.setInterval(() => {
      if (!this.isOpen && document.visibilityState === 'visible' && this.conversations.length > 0) void this.refresh()
    }, 30_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.isOpen) void this.refresh()
    })
  }
}

export const store = new Store()

// ---- one conversation ----

export interface Pending {
  id: string
  text: string
  attachments: Outgoing[]
  failure: string | null
}

/** One conversation. Starts empty for a new one; the first send creates it on the server. */
export class ConversationModel {
  messages: Message[] = []
  pending: Pending[] = []
  sentCount = 0
  private listeners = new Set<Listener>()

  constructor(
    public conversationId: string | null,
    readonly category: Category | null,
  ) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  async load() {
    const id = this.conversationId
    if (!id) return
    try {
      const page = await store.authorized((api, t) => api.messages(t, id))
      if (JSON.stringify(page.messages) !== JSON.stringify(this.messages)) this.messages = page.messages
      // Opening it marks the team's replies read: nothing unread in what the user is looking at.
      if (page.conversation) store.upsert({ ...page.conversation, unread: 0 })
      this.emit()
    } catch {
      /* try again on the next tick */
    }
  }

  send(raw: string, attachments: Outgoing[]) {
    const text = raw.trim()
    if (!text && attachments.length === 0) return
    const item: Pending = { id: Math.random().toString(36).slice(2), text, attachments, failure: null }
    this.pending = [...this.pending, item]
    this.sentCount++
    this.emit()
    void this.deliver(item)
  }

  retry(item: Pending) {
    this.pending = this.pending.map((p) => (p.id === item.id ? { ...p, failure: null } : p))
    this.emit()
    void this.deliver(item)
  }

  private async deliver(item: Pending) {
    try {
      const ids: string[] = []
      for (const a of item.attachments) ids.push(await store.authorized((api, t) => api.upload(t, a)))
      if (this.conversationId) {
        const id = this.conversationId
        const m = await store.authorized((api, t) => api.sendMessage(t, id, item.text, ids))
        if (m) {
          this.messages = [...this.messages, m]
          // The home list shows it straight away, even if the user goes back before the next poll.
          const c = store.conversations.find((x) => x.id === id)
          if (c) store.upsert({ ...c, lastText: plainText(m), lastAuthor: 'user', lastMessageAt: m.createdAt, status: 'open' })
        }
      } else {
        const started = await store.authorized((api, t) => api.start(t, this.category, item.text, ids))
        if (started.conversation) {
          this.conversationId = started.conversation.id
          store.visibleConversation = started.conversation.id
          store.upsert(started.conversation)
        }
        if (started.message) this.messages = [...this.messages, started.message]
      }
      this.pending = this.pending.filter((p) => p.id !== item.id)
    } catch (e) {
      const kind = e instanceof DevReplyError ? e.kind : 'network'
      const reason =
        kind === 'unavailable'
          ? "Attachments can't be sent right now. Tap to retry."
          : kind === 'network'
            ? "You're offline. Tap to retry."
            : kind === 'invalid' && e instanceof DevReplyError
              ? `Not sent: ${e.message}. Tap to retry.`
              : 'Not sent. Tap to retry.'
      this.pending = this.pending.map((p) => (p.id === item.id ? { ...p, failure: reason } : p))
    }
    this.emit()
  }
}
