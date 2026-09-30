import { parseMarkdown, plainMarkdown } from './markdown'

// The SDK API (spec 07): the public key registers this browser once; everything after uses the
// install's own token. Same endpoints and shapes as the iOS and Android SDKs.

export class DevReplyError extends Error {
  constructor(
    readonly kind: 'unauthenticated' | 'invalidKey' | 'forbidden' | 'invalid' | 'conflict' | 'server' | 'network' | 'unavailable',
    message: string = kind,
    /** The HTTP status, when the server answered. */
    readonly status?: number,
  ) {
    super(message)
  }
}

export type Category = 'bug' | 'billing' | 'idea' | 'question' | 'other'
export const CATEGORIES: Category[] = ['bug', 'billing', 'idea', 'question', 'other']

export interface StartButton {
  category: Category
  title: string
}

export interface Config {
  appName: string
  teamName: string
  greeting: string
  intro: string
  replyTime: string
  replyWithin: string
  startButtons: StartButton[]
  /** The app's icon (0.4): the square avatar in the header and on home. */
  appIconUrl: string | null
  /** Teammates' faces for the home screen (0.4), up to 3. */
  team: Persona[]
  /** Texts still at DevReply's defaults (0.4): shown in the user's language. */
  localize: string[]
  /** The reply-time preset (0.4), e.g. `3_working_days`. */
  replyWithinKey: string | null
  /** False when the team switched the chat off in the dashboard (0.4.4). */
  enabled: boolean
}

/** Who replied (0.4): a teammate's name, title and photo. */
export interface Persona {
  name: string
  title: string
  avatarUrl: string | null
}

export interface Conversation {
  id: string
  status: string
  category: Category | null
  lastText: string | null
  lastAuthor: string | null
  unread: number
  lastMessageAt: string
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; width?: number; height?: number }
  | { type: 'file'; url: string; name: string; size?: number }
  /** Team and agent replies (0.5.0): Markdown, rendered formatted; `fallback` is its plain text. */
  | { type: 'markdown'; text: string; fallback: string }
  /** A question with answer buttons (0.5.0): `text` is the question in Markdown; 2 to 5 options. */
  | { type: 'buttons'; text: string; options: ButtonOption[]; fallback: string }
  | { type: 'unsupported'; fallback: string }

/** One answer of a buttons question (0.5.0); ids are the server's. */
export interface ButtonOption {
  id: string
  label: string
}

/** Which option of which buttons message a user message answered (0.5.0). */
export interface Answer {
  messageId: string
  optionId: string
}

export interface Message {
  id: string
  /** Server lines DevReply knows (0.4), e.g. `resolved`: shown in the user's language. */
  systemKey?: string
  author: 'user' | 'admin' | 'agent' | 'system'
  createdAt: string
  blocks: Block[]
  /** Team replies (0.4): who wrote it. */
  persona?: Persona
  /** A user message that answered a buttons question (0.5.0). */
  answer?: Answer
}

export interface Profile {
  name: string | null
  email: string | null
}

export interface Device {
  platform: 'web'
  device_model: string
  os_version: string
  app_version: string
  sdk_version: string
  /** The chat's language (0.4). */
  locale: string
}

export const SDK_VERSION: string = __SDK_VERSION__

// ---- forgiving decoding (spec 05: a newer server never breaks an SDK already on sites) ----

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
/** One bad item is skipped, not the whole list. */
const lossy = <T>(v: unknown, parse: (o: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : []).flatMap((x) => {
    try {
      const r = parse(obj(x))
      return r === null ? [] : [r]
    } catch {
      return []
    }
  })

const category = (v: unknown): Category | null => {
  const s = str(v)
  if (s === null) return null
  return (CATEGORIES as string[]).includes(s) ? (s as Category) : 'other'
}

export const DEFAULT_TITLES: Record<Category, string> = {
  bug: "Something's broken",
  billing: 'Billing or subscription',
  idea: 'I have an idea',
  question: 'Question',
  other: 'Message',
}

export function placeholderConfig(appName: string): Config {
  return {
    appName,
    teamName: appName,
    greeting: 'Hi there 👋',
    intro: "Ask us anything, or tell us what's broken.",
    replyTime: 'Usually replies within 3 working days',
    replyWithin: '3 working days',
    startButtons: (['bug', 'billing', 'idea', 'question'] as Category[]).map((c) => ({ category: c, title: DEFAULT_TITLES[c] })),
    appIconUrl: null,
    team: [],
    localize: ['greeting', 'intro', 'start_buttons', 'reply_time', 'reply_within'],
    replyWithinKey: '3_working_days',
    enabled: true,
  }
}

/** Only https images (never a data: or javascript: URL from anywhere). */
const imageUrl = (v: unknown): string | null => {
  const s = str(v)
  return s && s.startsWith('https://') ? s : null
}

export function parsePersona(o: Record<string, unknown>): Persona | null {
  const name = str(o.name)?.trim()
  if (!name) return null
  return { name, title: str(o.title)?.trim() ?? '', avatarUrl: imageUrl(o.avatar_url) }
}

export function parseConfig(raw: unknown, appName: string): Config {
  const o = obj(raw)
  const d = placeholderConfig(appName)
  const name = str(o.app_name) ?? d.appName
  const buttons = Array.isArray(o.start_buttons)
    ? lossy(o.start_buttons, (b) => {
        const title = str(b.title)
        return title ? { category: category(b.category) ?? 'other', title } : null
      })
    : d.startButtons
  return {
    appName: name,
    teamName: str(o.team_name) ?? name,
    greeting: str(o.greeting) ?? d.greeting,
    intro: str(o.intro) ?? d.intro,
    replyTime: str(o.reply_time) ?? d.replyTime,
    replyWithin: str(o.reply_within) ?? d.replyWithin,
    startButtons: buttons,
    appIconUrl: imageUrl(o.app_icon_url),
    team: lossy(o.team, parsePersona).slice(0, 3),
    localize: Array.isArray(o.localize) ? o.localize.filter((x): x is string => typeof x === 'string') : [],
    replyWithinKey: str(o.reply_within_key),
    enabled: o.enabled !== false,
  }
}

export function parseConversation(o: Record<string, unknown>): Conversation | null {
  const id = str(o.id)
  const at = str(o.last_message_at)
  if (!id || !at) return null
  return {
    id,
    status: str(o.status) ?? 'open',
    category: category(o.category),
    lastText: str(o.last_text),
    lastAuthor: str(o.last_author),
    unread: num(o.unread) ?? 0,
    lastMessageAt: at,
  }
}

/** Is version `a` older than `b`? ("0.3.0" < "0.10.0") */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

export function parseBlock(b: Record<string, unknown>): Block {
  const fallback = str(b.fallback) ?? 'This message needs a newer version of the app.'
  const minSdk = str(b.min_sdk)
  if (minSdk && olderThan(SDK_VERSION, minSdk)) return { type: 'unsupported', fallback }
  const url = str(b.url)
  switch (b.type) {
    case 'text':
      return { type: 'text', text: str(b.text) ?? fallback }
    case 'image':
      return url ? { type: 'image', url, width: num(b.width), height: num(b.height) } : { type: 'unsupported', fallback: 'Photo' }
    case 'file':
      return url ? { type: 'file', url, name: str(b.name) ?? 'File', size: num(b.size) } : { type: 'unsupported', fallback }
    case 'markdown': {
      const text = str(b.text)
      if (!text) return { type: 'unsupported', fallback }
      return { type: 'markdown', text, fallback: str(b.fallback) ?? plainMarkdown(parseMarkdown(text)) }
    }
    case 'buttons': {
      const text = str(b.text)
      const options = lossy(b.options, (o) => {
        const id = str(o.id)
        const label = str(o.label)?.trim()
        return id && label ? { id, label } : null
      }).slice(0, 5)
      if (!text || options.length < 2) return { type: 'unsupported', fallback }
      const question = plainMarkdown(parseMarkdown(text))
      const numbered = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
      return { type: 'buttons', text, options, fallback: str(b.fallback) ?? `${question}\n\n${numbered}` }
    }
    default:
      return { type: 'unsupported', fallback }
  }
}

/** `{"message_id", "option_id"}` from the server; null for anything else. */
export function parseAnswer(v: unknown): Answer | null {
  const o = obj(v)
  const messageId = str(o.message_id)
  const optionId = str(o.option_id)
  return messageId && optionId ? { messageId, optionId } : null
}

/** The resolved line as servers before the `key` wrote it. */
const RESOLVED_TEXT = '✓ Marked as resolved. Reply here any time to open it again.'

export function parseMessage(o: Record<string, unknown>): Message | null {
  const id = str(o.id)
  const at = str(o.created_at)
  if (!id || !at) return null
  const a = str(o.author)
  const author = a === 'user' || a === 'admin' || a === 'agent' || a === 'system' ? a : 'admin'
  const persona = o.persona && typeof o.persona === 'object' ? parsePersona(obj(o.persona)) : null
  const blocks = Array.isArray(o.blocks) ? o.blocks : []
  const first = obj(blocks[0])
  // An answer to a buttons question: on the message, or on one of its blocks.
  const answer = author === 'user' ? (parseAnswer(o.answer) ?? blocks.map((b) => parseAnswer(obj(b).answer)).find((a) => a) ?? null) : null
  const systemKey =
    author === 'system' && (str(first.key) === 'resolved' || str(first.text) === RESOLVED_TEXT) ? 'resolved' : undefined
  return {
    id,
    author,
    createdAt: at,
    blocks: lossy(o.blocks, parseBlock),
    ...(persona ? { persona } : {}),
    ...(systemKey ? { systemKey } : {}),
    ...(answer ? { answer } : {}),
  }
}

/** A conversation's context from the app (0.4.4): what `open(…, { attributes })` passed. */
export type Context = Record<string, string | number | boolean>

/**
 * What the server takes as a conversation's context: at most 20 values, keys of 1–40 letters, digits,
 * `_ - . space`, values text (up to 500 characters), number or true/false. Anything else is left out
 * (with a warning), so a bad value never stops the user's first message.
 */
export function contextOf(attributes: Record<string, unknown> | null | undefined): Context {
  const out: Context = {}
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (Object.keys(out).length === 20) {
      console.warn('DevReply: at most 20 attributes per conversation; the rest are left out.')
      break
    }
    const keyOk = /^[A-Za-z0-9_\-. ]{1,40}$/.test(key)
    const ok = typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string'
    if (!keyOk || !ok) {
      console.warn(`DevReply: attribute ${JSON.stringify(key)} left out (names: 1–40 letters, digits, _ - . or space; values: text, number or true/false).`)
      continue
    }
    out[key] = typeof value === 'string' ? Array.from(value).slice(0, 500).join('') : (value as number | boolean)
  }
  return out
}

/** A message as plain text, for previews: Markdown shows its fallback, never `**`; a buttons question
 *  its question only. */
export function plainText(m: Message): string {
  return m.blocks
    .map((b) =>
      b.type === 'text'
        ? b.text
        : b.type === 'image'
          ? 'Photo'
          : b.type === 'file'
            ? b.name
            : b.type === 'buttons'
              ? plainMarkdown(parseMarkdown(b.text))
              : b.fallback,
    )
    .join('\n')
}

// ---- HTTP ----

export class ApiClient {
  constructor(readonly baseUrl: string) {}

  private async send(method: string, path: string, token: string | null, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'omit',
      })
    } catch {
      throw new DevReplyError('network')
    }
    const json = await res.json().catch(() => ({}))
    if (res.ok) return json
    const message = str(obj(obj(json).error).message) ?? `HTTP ${res.status}`
    const s = res.status
    if (s === 401) throw new DevReplyError('unauthenticated', message, s)
    if (s === 403) throw new DevReplyError('forbidden', message, s)
    if (s === 400 || s === 422) throw new DevReplyError('invalid', message, s)
    if (s === 409) throw new DevReplyError('conflict', message, s)
    if (s === 503) throw new DevReplyError('unavailable', message, s)
    throw new DevReplyError('server', message, s)
  }

  /** `deviceKey` (0.5.0): this browser's secret for the app, kept through logout (spec 03). */
  async register(publicKey: string, device: Device, deviceKey?: string | null): Promise<string> {
    try {
      const body = { ...device, public_key: publicKey, ...(deviceKey ? { device_key: deviceKey } : {}) }
      const r = obj(await this.send('POST', 'v1/installs', null, body))
      const token = str(r.token)
      if (!token) throw new DevReplyError('server')
      return token
    } catch (e) {
      if (e instanceof DevReplyError && e.kind === 'unauthenticated') throw new DevReplyError('invalidKey')
      throw e
    }
  }

  /** The chat's language changed (0.4): the team sees it next to the user. Push is left alone. */
  async setLocale(token: string, locale: string): Promise<void> {
    await this.send('PATCH', 'v1/install', token, { locale })
  }

  /** The app opened a DevReply link (0.4): Settings shows the deep link works. */
  /** `DevReply.logout()`: this browser's token stops working. */
  async logout(token: string): Promise<void> {
    await this.send('POST', 'v1/logout', token)
  }

  /** `DevReply.deleteUser()`: the user's personal data, conversations and files are deleted. */
  async deleteUser(token: string): Promise<void> {
    await this.send('DELETE', 'v1/me', token)
  }

  async deepLinkOpened(token: string): Promise<void> {
    await this.send('POST', 'v1/deep_link_opened', token)
  }

  /** Live updates (0.5.0): a single-use URL for this install's WebSocket, valid 60 s. 503: live is off. */
  async liveTicket(token: string): Promise<string> {
    const url = str(obj(await this.send('POST', 'v1/live', token)).url)
    if (!url) throw new DevReplyError('server')
    return url
  }

  async config(token: string, appName: string): Promise<{ config: Config; raw: unknown }> {
    const raw = await this.send('GET', 'v1/messenger/config', token)
    return { config: parseConfig(raw, appName), raw }
  }

  async conversations(token: string): Promise<Conversation[]> {
    return lossy(await this.send('GET', 'v1/conversations', token), parseConversation)
  }

  async messages(token: string, conversation: string): Promise<{ conversation: Conversation | null; messages: Message[] }> {
    const r = obj(await this.send('GET', `v1/conversations/${conversation}/messages`, token))
    return { conversation: parseConversation(obj(r.conversation)), messages: lossy(r.messages, parseMessage) }
  }

  async start(
    token: string,
    cat: Category | null,
    text: string,
    attachmentIds: string[],
    context: Context = {},
  ): Promise<{ conversation: Conversation | null; message: Message | null }> {
    const body = { category: cat, text, attachment_ids: attachmentIds, ...(Object.keys(context).length ? { context } : {}) }
    const r = obj(await this.send('POST', 'v1/conversations', token, body))
    return { conversation: parseConversation(obj(r.conversation)), message: parseMessage(obj(r.message)) }
  }

  /** `answer` (0.5.0): the tapped option of a buttons question; 409 when it was already answered. */
  async sendMessage(token: string, conversation: string, text: string, attachmentIds: string[], answer?: Answer): Promise<Message | null> {
    const body = { text, attachment_ids: attachmentIds, ...(answer ? { answer: { message_id: answer.messageId, option_id: answer.optionId } } : {}) }
    const r = await this.send('POST', `v1/conversations/${conversation}/messages`, token, body)
    return parseMessage(obj(r))
  }

  async profile(token: string): Promise<Profile> {
    const r = obj(await this.send('GET', 'v1/me', token))
    return { name: str(r.name), email: str(r.email) }
  }

  async updateProfile(
    token: string,
    patch: { name?: string; email?: string; user_id?: string; attributes?: Record<string, string | number | boolean | null> },
  ): Promise<Profile & { restored: boolean }> {
    const r = obj(await this.send('PATCH', 'v1/me', token, { attributes: {}, ...patch }))
    // `restored` (0.5.0): login moved this install back to the same account's user on this device.
    return { name: str(r.name), email: str(r.email), restored: r.restored === true }
  }

  /** A signed upload slot, then the bytes straight to storage. Returns the attachment id. */
  async upload(token: string, a: Outgoing): Promise<string> {
    const slot = obj(
      await this.send('POST', 'v1/attachments', token, {
        kind: a.kind,
        mime: a.mime,
        size: a.data.size,
        width: a.width ?? null,
        height: a.height ?? null,
        filename: a.filename ?? null,
      }),
    )
    const url = str(slot.upload_url)
    const id = str(slot.id)
    if (!url || !id) throw new DevReplyError('server')
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj(slot.upload_headers))) if (typeof v === 'string') headers[k] = v
    let res: Response
    try {
      res = await fetch(url, { method: 'PUT', headers, body: a.data, credentials: 'omit' })
    } catch {
      throw new DevReplyError('network')
    }
    if (!res.ok) throw new DevReplyError('server', `upload ${res.status}`)
    return id
  }
}

export interface Outgoing {
  kind: 'image' | 'file'
  mime: string
  data: Blob
  filename?: string
  width?: number
  height?: number
  /** Photos: a local preview URL. */
  preview?: string
}
