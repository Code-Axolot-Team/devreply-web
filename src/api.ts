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
  /** The app's own deep-link schemes (0.6.0), e.g. `kneefit`: link buttons, gifts and Markdown links may
   *  open them, next to https. Lowercase, without `://`. */
  linkSchemes: string[]
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
  /** Link buttons (0.6.0): an optional Markdown intro and 1 to 3 buttons that open a URL. */
  | { type: 'links'; text: string | null; links: LinkButton[]; fallback: string }
  /** A gift (0.6.0): a card with "Open gift", which opens `url` (it carries a one-time token). */
  | { type: 'gift'; giftId: string; title: string; text: string; url: string; expiresAt: string | null; fallback: string }
  /** Several questions in one reply (0.6.0), answered in one go. */
  | { type: 'form'; text: string | null; questions: FormQuestion[]; fallback: string }
  | { type: 'unsupported'; fallback: string }

/** One button of a links block (0.6.0). */
export interface LinkButton {
  id: string
  label: string
  url: string
}

/** One question of a form (0.6.0): `single` and `multi` have 2 to 6 options, `text` none. */
export interface FormQuestion {
  id: string
  text: string
  kind: 'single' | 'multi' | 'text'
  options: ButtonOption[]
  required: boolean
}

/** A form's answers by question id (0.6.0): an option id (single), option ids (multi) or text. */
export type FormAnswers = Record<string, string | string[]>

/** Which form a user message answered, and how (0.6.0). */
export interface FormAnswer {
  messageId: string
  answers: FormAnswers
}

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
  /** A user message that answered a form (0.6.0). */
  formAnswer?: FormAnswer
  /** An offer or campaign from the team (0.6.0): an Offer label and "Don't send me offers". */
  promotional?: true
}

export interface Profile {
  name: string | null
  email: string | null
  /** The user asked for no offers (0.6.0). */
  noPromotions: boolean
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
    linkSchemes: [],
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
    linkSchemes: Array.isArray(o.link_schemes) ? o.link_schemes.flatMap((x) => (typeof x === 'string' && isAppScheme(x.toLowerCase()) ? [x.toLowerCase()] : [])) : [],
  }
}

// ---- links (0.6.0): https, or the app's own deep-link scheme; nothing else is ever opened ----

/** Schemes an app can never claim as its own: they'd run code or read the browser's own data. */
const NEVER = ['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'filesystem', 'http', 'https', 'ws', 'wss', 'chrome', 'view-source']

/** A scheme an app may register for its deep links (`kneefit`, `com.example.app`). */
export const isAppScheme = (s: string): boolean => /^[a-z][a-z0-9+.-]{0,63}$/.test(s) && !NEVER.includes(s)

/**
 * How a link opens: `tab` (https: a new tab, no opener), `app` (the app's own scheme: `location.href`,
 * the OS hands it to the app), or null (anything else: never opened).
 */
export function linkTarget(url: string, schemes: readonly string[]): 'tab' | 'app' | null {
  const u = url.trim()
  if (/^https:\/\/[^\s]/i.test(u) && !/\s/.test(u)) return 'tab'
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u)
  if (!m || /\s/.test(u)) return null
  const scheme = m[1].toLowerCase()
  return isAppScheme(scheme) && schemes.includes(scheme) ? 'app' : null
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

/** Still open for the user: not resolved (`closed`, or `resolved` from a live message). */
export const isOpenConversation = (c: Conversation): boolean => c.status !== 'closed' && c.status !== 'resolved'

/** What a start topic opens (0.5.1): the newest open conversation in that category, so the user sees
 *  the answer instead of writing twice; null starts a new one. */
export function openConversationIn(conversations: readonly Conversation[], cat: Category): Conversation | null {
  return newest(conversations.filter((c) => c.category === cat && isOpenConversation(c)))
}

/** The conversation home puts first (0.5.1): the newest with an unread reply from the team. */
export function unreadReply(conversations: readonly Conversation[]): Conversation | null {
  return newest(conversations.filter((c) => c.unread > 0 && c.lastAuthor !== 'user' && c.lastAuthor !== 'system'))
}

const newest = (list: readonly Conversation[]): Conversation | null =>
  list.reduce<Conversation | null>((best, c) => (!best || c.lastMessageAt > best.lastMessageAt ? c : best), null)

/** The first words of a text for a one-line preview: spaces folded, cut at a word near `max` characters. */
export function firstWords(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  if (chars.length <= max) return flat
  const cut = chars.slice(0, max).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
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
    case 'links': {
      const links = lossy(b.links, (l) => {
        const id = str(l.id)
        const label = str(l.label)?.trim()
        const to = str(l.url)?.trim()
        return id && label && to ? { id, label: Array.from(label).slice(0, 40).join(''), url: to } : null
      }).slice(0, 3)
      if (links.length === 0) return { type: 'unsupported', fallback }
      const text = str(b.text)?.trim() || null
      const lines = links.map((l) => `${l.label}: ${l.url}`).join('\n')
      return { type: 'links', text, links, fallback: str(b.fallback) ?? (text ? `${plainMarkdown(parseMarkdown(text))}\n\n${lines}` : lines) }
    }
    case 'gift': {
      const giftId = str(b.gift_id)
      const title = str(b.title)?.trim()
      if (!giftId || !title || !url) return { type: 'unsupported', fallback }
      const text = str(b.text)?.trim() ?? ''
      const expires = str(b.expires_at)
      return {
        type: 'gift',
        giftId,
        title,
        text,
        url,
        expiresAt: expires && !Number.isNaN(Date.parse(expires)) ? expires : null,
        fallback: str(b.fallback) ?? `🎁 ${title}${text ? `. ${text}` : ''}\nOpen it: ${url}`,
      }
    }
    case 'form': {
      // A question this SDK can't show (an unknown kind, too few options) would leave the form
      // unanswerable: then the whole form shows its fallback.
      const raw = Array.isArray(b.questions) ? b.questions : []
      const questions: FormQuestion[] = []
      for (const x of raw.slice(0, 5)) {
        const q = parseQuestion(obj(x))
        if (!q) return { type: 'unsupported', fallback }
        questions.push(q)
      }
      if (questions.length === 0 || new Set(questions.map((q) => q.id)).size !== questions.length) return { type: 'unsupported', fallback }
      return { type: 'form', text: str(b.text)?.trim() || null, questions, fallback }
    }
    case 'form_answer':
      // A form's answer as its own block: its readable summary.
      return { type: 'text', text: str(b.text) ?? fallback }
    default:
      return { type: 'unsupported', fallback }
  }
}

function parseQuestion(q: Record<string, unknown>): FormQuestion | null {
  const id = str(q.id)
  const text = str(q.text)?.trim()
  const kind = q.kind === 'single' || q.kind === 'multi' || q.kind === 'text' ? q.kind : null
  if (!id || !text || !kind) return null
  const options = kind === 'text' ? [] : lossy(q.options, (o) => {
    const oid = str(o.id)
    const label = str(o.label)?.trim()
    return oid && label ? { id: oid, label } : null
  }).slice(0, 6)
  if (kind !== 'text' && options.length < 2) return null
  return { id, text, kind, options, required: q.required === true }
}

/** `{"message_id", "answers": {…}}` from the server (0.6.0); null for anything else. Answers that
 *  aren't text or a list of texts are left out. */
export function parseFormAnswer(v: unknown): FormAnswer | null {
  const o = obj(v)
  const messageId = str(o.message_id)
  if (!messageId) return null
  const answers: FormAnswers = {}
  for (const [k, a] of Object.entries(obj(o.answers))) {
    if (typeof a === 'string') answers[k] = a
    else if (Array.isArray(a)) answers[k] = a.filter((x): x is string => typeof x === 'string')
  }
  return { messageId, answers }
}

/** What the user filled in so far (0.6.0): an option, options, or text per question. */
export type FormDraft = Record<string, string | string[] | undefined>

/** The required questions still without an answer (0.6.0). */
export function missingAnswers(questions: readonly FormQuestion[], draft: FormDraft): string[] {
  return questions.filter((q) => q.required && !hasAnswer(q, draft[q.id])).map((q) => q.id)
}

function hasAnswer(q: FormQuestion, a: string | string[] | undefined): boolean {
  if (q.kind === 'text') return typeof a === 'string' && a.trim().length > 0
  if (q.kind === 'single') return typeof a === 'string' && q.options.some((o) => o.id === a)
  return Array.isArray(a) && a.some((id) => q.options.some((o) => o.id === id))
}

/**
 * The `answers` the server takes (0.6.0): single → an option id, multi → option ids in the form's
 * order, text → trimmed (up to 2000 characters). Unanswered questions and unknown ids are left out.
 */
export function encodeFormAnswers(questions: readonly FormQuestion[], draft: FormDraft): FormAnswers {
  const out: FormAnswers = {}
  for (const q of questions) {
    const a = draft[q.id]
    if (!hasAnswer(q, a)) continue
    if (q.kind === 'text') out[q.id] = Array.from((a as string).trim()).slice(0, 2000).join('')
    else if (q.kind === 'single') out[q.id] = a as string
    else out[q.id] = q.options.filter((o) => (a as string[]).includes(o.id)).map((o) => o.id)
  }
  return out
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
  const formAnswer =
    author === 'user' ? (parseFormAnswer(o.form_answer) ?? blocks.map((b) => parseFormAnswer(obj(b).form_answer)).find((a) => a) ?? null) : null
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
    ...(formAnswer ? { formAnswer } : {}),
    ...(author !== 'user' && o.promotional === true ? { promotional: true as const } : {}),
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
              : b.type === 'gift'
                ? `🎁 ${b.title}`
                : b.fallback,
    )
    .join('\n')
}

// ---- HTTP ----

/** How long a request may take (0.5.1), like the iOS and Android SDKs; uploads get longer. */
export const TIMEOUTS = { request: 20_000, upload: 60_000 }

/**
 * A signal that aborts after `ms` (0.5.1). `AbortSignal.timeout` where the browser has it; else an
 * AbortController and a timer (Safari before 16, older Chrome). `done` stops the timer once the
 * answer is read.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal | undefined; done: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms), done: () => {} }
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/** `fetch` that gives up after `ms`: a hang, like no connection, is a `network` error (0.5.1). The
 *  body is read under the same limit; a server that stalls halfway counts too. */
async function fetchWithin(ms: number, url: string, init: RequestInit): Promise<{ res: Response; json: unknown }> {
  const { signal, done } = timeoutSignal(ms)
  try {
    const res = await fetch(url, { ...init, ...(signal ? { signal } : {}) })
    let json: unknown = {}
    try {
      json = await res.json()
    } catch (e) {
      if (signal?.aborted) throw e
    }
    return { res, json }
  } catch {
    throw new DevReplyError('network')
  } finally {
    done()
  }
}

export class ApiClient {
  /** `timeouts`: for tests only. */
  constructor(
    readonly baseUrl: string,
    private readonly timeouts: { request: number; upload: number } = TIMEOUTS,
  ) {}

  private async send(method: string, path: string, token: string | null, body?: unknown): Promise<unknown> {
    const { res, json } = await fetchWithin(this.timeouts.request, `${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    })
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
    return { name: str(r.name), email: str(r.email), noPromotions: r.no_promotions === true }
  }

  async updateProfile(
    token: string,
    patch: {
      name?: string
      email?: string
      user_id?: string
      attributes?: Record<string, string | number | boolean | null>
      /** "Don't send me offers" (0.6.0). */
      no_promotions?: boolean
    },
  ): Promise<Profile & { restored: boolean }> {
    const r = obj(await this.send('PATCH', 'v1/me', token, { attributes: {}, ...patch }))
    // `restored` (0.5.0): login moved this install back to the same account's user on this device.
    const noPromotions = typeof r.no_promotions === 'boolean' ? r.no_promotions : patch.no_promotions === true
    return { name: str(r.name), email: str(r.email), noPromotions, restored: r.restored === true }
  }

  /** A link button was tapped (0.6.0): for the team's stats and webhooks. 204. */
  async tap(token: string, conversation: string, messageId: string, linkId: string): Promise<void> {
    await this.send('POST', `v1/conversations/${conversation}/taps`, token, { message_id: messageId, link_id: linkId })
  }

  /** "Open gift" was tapped (0.6.0). 204. */
  async giftOpened(token: string, giftId: string): Promise<void> {
    await this.send('POST', `v1/gifts/${encodeURIComponent(giftId)}/opened`, token)
  }

  /** A form's answers in one go (0.6.0): the user's answer message. 409: already answered; 400: a
   *  required one is missing or an id is unknown. */
  async answerForm(token: string, conversation: string, messageId: string, answers: FormAnswers): Promise<Message | null> {
    const r = await this.send('POST', `v1/conversations/${conversation}/messages`, token, { form_answer: { message_id: messageId, answers } })
    return parseMessage(obj(r))
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
    const { res } = await fetchWithin(this.timeouts.upload, url, { method: 'PUT', headers, body: a.data, credentials: 'omit' })
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
