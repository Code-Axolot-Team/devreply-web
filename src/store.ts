// App-wide messenger state (spec 05), the web twin of the mobile `Messenger`: the install, the config,
// the user's conversations and profile. Views subscribe and re-render on change.

import {
  type Answer,
  ApiClient,
  type ButtonOption,
  type Category,
  type Config,
  type Context,
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
import { language, localeTag, setLocaleOverride, t } from './i18n'
import { Live } from './live'

export type Attribute = string | number | boolean | null
export type LauncherMode = 'always' | 'unread' | 'none'

export type Route = { screen: 'home' } | { screen: 'chat'; conversationId: string | null; category: Category | null }

type Listener = () => void

/** What `DevReply.on` reports (0.4.4), for the site's analytics. */
export interface DevReplyEvents {
  /** The messenger appeared. */
  open: undefined
  /** The messenger went away (the close button, Escape, the launcher, `close()`, a logout…). */
  close: undefined
  /** The server accepted a new conversation (its first message). */
  conversationStarted: { conversationId: string; category: Category | null }
  /** The server accepted a message from the user (the first one too, right after `conversationStarted`). */
  messageSent: { conversationId: string }
}
export type DevReplyEvent = keyof DevReplyEvents

/** What one `open(…)` asked for (0.4.4): a draft for the new conversation, and its context. */
export interface Presentation {
  message?: string
  context?: Context
  /** `askName: false`: no name form while this presentation is open. */
  skipName?: boolean
}

/** The DevReply account deletions still to do (0.4.4): old install tokens, kept until the server says done. */
const MAX_PENDING_DELETIONS = 10

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

/** 32 random bytes as base64url, no padding (43 characters); null if the browser has no crypto. */
function randomKey(): string | null {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return null
  }
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
    locale: localeTag().slice(0, 35),
  }
}

export class Store {
  client: ApiClient | null = null
  publicKey: string | null = null
  appVersion: string | undefined
  // No document on the server (SSR): the real name arrives with the config.
  config: Config = placeholderConfig(typeof document === 'undefined' ? '' : document.title || location.hostname)
  conversations: Conversation[] = []
  profile: Profile | null = null
  lastError: DevReplyError | null = null
  isOpen = false
  route: Route[] = [{ screen: 'home' }]
  launcher: LauncherMode = 'always'
  /** Conversation on screen (no unread for what the user is looking at). */
  visibleConversation: string | null = null
  /** The prefilled message and context of the current presentation, until its first conversation starts. */
  presentation: Presentation = {}
  /** The messenger's colours as inline CSS variables: light, and dark (null: stays light) (0.4.4). */
  theme: { light: string; dark: string | null } = { light: '', dark: null }

  private listeners = new Set<Listener>()
  private registering: Promise<string> | null = null
  /** After the server refuses the public key: no new attempt before this (1 min, 5 min, 30 min, then 6 h). */
  private keyRefusedUntil = 0
  private keyRefusals = 0
  private hostUser: { name?: string; email?: string } | null = null
  private pendingAttributes: Record<string, Attribute> = {}
  private polling: number | null = null
  private events = new Map<DevReplyEvent, Set<(payload: never) => void>>()
  private deleting = false
  /** The device key when localStorage can't keep it: this page keeps using the same one. */
  private memoryDeviceKey: { publicKey: string; key: string } | null = null
  /** Conversations on screen (0.5.0): live messages go straight into their threads. */
  private models = new Set<ConversationModel>()
  private refreshTimer: number | null = null

  /** Live updates (0.5.0, spec 05): a WebSocket while the messenger is open and the tab visible. */
  readonly live = new Live({
    ticket: () => this.authorized((api, t) => api.liveTicket(t)),
    onMessage: (conversationId, message) => this.liveMessage(conversationId, message),
    onChange: (live) => {
      // Just connected: one catch-up over HTTP for anything sent while the socket was being set up.
      if (live) {
        void this.refresh()
        for (const m of this.models) void m.load()
      }
      this.emit()
    },
  })

  /** `DevReply.on`: any number of listeners; a listener that throws never breaks the chat. */
  on<E extends DevReplyEvent>(event: E, fn: (payload: DevReplyEvents[E]) => void): () => void {
    const set = this.events.get(event) ?? new Set()
    this.events.set(event, set)
    set.add(fn as (payload: never) => void)
    return () => {
      set.delete(fn as (payload: never) => void)
    }
  }

  fire<E extends DevReplyEvent>(event: E, ...payload: DevReplyEvents[E] extends undefined ? [] : [DevReplyEvents[E]]) {
    for (const fn of [...(this.events.get(event) ?? [])]) {
      try {
        ;(fn as (p: unknown) => void)(payload[0])
      } catch (e) {
        console.error('DevReply: an event listener threw', e)
      }
    }
  }

  /** False when DevReply isn't configured or the team switched the chat off (0.4.4). Before the
   *  first config arrives (nothing cached): true. */
  get isAvailable(): boolean {
    return this.client !== null && this.config.enabled
  }

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
    return !this.presentation.skipName && !this.profile?.name?.trim()
  }

  configure(publicKey: string, apiUrl: string, appVersion?: string) {
    this.publicKey = publicKey
    this.client = new ApiClient(apiUrl)
    this.appVersion = appVersion
    this.registering = null
    this.conversations = []
    this.live.reset()
    const cached = storage.get(this.configKey)
    if (cached) {
      try {
        this.config = parseConfig(JSON.parse(cached), this.config.appName)
      } catch {
        /* ignore a bad cache */
      }
    }
    // Signed in as someone else than this browser's user (the site called login before configure).
    const stored = storage.get(this.userKey)
    if (this.hostUserId && stored && stored !== this.hostUserId) this.forgetInstall()
    this.emit()
    void this.retryDeletions()
    void (async () => {
      await this.sendUserId()
      if (this.hostUser) await this.saveProfile(this.hostUser).catch(() => undefined)
      await this.flushAttributes()
      await this.refresh()
    })()
    this.startPolling()
  }

  /** The app's id for the signed-in user this browser's install belongs to (`DevReply.login`). */
  private get userKey() {
    return `devreply:user:${this.client?.baseUrl ?? ''}|${this.publicKey ?? ''}`
  }

  private get tokenKey() {
    return `devreply:token:${this.client?.baseUrl ?? ''}|${this.publicKey ?? ''}`
  }

  private get configKey() {
    return `devreply:config:${this.publicKey ?? ''}`
  }

  /** This browser's device key for the app (0.5.0): per public key, never removed by logout. */
  private get deviceStorageKey() {
    return `devreply:device:${this.publicKey ?? ''}`
  }

  /**
   * A random 256-bit secret of this browser for the app (spec 03, "Same device after logout"), created
   * once and kept through logout: back on this device, the same account gets its conversations back.
   */
  deviceKey(): string | null {
    const pk = this.publicKey
    if (!pk) return null
    const stored = storage.get(this.deviceStorageKey)
    if (stored && /^[A-Za-z0-9_-]{43}$/.test(stored)) return stored
    if (this.memoryDeviceKey?.publicKey === pk) {
      storage.set(this.deviceStorageKey, this.memoryDeviceKey.key)
      return this.memoryDeviceKey.key
    }
    const key = randomKey()
    if (!key) return null
    this.memoryDeviceKey = { publicKey: pk, key }
    storage.set(this.deviceStorageKey, key)
    return key
  }

  private get deletionsKey() {
    return `devreply:pending-deletions:${this.client?.baseUrl ?? ''}|${this.publicKey ?? ''}`
  }

  /** The install token, registering this browser first if needed. Concurrent callers share one registration. */
  async token(): Promise<string> {
    const client = this.client
    const pk = this.publicKey
    if (!client || !pk) throw new DevReplyError('invalid', 'Call DevReply.configure first')
    const stored = storage.get(this.tokenKey)
    if (stored) return stored
    // A refused key isn't retried in a loop: it waits, longer each time (spec 05).
    if (Date.now() < this.keyRefusedUntil) throw new DevReplyError('invalidKey')
    if (!this.registering) {
      this.registering = client
        .register(pk, device(this.appVersion), this.deviceKey())
        .then((t) => {
          storage.set(this.tokenKey, t)
          this.keyRefusals = 0
          return t
        })
        .catch((e) => {
          if (e instanceof DevReplyError && e.kind === 'invalidKey') {
            const waits = [60_000, 300_000, 1_800_000, 21_600_000]
            this.keyRefusedUntil = Date.now() + waits[Math.min(this.keyRefusals, waits.length - 1)]
            if (this.keyRefusals === 0) console.warn(`DevReply: this public key isn't recognised: ${pk.slice(0, 9)}…`)
            this.keyRefusals++
          }
          throw e
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
    // The team switched the chat off while it was open.
    if (this.isOpen && !this.config.enabled) this.close()
  }

  async loadProfileIfNeeded() {
    if (this.profile) return
    this.profile = await this.authorized((api, t) => api.profile(t)).catch(() => null)
    this.emit()
  }

  async saveProfile(patch: { name?: string; email?: string }) {
    const { name, email } = await this.authorized((api, t) => api.updateProfile(t, patch))
    this.profile = { name, email }
    this.emit()
  }

  // ---- signed-in user (spec 03) ----

  private hostUserId: string | null = null

  login(userId: string) {
    const id = String(userId ?? '').trim()
    if (!id) return
    // Another person in this browser: they start from a new, empty install.
    const stored = this.client ? storage.get(this.userKey) : null
    if (stored && stored !== id) this.logout()
    this.hostUserId = id
    if (this.client) void this.sendUserId()
  }

  /** Labels this install's user with the site's id; another id for the same user (409) means this
   *  install belonged to someone else, so start a new one. */
  private async sendUserId(retry = true): Promise<void> {
    const id = this.hostUserId
    if (!id || !this.client) return
    try {
      const { name, email, restored } = await this.authorized((api, t) => api.updateProfile(t, { user_id: id }))
      this.profile = { name, email }
      storage.set(this.userKey, id)
      this.emit()
      // Back on this device with the same account (0.5.0): the old conversations came back.
      if (restored) await this.refresh()
    } catch (e) {
      if (retry && e instanceof DevReplyError && e.kind === 'conflict') {
        this.logout(true)
        await this.sendUserId(false)
      }
    }
  }

  /** `DevReply.logout()`: the server stops accepting this install, the browser forgets it, and the next
   *  person starts from a new, empty one. Conversations stay for the team. */
  logout(keepUserId = false) {
    const client = this.client
    const token = client ? storage.get(this.tokenKey) : null
    if (client && token) void client.logout(token).catch(() => undefined)
    const id = this.hostUserId
    this.forgetInstall()
    if (keepUserId) this.hostUserId = id
    if (this.client) void this.refresh()
  }

  /**
   * `DevReply.deleteUser()`: deletes the user's data on the server and forgets the install. If the
   * server can't do it now, the browser forgets the user anyway and the deletion waits in
   * localStorage (the old token only), retried at every configure and whenever the tab comes back.
   * True: deleted now. False: queued.
   */
  async deleteUser(): Promise<boolean> {
    const client = this.client
    if (!client) return false
    const token = storage.get(this.tokenKey)
    // Nothing registered in this browser: nothing of this user's on the server.
    let done = token === null
    if (token) {
      try {
        await client.deleteUser(token)
        done = true
      } catch (e) {
        done = deletionDone(e)
        if (!done) this.queueDeletion(token)
      }
    }
    this.forgetInstall() // what logout does on the device, without POST /v1/logout
    void this.refresh()
    return done
  }

  /** The saved deletions (old install tokens). */
  pendingDeletions(): string[] {
    try {
      const list: unknown = JSON.parse(storage.get(this.deletionsKey) ?? '[]')
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  private savePendingDeletions(list: string[]) {
    storage.set(this.deletionsKey, list.length ? JSON.stringify(list.slice(-MAX_PENDING_DELETIONS)) : null)
  }

  private queueDeletion(token: string) {
    const list = this.pendingDeletions().filter((t) => t !== token)
    this.savePendingDeletions([...list, token])
  }

  /** Sends each saved deletion with its own old token (never the current install's). 2xx, 401 and 404
   *  count as done; anything else waits for the next try. */
  async retryDeletions() {
    const client = this.client
    if (!client || this.deleting) return
    const list = this.pendingDeletions()
    if (list.length === 0) return
    this.deleting = true
    try {
      for (const token of list) {
        let done = false
        try {
          await client.deleteUser(token)
          done = true
        } catch (e) {
          done = deletionDone(e)
        }
        if (done) this.savePendingDeletions(this.pendingDeletions().filter((t) => t !== token))
      }
    } finally {
      this.deleting = false
    }
  }

  private forgetInstall() {
    if (this.client) {
      storage.set(this.tokenKey, null)
      storage.set(this.userKey, null)
    }
    this.registering = null
    this.hostUserId = null
    this.hostUser = null
    this.pendingAttributes = {}
    this.conversations = []
    this.profile = null
    const wasOpen = this.isOpen
    this.isOpen = false
    this.live.reset()
    this.visibleConversation = null
    this.presentation = {}
    this.emit()
    if (wasOpen) this.fire('close')
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

  // ---- live updates (0.5.0) ----

  /** A conversation screen came up (or went away): live messages for it go into its thread. */
  attach(model: ConversationModel): () => void {
    this.models.add(model)
    return () => this.models.delete(model)
  }

  /** A message from the live socket: into its open thread, and the list and unread as a poll would. */
  liveMessage(conversationId: string, message: Message) {
    for (const m of this.models) if (m.conversationId === conversationId) m.receive(message)
    const c = this.conversations.find((x) => x.id === conversationId)
    // A conversation this list doesn't have yet (started by the team, or on another device): reload it.
    if (!c) return this.refreshSoon()
    const at = Date.parse(message.createdAt)
    const last = Date.parse(c.lastMessageAt)
    if (at < last) return // older than what the list shows (a backlog message already counted)
    const onScreen = this.isOpen && this.visibleConversation === conversationId
    if (onScreen) this.live.read(conversationId)
    const status = message.systemKey === 'resolved' ? 'resolved' : message.author === 'user' ? 'open' : c.status
    const unread = onScreen ? 0 : c.unread + (message.author !== 'user' && at > last ? 1 : 0)
    this.upsert({ ...c, lastText: plainText(message), lastAuthor: message.author, lastMessageAt: message.createdAt, status, unread })
  }

  private refreshSoon() {
    if (this.refreshTimer !== null) return
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, 300)
  }

  // ---- the panel ----

  /** Opens the messenger (with a category: on a new conversation). False, and nothing shown, when
   *  DevReply isn't configured or the chat is switched off. */
  open(route?: Route, presentation: Presentation = {}): boolean {
    if (!this.isAvailable) return false
    const wasOpen = this.isOpen
    this.route = route && route.screen === 'chat' ? [{ screen: 'home' }, route] : [{ screen: 'home' }]
    this.presentation = presentation
    this.isOpen = true
    this.emit()
    if (!wasOpen) this.fire('open')
    void this.refresh()
    // Opening the messenger again also forgets an earlier give-up (503 or 5 failures).
    if (!wasOpen) this.live.rearm()
    if (document.visibilityState === 'visible') this.live.start()
    return true
  }

  close() {
    const wasOpen = this.isOpen
    this.isOpen = false
    this.live.stop()
    this.visibleConversation = null
    this.presentation = {}
    this.emit()
    if (wasOpen) this.fire('close')
    void this.refresh()
  }

  /** The chat's language: a tag like `es` or `pt-BR`, or null to follow the browser. */
  setLocale(tag: string | null) {
    setLocaleOverride(tag)
    this.emit()
    if (this.client && storage.get(this.tokenKey)) {
      void this.authorized((api, tk) => api.setLocale(tk, localeTag().slice(0, 35))).catch(() => undefined)
    }
  }

  get language() {
    return language()
  }

  /** Opens the chat on a conversation from a DevReply link (`?devreply=<id>`), and tells the server
   *  the link works. Home if this browser doesn't have that conversation. */
  async openFromLink(conversationId: string) {
    if (!this.open()) return
    void this.authorized((api, t) => api.deepLinkOpened(t)).catch(() => undefined)
    await this.refresh()
    if (this.conversations.some((c) => c.id === conversationId)) {
      this.route = [{ screen: 'home' }, { screen: 'chat', conversationId, category: null }]
      this.emit()
    }
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
      // Live only while someone can see it: a hidden tab closes the socket; back with the messenger open, it reconnects.
      if (document.visibilityState !== 'visible') return this.live.stop()
      if (this.isOpen) this.live.start()
      void this.retryDeletions()
      if (!this.isOpen) void this.refresh()
    })
  }
}

/** A message from the server that is this pending one (same text, same number of attachments, same answer). */
function sameAs(p: Pending, m: Message): boolean {
  if (p.failure !== null) return false
  const text = m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
  const files = m.blocks.filter((b) => b.type === 'image' || b.type === 'file').length
  const answerOk = !p.answer || (m.answer?.messageId === p.answer.messageId && m.answer.optionId === p.answer.optionId)
  return text.trim() === p.text && files === p.attachments.length && answerOk
}

/** A deletion the server has done, or has nothing left to do for (the install or user is already gone). */
function deletionDone(e: unknown): boolean {
  return e instanceof DevReplyError && (e.status === 401 || e.status === 404)
}

export const store = new Store()

// ---- one conversation ----

export interface Pending {
  id: string
  text: string
  attachments: Outgoing[]
  failure: string | null
  /** A tapped answer button (0.5.0). */
  answer?: Answer
}

/** One conversation. Starts empty for a new one; the first send creates it on the server. */
export class ConversationModel {
  messages: Message[] = []
  pending: Pending[] = []
  sentCount = 0
  /** Buttons questions answered from here (0.5.0), until the server's messages say so: the option, or
   *  null when the server said "already answered" (409) without the answer in the list. */
  private answered = new Map<string, string | null>()
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
      const newest = page.messages[page.messages.length - 1]
      if (newest) store.live.saw(newest.id)
      // Opening it marks the team's replies read: nothing unread in what the user is looking at.
      if (page.conversation) store.upsert({ ...page.conversation, unread: 0 })
      this.emit()
    } catch {
      /* try again on the next tick */
    }
  }

  /** A message from the live socket (0.5.0): once, in order; the user's own replaces its pending bubble. */
  receive(m: Message) {
    if (this.messages.some((x) => x.id === m.id)) return
    if (m.author === 'user') {
      const i = this.pending.findIndex((p) => sameAs(p, m))
      if (i >= 0) this.pending = this.pending.filter((_, j) => j !== i)
    }
    this.add(m)
    this.emit()
  }

  /** Adds a message the server confirmed, unless it's there already (the socket can beat the POST's answer). */
  private add(m: Message) {
    if (this.messages.some((x) => x.id === m.id)) return
    const last = this.messages[this.messages.length - 1]
    this.messages = [...this.messages, m]
    if (last && Date.parse(m.createdAt) < Date.parse(last.createdAt))
      this.messages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    store.live.saw(m.id)
  }

  send(raw: string, attachments: Outgoing[]) {
    const text = raw.trim()
    if (!text && attachments.length === 0) return
    const item: Pending = { id: Math.random().toString(36).slice(2), text, attachments, failure: null }
    this.pending = [...this.pending, item]
    this.sentCount++
    this.emit()
    this.enqueue(item)
  }

  /** The user tapped an answer button: a user message with the label as its text (0.5.0). One per question. */
  answer(messageId: string, option: ButtonOption) {
    if (this.answerTo(messageId) !== undefined) return
    const item: Pending = {
      id: Math.random().toString(36).slice(2),
      text: option.label,
      attachments: [],
      failure: null,
      answer: { messageId, optionId: option.id },
    }
    this.pending = [...this.pending, item]
    this.sentCount++
    this.emit()
    this.enqueue(item)
  }

  /**
   * The answer to a buttons message: the chosen option's id, null when it's answered but we don't know
   * which (a 409 from another device), undefined while open. A later user message that carries the
   * answer, an answer sent from here, or one on its way.
   */
  answerTo(messageId: string): string | null | undefined {
    const sent = this.messages.find((m) => m.author === 'user' && m.answer?.messageId === messageId)
    if (sent) return sent.answer!.optionId
    if (this.answered.has(messageId)) return this.answered.get(messageId)
    return this.pending.find((p) => p.answer?.messageId === messageId)?.answer?.optionId
  }

  retry(item: Pending) {
    this.pending = this.pending.map((p) => (p.id === item.id ? { ...p, failure: null } : p))
    this.emit()
    this.enqueue(item)
  }

  /** Sends go out one at a time, in the order typed: two in flight could reach the server swapped. */
  private queue: Promise<void> = Promise.resolve()

  private enqueue(item: Pending) {
    this.queue = this.queue.then(() => this.deliver(item))
  }

  private async deliver(item: Pending) {
    try {
      const ids: string[] = []
      for (const a of item.attachments) ids.push(await store.authorized((api, t) => api.upload(t, a)))
      if (this.conversationId) {
        const id = this.conversationId
        const answer = item.answer
        let m: Message | null
        try {
          m = await store.authorized((api, t) => api.sendMessage(t, id, item.text, ids, answer))
        } catch (e) {
          // Already answered (another tab or device): drop this one and show what the server has.
          if (answer && e instanceof DevReplyError && e.kind === 'conflict') {
            this.pending = this.pending.filter((p) => p.id !== item.id)
            await this.load()
            if (this.answerTo(answer.messageId) === undefined) this.answered.set(answer.messageId, null)
            this.emit()
            return
          }
          throw e
        }
        if (answer) this.answered.set(answer.messageId, answer.optionId)
        store.fire('messageSent', { conversationId: id })
        if (m) {
          this.add(m)
          // The home list shows it straight away, even if the user goes back before the next poll.
          const c = store.conversations.find((x) => x.id === id)
          if (c) store.upsert({ ...c, lastText: plainText(m), lastAuthor: 'user', lastMessageAt: m.createdAt, status: 'open' })
        }
      } else {
        // The context `open(…, { attributes })` passed goes with the presentation's first new conversation only.
        const presentation = store.presentation
        const context = presentation.context ?? {}
        const started = await store.authorized((api, t) => api.start(t, this.category, item.text, ids, context))
        // The draft and context are used up; skipping the name lasts until the messenger closes.
        if (store.presentation === presentation) store.presentation = presentation.skipName ? { skipName: true } : {}
        if (started.conversation) {
          this.conversationId = started.conversation.id
          store.visibleConversation = started.conversation.id
          store.upsert(started.conversation)
          store.fire('conversationStarted', { conversationId: started.conversation.id, category: this.category })
          store.fire('messageSent', { conversationId: started.conversation.id })
        }
        if (started.message) this.add(started.message)
      }
      this.pending = this.pending.filter((p) => p.id !== item.id)
    } catch (e) {
      const kind = e instanceof DevReplyError ? e.kind : 'network'
      const reason =
        kind === 'unavailable'
          ? t('failed.attachments')
          : kind === 'network'
            ? t('failed.offline')
            : kind === 'invalid' && e instanceof DevReplyError
              ? t('failed.reason', { reason: e.message })
              : t('failed.generic')
      this.pending = this.pending.map((p) => (p.id === item.id ? { ...p, failure: reason } : p))
    }
    this.emit()
  }
}
