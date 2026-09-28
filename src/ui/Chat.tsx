import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { type Category, DEFAULT_TITLES, DevReplyError, type Message, type Outgoing } from '../api'
import { ConversationModel, type Pending, store } from '../store'
import { Avatar, CategoryIcon, Icon, IconButton, PROMPTS, fileSize, useStore, useSubscribe } from './parts'

type Item =
  | { kind: 'time'; at: string; key: string }
  | { kind: 'message'; message: Message; key: string }
  | { kind: 'pending'; item: Pending; key: string }
  | { kind: 'notice'; key: string }

/** A time label when 15 minutes passed since the previous message. */
function items(model: ConversationModel): Item[] {
  const out: Item[] = []
  const firstFromUser = model.messages.findIndex((m) => m.author === 'user')
  model.messages.forEach((m, i) => {
    const prev = model.messages[i - 1]
    if (!prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 15 * 60_000) {
      out.push({ kind: 'time', at: m.createdAt, key: `time-${m.id}` })
    }
    out.push({ kind: 'message', message: m, key: m.id })
    if (i === firstFromUser) out.push({ kind: 'notice', key: 'notice' })
  })
  for (const p of model.pending) out.push({ kind: 'pending', item: p, key: `pending-${p.id}` })
  return out
}

export function Chat({ conversationId, category }: { conversationId: string | null; category: Category | null }) {
  const s = useStore()
  const model = useMemo(() => new ConversationModel(conversationId, category), [conversationId, category])
  useSubscribe(model)
  // Started on this screen (not opened from the list): the email ask belongs to its first message only.
  const startedHere = useMemo(() => conversationId === null, [conversationId])
  const [emailAskDone, setEmailAskDone] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    void store.loadProfileIfNeeded()
    void model.load()
    const t = window.setInterval(() => void model.load(), 3_000)
    return () => window.clearInterval(t)
  }, [model])
  useEffect(() => {
    store.visibleConversation = model.conversationId
    return () => {
      store.visibleConversation = null
    }
  }, [model, model.conversationId])

  const list = items(model)

  // Newest at the bottom (column-reverse: scrollTop 0 is the bottom). Browsers don't all keep it there
  // when something is added (WebKit doesn't), so if the user is at the bottom, it stays there; if
  // they scrolled up into the history, it leaves them where they are.
  const thread = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const newest = list[list.length - 1]?.key
  useLayoutEffect(() => {
    if (atBottom.current && thread.current) thread.current.scrollTop = 0
  }, [newest, list.length])
  const cat = model.category ?? 'other'
  const title = s.config.startButtons.find((b) => b.category === cat)?.title ?? DEFAULT_TITLES[cat]
  const showsEmailAsk =
    startedHere && !emailAskDone && s.profile !== null && !s.profile.email && model.messages.some((m) => m.author === 'user')

  // Touch: a long drag down through the thread puts the keyboard away, like any good chat.
  const touchY = useRef<number | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    touchY.current = e.touches[0]?.clientY ?? null
  }
  const onTouchMove = (e: TouchEvent) => {
    const start = touchY.current
    const y = e.touches[0]?.clientY
    if (start !== null && y !== undefined && y - start > 90) {
      const active = (e.currentTarget as HTMLElement).getRootNode() as ShadowRoot
      ;(active.activeElement as HTMLElement | null)?.blur()
    }
  }

  return (
    <div class="screen">
      <div class="bar">
        <IconButton icon="back" label="Back" onClick={() => store.back()} />
        <Avatar name={s.config.teamName} size={32} />
        <div class="bar-text">
          <div class="bar-name">{s.config.teamName || 'Chat'}</div>
          {s.config.replyTime && <div class="bar-sub">{s.config.replyTime}</div>}
        </div>
        <IconButton icon="close" label="Close" onClick={() => store.close()} class="close" />
      </div>
      {list.length === 0 ? (
        <div class="empty" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
          <span class="big">
            <CategoryIcon category={cat} class="" />
          </span>
          <h2>{title}</h2>
          <p>{PROMPTS[cat]}</p>
        </div>
      ) : (
        <div
          ref={thread}
          class="thread"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onScroll={(e) => {
            atBottom.current = Math.abs((e.currentTarget as HTMLDivElement).scrollTop) < 60
          }}
          aria-live="polite"
        >
          <div class="thread-inner">
            {list.map((it) =>
              it.kind === 'time' ? (
                <TimeLabel key={it.key} at={it.at} />
              ) : it.kind === 'message' ? (
                <MessageRow key={it.key} message={it.message} team={s.config.teamName} onOpenImage={setViewing} />
              ) : it.kind === 'pending' ? (
                <PendingRow key={it.key} item={it.item} onRetry={() => model.retry(it.item)} />
              ) : (
                <Notice key={it.key} team={s.config.teamName} within={s.config.replyWithin} email={s.profile?.email ?? null} />
              ),
            )}
          </div>
        </div>
      )}
      <div class="bottom">
        {s.profile === null ? null : s.needsName ? (
          <NameForm />
        ) : (
          <>
            {showsEmailAsk && <EmailAsk onDone={() => setEmailAskDone(true)} />}
            <Composer autoFocus={conversationId === null} onSend={(text, staged) => model.send(text, staged)} />
          </>
        )}
      </div>
      {viewing && (
        <div class="viewer" role="dialog" aria-label="Photo" onClick={() => setViewing(null)}>
          <img src={viewing} alt="Photo" />
          <IconButton icon="close" label="Close photo" onClick={() => setViewing(null)} />
        </div>
      )}
    </div>
  )
}

/** "MON · 6:52 PM", like the timestamps on devreply.com. */
function TimeLabel({ at }: { at: string }) {
  const d = new Date(at)
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d)
  return <div class="time kicker">{`${day} · ${time}`}</div>
}

function MessageRow({ message, team, onOpenImage }: { message: Message; team: string; onOpenImage: (url: string) => void }) {
  if (message.author === 'system') {
    // e.g. "✓ Marked as resolved…": a quiet line, not a bubble.
    return <div class="system">{message.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(' ')}</div>
  }
  const me = message.author === 'user'
  return (
    <div class={`row ${me ? 'me' : 'team'}`}>
      {!me && <Avatar name={team} size={30} fill="var(--dr-lemon)" />}
      <div class="stack">
        {message.blocks.map((b, i) =>
          b.type === 'text' ? (
            <div key={i} class={`bubble ${me ? 'me' : 'team'}`}>
              {b.text}
            </div>
          ) : b.type === 'image' ? (
            <button key={i} type="button" class="photo" aria-label="Open photo" onClick={() => onOpenImage(b.url)}>
              <img src={b.url} alt="Photo" width={b.width} height={b.height} loading="lazy" />
            </button>
          ) : b.type === 'file' ? (
            <a key={i} class="filechip" href={b.url} target="_blank" rel="noopener" download={b.name}>
              <span class="fi">
                <Icon name="file" />
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{b.name}</b>
                <small>{fileSize(b.size)}</small>
              </span>
            </a>
          ) : (
            <div key={i} class={`bubble ${me ? 'me' : 'team'} muted`}>
              {b.fallback}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function PendingRow({ item, onRetry }: { item: Pending; onRetry: () => void }) {
  const failed = item.failure !== null
  const body = (
    <div class="stack">
      {item.attachments.map((a, i) =>
        a.preview ? (
          <span key={i} class="photo pending">
            <img src={a.preview} alt="" />
          </span>
        ) : (
          <span key={i} class="filechip pending">
            <span class="fi">
              <Icon name="file" />
            </span>
            <b>{a.filename}</b>
          </span>
        ),
      )}
      {item.text && <div class={`bubble me ${failed ? '' : 'pending'}`}>{item.text}</div>}
      {failed ? (
        <span class="failed">
          <Icon name="warning" />
          {item.failure}
        </span>
      ) : (
        <span class="kicker">{item.attachments.length ? 'Uploading…' : 'Sending…'}</span>
      )}
    </div>
  )
  return failed ? (
    <button type="button" class="row me" onClick={onRetry}>
      {body}
    </button>
  ) : (
    <div class="row me">{body}</div>
  )
}

/** Under the user's first message: it arrived, and how long a reply usually takes. Never promises who answers. */
function Notice({ team, within, email }: { team: string; within: string; email: string | null }) {
  return (
    <div class="notice" data-testid="devreply.notice">
      <Avatar name={team} size={36} />
      <div>
        <b>Thanks, we got it!</b>
        <p>
          Please allow up to {within} for a reply. {email ? `We'll also email you at ${email}.` : "You'll see it right here."}
        </p>
      </div>
    </div>
  )
}

function errorText(e: unknown): string {
  if (e instanceof DevReplyError && e.kind === 'invalid') return e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.'
  return "Couldn't save. Check your connection and try again."
}

/** Asked once, before the first message, unless the site passed a name with `DevReply.setUser`. */
function NameForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  async function save(e?: Event) {
    e?.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await store.saveProfile({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) })
    } catch (err) {
      setError(errorText(err))
    }
    setSaving(false)
  }

  return (
    <form class="card" onSubmit={save} noValidate>
      <span>
        <span class="kicker inv">Before we start</span>
      </span>
      <span style={{ fontSize: 15, fontWeight: 500 }}>
        So the developer knows who they're talking to. Add your email to get the reply there too.
      </span>
      <input
        ref={nameRef}
        class="field"
        placeholder="Your name"
        autocomplete="name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        data-testid="devreply.profile.name"
        aria-label="Your name"
      />
      <input
        class="field"
        type="email"
        placeholder="Email (optional)"
        autocomplete="email"
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        data-testid="devreply.profile.email"
        aria-label="Email (optional)"
      />
      {error && (
        <span class="error" role="alert">
          {error}
        </span>
      )}
      <button type="submit" class="btn" disabled={saving || !name.trim()} data-testid="devreply.profile.save">
        {saving ? 'Saving…' : 'Start chatting'}
      </button>
    </form>
  )
}

/** Right after the first message of a request, if we don't have their email: optional, one tap to skip. */
function EmailAsk({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e?: Event) {
    e?.preventDefault()
    if (!email.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await store.saveProfile({ email: email.trim() })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
    setSaving(false)
  }

  return (
    <form class="card" onSubmit={save} noValidate>
      <div class="card-row">
        <span class="card-title">Get the reply by email too?</span>
        <button type="button" class="link" onClick={onDone} data-testid="devreply.emailask.skip">
          No thanks
        </button>
      </div>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Optional. Only about this conversation, and you can unsubscribe any time.</span>
      <div class="card-row">
        <input
          class="field"
          type="email"
          placeholder="you@example.com"
          autocomplete="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          data-testid="devreply.emailask.field"
          aria-label="Your email"
        />
        <button type="submit" class="btn" disabled={saving || !email.trim()} data-testid="devreply.emailask.save">
          {saving ? '…' : 'Save'}
        </button>
      </div>
      {error && (
        <span class="error" role="alert">
          {error}
        </span>
      )}
    </form>
  )
}

const MAX_PHOTO_SIDE = 2048
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Resized to 2048 px and re-encoded as JPEG, which drops EXIF (including location), like the mobile SDKs. */
async function photo(file: File): Promise<Outgoing | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) return null
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
  if (!blob) return null
  return { kind: 'image', mime: 'image/jpeg', data: blob, width, height, preview: URL.createObjectURL(blob) }
}

function Composer({ autoFocus, onSend }: { autoFocus: boolean; onSend: (text: string, staged: Outgoing[]) => void }) {
  const [draft, setDraft] = useState('')
  const [staged, setStaged] = useState<Outgoing[]>([])
  const [menu, setMenu] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const photos = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const canSend = draft.trim().length > 0 || staged.length > 0
  // Enter sends with a keyboard and mouse; on touch screens Return adds a line (the send button sends).
  const enterSends = useMemo(() => window.matchMedia?.('(pointer: fine)').matches ?? true, [])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight + 6, 140)}px`
  }, [draft])

  async function add(list: FileList | null) {
    if (!list?.length) return
    setPickError(null)
    const next: Outgoing[] = []
    for (const f of Array.from(list)) {
      if (f.type.startsWith('image/')) {
        const p = await photo(f)
        if (p) {
          next.push(p)
          continue
        }
      }
      if (f.size > MAX_FILE_BYTES) {
        setPickError(`${f.name} is over 10 MB.`)
        continue
      }
      next.push({ kind: 'file', mime: f.type || 'application/octet-stream', data: f, filename: f.name })
    }
    setStaged((s) => {
      const all = [...s, ...next]
      if (all.length > 4) setPickError('Up to 4 attachments per message.')
      return all.slice(0, 4)
    })
  }

  function send() {
    if (!canSend) return
    onSend(draft, staged)
    setDraft('')
    setStaged([])
    setPickError(null)
    ref.current?.focus() // the keyboard stays up for the next message
  }

  return (
    <div class="composer">
      {staged.length > 0 && (
        <div class="staged">
          {staged.map((a, i) => (
            <span class="thumb" key={i}>
              {a.preview ? <img src={a.preview} alt="" /> : <span>{a.filename}</span>}
              <button type="button" class="rm" aria-label={`Remove ${a.filename ?? 'photo'}`} onClick={() => setStaged(staged.filter((x) => x !== a))}>
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      {pickError && <span class="error">{pickError}</span>}
      <div class="composer-row">
        <div class="attach">
          <button type="button" class="icon-btn" aria-label="Attach a photo or file" aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="devreply.attach">
            <Icon name="attach" />
          </button>
          {menu && (
            <div class="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => (setMenu(false), photos.current?.click())}>
                <Icon name="photo" /> Photo
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), files.current?.click())}>
                <Icon name="file" /> File
              </button>
            </div>
          )}
          <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => void add((e.target as HTMLInputElement).files)} data-testid="devreply.photos" />
          <input ref={files} type="file" multiple hidden onChange={(e) => void add((e.target as HTMLInputElement).files)} data-testid="devreply.files" />
        </div>
        <textarea
          ref={ref}
          rows={1}
          placeholder="Message…"
          value={draft}
          aria-label="Message"
          data-testid="devreply.composer"
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && enterSends && !e.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="button" class="send" aria-label="Send" disabled={!canSend} onClick={send} data-testid="devreply.send">
          <Icon name="send" />
        </button>
      </div>
    </div>
  )
}
