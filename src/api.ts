// The SDK API (spec 07): the public key registers this browser once; everything after uses the
// install's own token. Same endpoints and shapes as the iOS and Android SDKs.

export class DevReplyError extends Error {
  constructor(
    readonly kind: 'unauthenticated' | 'invalidKey' | 'forbidden' | 'invalid' | 'server' | 'network' | 'unavailable',
    message: string = kind,
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
  | { type: 'unsupported'; fallback: string }

export interface Message {
  id: string
  author: 'user' | 'admin' | 'agent' | 'system'
  createdAt: string
  blocks: Block[]
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
  }
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
    default:
      return { type: 'unsupported', fallback }
  }
}

export function parseMessage(o: Record<string, unknown>): Message | null {
  const id = str(o.id)
  const at = str(o.created_at)
  if (!id || !at) return null
  const a = str(o.author)
  const author = a === 'user' || a === 'admin' || a === 'agent' || a === 'system' ? a : 'admin'
  return { id, author, createdAt: at, blocks: lossy(o.blocks, parseBlock) }
}

export function plainText(m: Message): string {
  return m.blocks
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? 'Photo' : b.type === 'file' ? b.name : b.fallback))
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
    if (res.status === 401) throw new DevReplyError('unauthenticated', message)
    if (res.status === 403) throw new DevReplyError('forbidden', message)
    if (res.status === 400 || res.status === 422) throw new DevReplyError('invalid', message)
    if (res.status === 503) throw new DevReplyError('unavailable', message)
    throw new DevReplyError('server', message)
  }

  async register(publicKey: string, device: Device): Promise<string> {
    try {
      const r = obj(await this.send('POST', 'v1/installs', null, { ...device, public_key: publicKey }))
      const token = str(r.token)
      if (!token) throw new DevReplyError('server')
      return token
    } catch (e) {
      if (e instanceof DevReplyError && e.kind === 'unauthenticated') throw new DevReplyError('invalidKey')
      throw e
    }
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
  ): Promise<{ conversation: Conversation | null; message: Message | null }> {
    const r = obj(await this.send('POST', 'v1/conversations', token, { category: cat, text, attachment_ids: attachmentIds }))
    return { conversation: parseConversation(obj(r.conversation)), message: parseMessage(obj(r.message)) }
  }

  async sendMessage(token: string, conversation: string, text: string, attachmentIds: string[]): Promise<Message | null> {
    const r = await this.send('POST', `v1/conversations/${conversation}/messages`, token, { text, attachment_ids: attachmentIds })
    return parseMessage(obj(r))
  }

  async profile(token: string): Promise<Profile> {
    const r = obj(await this.send('GET', 'v1/me', token))
    return { name: str(r.name), email: str(r.email) }
  }

  async updateProfile(
    token: string,
    patch: { name?: string; email?: string; attributes?: Record<string, string | number | boolean | null> },
  ): Promise<Profile> {
    const r = obj(await this.send('PATCH', 'v1/me', token, { attributes: {}, ...patch }))
    return { name: str(r.name), email: str(r.email) }
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
