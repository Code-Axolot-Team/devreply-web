// Live updates over WebSocket (spec 05 "Live updates over WebSocket", 0.5.0): while the messenger is open
// and the tab visible, new messages arrive the moment they're sent instead of on the 3 s poll.
//
// - Connect: `POST /v1/live` (install token) gives a single-use 60 s URL; `&after=<last message id seen>`
//   makes the server send what was missed first, then `ready`, then live messages.
// - 503 (live off, or the server is full): polling until the messenger opens again. Any other failure
//   (no ticket, the socket never reaching `ready`, or dropping within 30 s of it) counts as a failure.
// - Reconnect after an unexpected close: a new ticket, after 1 s for a connection that was healthy (live
//   for 30 s or more), then 2, 4, 8, 16 s (30 s is the cap), each ±20%; 5 failures in a row: polling
//   until the messenger opens again. A normal close (the messenger closed, the tab hidden) never
//   reconnects.
// - Heartbeat: the server pings every 30 s and closes a connection that stops answering; browsers answer
//   pings on their own and never show them to the page, so the page can't time the 75 s itself.
//   Instead the page relies on the close and error events, and `isLive` also checks the socket's
//   `readyState`, so the 3 s poll takes over as soon as the browser knows the socket is gone. A socket
//   the browser still thinks is open after the network silently died is the one case this misses; it
//   ends when the tab is hidden, the messenger closes, or the browser gives up on the connection.

import { DevReplyError, type Message, parseMessage } from './api'

/** The part of the browser's WebSocket used here (tests pass a fake). */
export interface LiveSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface LiveDeps {
  /** `POST /v1/live`: the socket's URL. Throws `DevReplyError('unavailable')` on 503. */
  ticket(): Promise<string>
  /** A new message in one of this install's conversations. */
  onMessage(conversationId: string, message: Message): void
  /** The socket went live (`ready`: the backlog is in) or stopped being live. */
  onChange(live: boolean): void
  /** Test seams. */
  socket?: (url: string) => LiveSocket
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  random?: () => number
  now?: () => number
}

/** Delays before a reconnect, by failures in a row so far (the last one is the cap). */
export const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
/** Failures in a row before giving up on live until the messenger opens again. */
export const MAX_FAILURES = 5
/** A connection live at least this long was healthy: its drop starts the backoff from the beginning. */
export const HEALTHY_AFTER = 30_000
const OPEN = 1

export type LiveState = 'off' | 'connecting' | 'live' | 'waiting' | 'polling'

/** Message ids are UUID v7 (time-ordered): only those can be compared for "newer". */
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class Live {
  /** off: not wanted; connecting: ticket or socket on its way; live: after `ready`; waiting: a reconnect
   *  is scheduled; polling: gave up (503 or 5 failures) until the messenger opens again. */
  state: LiveState = 'off'
  failures = 0
  /** The newest message id seen (sent as `after`). */
  lastSeen: string | null = null

  private ws: LiveSocket | null = null
  private timer: unknown = null
  /** Bumped by every start/stop: late answers from an older attempt are ignored. */
  private generation = 0
  private liveSince: number | null = null
  private gaveUp = false

  constructor(private deps: LiveDeps) {}

  /** Live and the socket open: the chat's 3 s poll pauses. */
  get isLive(): boolean {
    return this.state === 'live' && this.ws?.readyState === OPEN
  }

  /** The messenger opened: an earlier give-up (503 or 5 failures) and the failures are forgotten. */
  rearm() {
    this.gaveUp = false
    this.failures = 0
    if (this.state === 'polling') this.state = 'off'
  }

  /** Connect, unless it's up, on its way, or given up: the messenger is open and the tab visible. */
  start() {
    if (this.gaveUp) return
    if (this.state === 'connecting' || this.state === 'live') return
    this.clearTimer()
    void this.connect()
  }

  /** Normal close: the messenger closed or the tab was hidden. No reconnect. */
  stop() {
    this.generation++
    this.clearTimer()
    this.closeSocket()
    const was = this.state === 'live'
    this.state = this.gaveUp ? 'polling' : 'off'
    this.liveSince = null
    if (was) this.deps.onChange(false)
  }

  /** A different install (logout, another key): nothing of the old one is kept. */
  reset() {
    this.stop()
    this.lastSeen = null
    this.failures = 0
    this.gaveUp = false
    this.state = 'off'
  }

  /** Tells the server the user sees this conversation (its team replies are read). */
  read(conversationId: string) {
    if (!this.isLive) return
    try {
      this.ws!.send(JSON.stringify({ type: 'read', conversation_id: conversationId }))
    } catch {
      /* the close event follows */
    }
  }

  /** A message id the chat saw (a poll, a send): `after` starts from the newest. */
  saw(id: string) {
    if (V7.test(id) && (this.lastSeen === null || id.toLowerCase() > this.lastSeen)) this.lastSeen = id.toLowerCase()
  }

  private async connect() {
    const gen = ++this.generation
    this.state = 'connecting'
    let url: string
    try {
      url = await this.deps.ticket()
    } catch (e) {
      if (gen !== this.generation) return
      if (e instanceof DevReplyError && e.kind === 'unavailable') return this.giveUp()
      return this.failed()
    }
    if (gen !== this.generation) return
    if (!/^wss?:\/\//.test(url)) return this.failed()
    const full = this.lastSeen ? `${url}${url.includes('?') ? '&' : '?'}after=${encodeURIComponent(this.lastSeen)}` : url
    let ws: LiveSocket
    try {
      ws = (this.deps.socket ?? ((u) => new WebSocket(u) as unknown as LiveSocket))(full)
    } catch {
      return this.failed()
    }
    this.ws = ws
    ws.onmessage = (ev) => {
      if (gen === this.generation) this.frame(ev.data)
    }
    // Error is always followed by close; close alone decides.
    ws.onerror = () => undefined
    ws.onclose = () => {
      if (gen !== this.generation) return
      this.ws = null
      this.ended()
    }
  }

  private frame(data: unknown) {
    if (typeof data !== 'string') return
    let v: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object') return
      v = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (v.type === 'ready') {
      if (this.state !== 'live') {
        this.state = 'live'
        this.liveSince = this.now()
        this.deps.onChange(true)
      }
      return
    }
    if (v.type === 'message') {
      const conversationId = typeof v.conversation_id === 'string' ? v.conversation_id : null
      const raw = v.message
      const m = raw && typeof raw === 'object' ? parseMessage(raw as Record<string, unknown>) : null
      if (!conversationId || !m) return
      this.saw(m.id)
      try {
        this.deps.onMessage(conversationId, m)
      } catch (e) {
        console.error('DevReply: a live message failed', e)
      }
    }
    // Anything else: a newer server's event, ignored.
  }

  /** The socket closed without us asking. */
  private ended() {
    const healthy = this.liveSince !== null && this.now() - this.liveSince >= HEALTHY_AFTER
    const wasLive = this.state === 'live'
    this.liveSince = null
    if (wasLive) this.deps.onChange(false)
    if (healthy) {
      this.failures = 0
      this.schedule()
    } else {
      this.failed()
    }
  }

  private failed() {
    this.failures++
    if (this.failures >= MAX_FAILURES) return this.giveUp()
    this.schedule()
  }

  private schedule() {
    this.state = 'waiting'
    const base = RECONNECT_DELAYS[Math.min(this.failures, RECONNECT_DELAYS.length - 1)]
    const delay = Math.round(base * (0.8 + 0.4 * (this.deps.random ?? Math.random)()))
    const gen = this.generation
    this.timer = (this.deps.setTimeout ?? ((f, ms) => setTimeout(f, ms)))(() => {
      this.timer = null
      if (gen === this.generation && this.state === 'waiting') void this.connect()
    }, delay)
  }

  private giveUp() {
    this.gaveUp = true
    this.state = 'polling'
    this.closeSocket()
  }

  private clearTimer() {
    if (this.timer !== null) (this.deps.clearTimeout ?? ((h) => clearTimeout(h as number)))(this.timer)
    this.timer = null
  }

  private closeSocket() {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null
    try {
      ws.close(1000)
    } catch {
      /* already closing */
    }
  }

  private now() {
    return (this.deps.now ?? Date.now)()
  }
}
