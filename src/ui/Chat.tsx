import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  type Block,
  type ButtonOption,
  type Category,
  type Config,
  DevReplyError,
  type FormAnswer,
  type FormAnswers,
  type FormDraft,
  type FormQuestion,
  type Message,
  type Outgoing,
  encodeFormAnswers,
  linkTarget,
  missingAnswers,
} from '../api'
import { intlLocale, t } from '../i18n'
import { ConversationModel, type Pending, store } from '../store'
import { parseMarkdown, plainMarkdown } from '../markdown'
import { Markdown } from './Markdown'
import { Avatar, CategoryIcon, Icon, IconButton, categoryTitle, fileSize, prompt, replyAllow, replyTime, useStore, useSubscribe } from './parts'

/** The fallback text the API parser writes for blocks this SDK can't show. */
const UNSUPPORTED_EN = 'This message needs a newer version of the app.'

type Item =
  | { kind: 'time'; at: string; key: string }
  | { kind: 'message'; message: Message; key: string; showsPersona: boolean }
  | { kind: 'pending'; item: Pending; key: string }
  | { kind: 'notice'; key: string }

/** A time label when 15 minutes passed since the previous message. */
function items(model: ConversationModel): Item[] {
  const out: Item[] = []
  const firstFromUser = model.messages.findIndex((m) => m.author === 'user')
  model.messages.forEach((m, i) => {
    const prev = model.messages[i - 1]
    const timeLabel = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 15 * 60_000
    if (timeLabel) out.push({ kind: 'time', at: m.createdAt, key: `time-${m.id}` })
    // Who replied: above the first reply of each group (after the user, a time label, or another persona).
    const showsPersona =
      !!m.persona && (timeLabel || !prev || prev.author === 'user' || prev.author === 'system' || prev.persona?.name !== m.persona.name)
    out.push({ kind: 'message', message: m, key: m.id, showsPersona })
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
  // `open(…, { message })`: a draft for the presentation's new conversation, never sent by itself.
  const draft = useMemo(() => (conversationId === null ? (store.presentation.message ?? '') : ''), [conversationId])
  const [emailAskDone, setEmailAskDone] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    void store.loadProfileIfNeeded(true)
    void model.load()
    const detach = store.attach(model)
    // The 3 s poll pauses while the live socket is up (0.5.0) and picks up again whenever it's down.
    const t = window.setInterval(() => {
      if (!store.live.isLive) void model.load()
    }, 3_000)
    return () => {
      window.clearInterval(t)
      detach()
    }
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
  const title = categoryTitle(s.config, cat)
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
        <IconButton icon="back" label={t('back')} onClick={() => store.back()} />
        <Avatar name={s.config.teamName} size={32} url={s.config.appIconUrl} />
        <div class="bar-text">
          <div class="bar-name">{s.config.teamName || t('chat')}</div>
          {replyTime(s.config) && <div class="bar-sub">{replyTime(s.config)}</div>}
        </div>
        <IconButton icon="close" label={t('close')} onClick={() => store.close()} class="close" />
      </div>
      {list.length === 0 ? (
        <div class="empty" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
          <span class="big">
            <CategoryIcon category={cat} class="" />
          </span>
          <h2>{title}</h2>
          <p>{prompt(cat)}</p>
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
                <MessageRow
                  key={it.key}
                  message={it.message}
                  showsPersona={it.showsPersona}
                  team={s.config.teamName}
                  icon={s.config.appIconUrl}
                  onOpenImage={setViewing}
                  answer={model.answerTo(it.message.id)}
                  onAnswer={(option) => model.answer(it.message.id, option)}
                  model={model}
                  schemes={s.config.linkSchemes}
                />
              ) : it.kind === 'pending' ? (
                <PendingRow key={it.key} item={it.item} onRetry={() => model.retry(it.item)} />
              ) : (
                <Notice key={it.key} config={s.config} email={s.profile?.email ?? null} />
              ),
            )}
          </div>
        </div>
      )}
      <div class="bottom">
        {s.profile === null ? (
          <ProfileWait error={s.profileError} />
        ) : s.needsName ? (
          <NameForm />
        ) : (
          <>
            {showsEmailAsk && <EmailAsk onDone={() => setEmailAskDone(true)} />}
            <Composer autoFocus={conversationId === null} initial={draft} onSend={(text, staged) => model.send(text, staged)} />
          </>
        )}
      </div>
      {viewing && (
        <div class="viewer" role="dialog" aria-label={t('photo')} onClick={() => setViewing(null)}>
          <img src={viewing} alt={t('photo')} />
          <IconButton icon="close" label={t('close_photo')} onClick={() => setViewing(null)} />
        </div>
      )}
    </div>
  )
}

/** "MON · 6:52 PM", like the timestamps on devreply.com. */
function TimeLabel({ at }: { at: string }) {
  const d = new Date(at)
  const day = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d)
  const time = new Intl.DateTimeFormat(intlLocale(), { timeStyle: 'short' }).format(d)
  return <div class="time kicker">{`${day} · ${time}`}</div>
}

function MessageRow({
  message,
  showsPersona,
  team,
  icon,
  onOpenImage,
  answer,
  onAnswer,
  model,
  schemes,
}: {
  message: Message
  showsPersona: boolean
  team: string
  icon: string | null
  onOpenImage: (url: string) => void
  /** Buttons questions (0.5.0): the chosen option, null if answered elsewhere, undefined while open. */
  answer: string | null | undefined
  onAnswer: (option: ButtonOption) => void
  /** Link buttons, gifts and forms (0.6.0) report to and answer through the conversation. */
  model: ConversationModel
  /** The app's own deep-link schemes (0.6.0). */
  schemes: readonly string[]
}) {
  if (message.author === 'system') {
    // e.g. "✓ Marked as resolved…": a quiet line, not a bubble. Known lines in the user's language.
    const text = message.systemKey === 'resolved' ? t('system.resolved') : message.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
    return <div class="system">{text}</div>
  }
  const me = message.author === 'user'
  const persona = me ? undefined : message.persona
  return (
    <div class={`row ${me ? 'me' : 'team'} ${persona ? 'persona' : ''}`}>
      {!me && !persona && <Avatar name={team} size={30} fill="var(--dr-lemon)" url={icon} />}
      <div class="stack">
        {persona && showsPersona && (
          <div class="by" data-testid="devreply.persona">
            <Avatar name={persona.name} size={22} url={persona.avatarUrl} />
            <b>{persona.name}</b>
            {persona.title && <span class="muted">{persona.title}</span>}
          </div>
        )}
        {message.promotional && (
          <span class="kicker inv offer-tag" data-testid="devreply.offer.label">
            {t('offer.label')}
          </span>
        )}
        {message.blocks.map((b, i) =>
          b.type === 'text' ? (
            <div key={i} class={`bubble ${me ? 'me' : 'team'}`}>
              {b.text}
            </div>
          ) : b.type === 'markdown' ? (
            // Team and agent replies only: the user's own messages stay plain text.
            me ? (
              <div key={i} class="bubble me">
                {b.fallback}
              </div>
            ) : (
              <div key={i} class="bubble team md" data-testid="devreply.markdown">
                <Markdown text={b.text} schemes={schemes} />
              </div>
            )
          ) : b.type === 'buttons' ? (
            me ? (
              <div key={i} class="bubble me">
                {b.fallback}
              </div>
            ) : (
              <Buttons key={i} block={b} answer={answer} onAnswer={onAnswer} schemes={schemes} />
            )
          ) : (b.type === 'links' || b.type === 'gift' || b.type === 'form') && me ? (
            <div key={i} class="bubble me">
              {b.fallback}
            </div>
          ) : b.type === 'links' ? (
            <Links key={i} block={b} schemes={schemes} onTap={(link) => model.tapLink(message.id, link)} />
          ) : b.type === 'gift' ? (
            <Gift key={i} block={b} schemes={schemes} onOpen={() => model.openGift(b.giftId, b.url)} />
          ) : b.type === 'form' ? (
            <Form
              key={i}
              block={b}
              schemes={schemes}
              answer={model.formAnswerTo(message.id)}
              sending={model.isSendingForm(message.id)}
              onSend={(answers) => model.answerForm(message.id, answers)}
            />
          ) : b.type === 'image' ? (
            <button key={i} type="button" class="photo" aria-label={t('open_photo')} onClick={() => onOpenImage(b.url)}>
              <img src={b.url} alt={t('photo')} width={b.width} height={b.height} loading="lazy" />
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
              {b.fallback === UNSUPPORTED_EN ? t('unsupported') : b.fallback}
            </div>
          ),
        )}
        {message.promotional && <OfferOptOut />}
      </div>
    </div>
  )
}

/** Under an offer (0.6.0): "Don't send me offers", then "You won't get offers. Undo". The profile's
 *  `no_promotions` is the state, so an earlier choice shows too. */
function OfferOptOut() {
  const s = useStore()
  if (!s.profile) return null
  return s.profile.noPromotions ? (
    <div class="offer-out" data-testid="devreply.offer.opted_out">
      <span>{t('offer.opted_out')}</span>
      <button type="button" class="link" onClick={() => void store.setNoPromotions(false)} data-testid="devreply.offer.undo">
        {t('offer.undo')}
      </button>
    </div>
  ) : (
    <div class="offer-out">
      <button type="button" class="link" onClick={() => void store.setNoPromotions(true)} data-testid="devreply.offer.opt_out">
        {t('offer.opt_out')}
      </button>
    </div>
  )
}

/** Link buttons (0.6.0): the intro, then 1 to 3 outlined buttons. A tap opens the link (https in a new
 *  tab, the app's own scheme in place); one this SDK may not open stays disabled. */
function Links({
  block,
  schemes,
  onTap,
}: {
  block: Extract<Block, { type: 'links' }>
  schemes: readonly string[]
  onTap: (link: Extract<Block, { type: 'links' }>['links'][number]) => void
}) {
  return (
    <>
      {block.text && (
        <div class="bubble team md" data-testid="devreply.links.text">
          <Markdown text={block.text} schemes={schemes} />
        </div>
      )}
      <div class="choices links" data-testid="devreply.links">
        {block.links.map((l) => (
          <button
            key={l.id}
            type="button"
            class="choice linkbtn"
            disabled={linkTarget(l.url, schemes) === null}
            onClick={() => onTap(l)}
            data-testid={`devreply.links.link.${l.id}`}
          >
            <span class="choice-label">{l.label}</span>
            <Icon name="arrow" class="i choice-go" />
          </button>
        ))}
      </div>
    </>
  )
}

/** A gift (0.6.0): a small wrapped box, the title and one line, and "Open gift"; after `expires_at`
 *  the button says the gift has expired (the card turns over by itself at that moment). */
function Gift({ block, schemes, onOpen }: { block: Extract<Block, { type: 'gift' }>; schemes: readonly string[]; onOpen: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const expiresAt = block.expiresAt ? Date.parse(block.expiresAt) : null
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(expiresAt - now + 50, 2 ** 31 - 1))
    return () => window.clearTimeout(id)
  }, [expiresAt, now])
  const expired = expiresAt !== null && now >= expiresAt
  return (
    <div class={`gift ${expired ? 'expired' : ''}`} data-testid="devreply.gift">
      <div class="gift-wrap" aria-hidden="true">
        <span class="gift-bow" />
      </div>
      <div class="gift-body">
        <span class="kicker">{t('gift.label')}</span>
        <b class="gift-title">{block.title}</b>
        {block.text && <p>{block.text}</p>}
        <button
          type="button"
          class="btn"
          disabled={expired || linkTarget(block.url, schemes) === null}
          onClick={onOpen}
          data-testid={expired ? 'devreply.gift.expired' : 'devreply.gift.open'}
        >
          {expired ? t('gift.expired') : t('gift.open')}
        </button>
      </div>
    </div>
  )
}

/**
 * Several questions in one reply (0.6.0): single choice, any number (multi), and free text, sent
 * together once. A required one left open says so when the user sends. Answered, the form stays as
 * a read-only record of the answers.
 */
function Form({
  block,
  schemes,
  answer,
  sending,
  onSend,
}: {
  block: Extract<Block, { type: 'form' }>
  schemes: readonly string[]
  answer: FormAnswer | undefined
  sending: boolean
  onSend: (answers: FormAnswers) => Promise<string | null>
}) {
  const [draft, setDraft] = useState<FormDraft>({})
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = answer !== undefined
  const values: FormDraft = done ? answer.answers : draft
  const missing = tried && !done ? missingAnswers(block.questions, draft) : []

  async function send() {
    setTried(true)
    setError(null)
    if (missingAnswers(block.questions, draft).length) return
    setError(await onSend(encodeFormAnswers(block.questions, draft)))
  }
  const set = (q: FormQuestion, v: string | string[]) => setDraft((d) => ({ ...d, [q.id]: v }))

  return (
    <div class={`form ${done ? 'answered' : ''}`} data-testid="devreply.form">
      {block.text && (
        <div class="md form-intro">
          <Markdown text={block.text} schemes={schemes} />
        </div>
      )}
      {block.questions.map((q) => {
        const v = values[q.id]
        const isMissing = missing.includes(q.id)
        return (
          <fieldset key={q.id} class={`q ${isMissing ? 'missing' : ''}`} data-testid={`devreply.form.question.${q.id}`}>
            <legend class="q-text">
              {q.text}
              {q.required && !done && (
                <span class="q-req" aria-hidden="true">
                  {' *'}
                </span>
              )}
            </legend>
            {q.kind === 'multi' && !done && <span class="q-hint">{t('form.pick_any')}</span>}
            {q.kind === 'text' ? (
              done ? (
                <div class="q-answer" data-testid={`devreply.form.answer.${q.id}`}>
                  {typeof v === 'string' && v.trim() ? v : '—'}
                </div>
              ) : (
                <textarea
                  class="field q-field"
                  rows={2}
                  placeholder={t('form.your_answer')}
                  aria-label={q.text}
                  value={typeof v === 'string' ? v : ''}
                  disabled={sending}
                  onInput={(e) => set(q, (e.target as HTMLTextAreaElement).value)}
                  data-testid={`devreply.form.text.${q.id}`}
                />
              )
            ) : (
              <div class={`choices ${done ? 'answered' : ''}`} role={q.kind === 'single' ? 'radiogroup' : 'group'} aria-label={q.text}>
                {q.options.map((o) => {
                  const on = q.kind === 'single' ? v === o.id : Array.isArray(v) && v.includes(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={q.kind === 'single' ? 'radio' : 'checkbox'}
                      aria-checked={on}
                      class={`choice ${on ? 'chosen' : ''}`}
                      disabled={done || sending}
                      onClick={() => {
                        if (q.kind === 'single') set(q, o.id)
                        else {
                          const list = Array.isArray(v) ? v : []
                          set(q, on ? list.filter((x) => x !== o.id) : [...list, o.id])
                        }
                      }}
                      data-testid={`devreply.form.option.${q.id}.${o.id}`}
                    >
                      <span class={`choice-mark ${q.kind}`} aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span class="choice-label">{o.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {isMissing && (
              <span class="error" role="alert" data-testid={`devreply.form.required.${q.id}`}>
                {t('form.required')}
              </span>
            )}
          </fieldset>
        )
      })}
      {!done && (
        <>
          {error && (
            <span class="error" role="alert" data-testid="devreply.form.error">
              {error}
            </span>
          )}
          <button type="button" class="btn" disabled={sending} onClick={() => void send()} data-testid="devreply.form.send">
            {sending ? t('sending') : t('form.send')}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * A question with answer buttons (0.5.0): the question as a team bubble, the options under it. A tap
 * answers once; then the chosen one stays highlighted and the others go quiet. Typing works as always.
 */
function Buttons({
  block,
  answer,
  onAnswer,
  schemes,
}: {
  block: Extract<Block, { type: 'buttons' }>
  schemes: readonly string[]
  answer: string | null | undefined
  onAnswer: (option: ButtonOption) => void
}) {
  const answered = answer !== undefined
  return (
    <>
      <div class="bubble team md" data-testid="devreply.buttons.question">
        <Markdown text={block.text} schemes={schemes} />
      </div>
      <div class={`choices ${answered ? 'answered' : ''}`} role="group" aria-label={plainMarkdown(parseMarkdown(block.text))} data-testid="devreply.buttons">
        {block.options.map((o) => {
          const chosen = answered && o.id === answer
          return (
            <button
              key={o.id}
              type="button"
              class={`choice ${chosen ? 'chosen' : ''}`}
              disabled={answered}
              aria-pressed={answered ? chosen : undefined}
              onClick={() => onAnswer(o)}
              data-testid={`devreply.buttons.option.${o.id}`}
            >
              <span class="choice-label">{o.label}</span>
              {chosen && (
                <span class="choice-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
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
        <span class="kicker">{item.attachments.length ? t('uploading') : t('sending')}</span>
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
function Notice({ config, email }: { config: Config; email: string | null }) {
  return (
    <div class="notice" data-testid="devreply.notice">
      <Avatar name={config.teamName} size={36} url={config.appIconUrl} />
      <div>
        <b>{t('notice.title')}</b>
        <p>
          {replyAllow(config)} {email ? t('notice.email', { email }) : t('notice.here')}
        </p>
      </div>
    </div>
  )
}

/**
 * Until the profile arrives (0.5.1): a loading line, then why it can't load, with Try again. The store
 * keeps retrying meanwhile; whichever arrives first brings the name form or the composer.
 */
function ProfileWait({ error }: { error: DevReplyError | null }) {
  if (!error)
    return (
      <div class="wait" aria-busy="true" data-testid="devreply.profile.loading">
        <span class="wait-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    )
  return (
    <div class="wait" role="alert" data-testid="devreply.profile.error">
      <span class="error">
        {error.kind === 'network'
          ? t('error.offline')
          : error.kind === 'invalidKey' || error.kind === 'forbidden'
            ? t('error.key')
            : t('error.generic')}
      </span>
      <button type="button" class="link" onClick={() => void store.loadProfileIfNeeded(true)} data-testid="devreply.profile.retry">
        {t('try_again')}
      </button>
    </div>
  )
}

function errorText(e: unknown): string {
  if (e instanceof DevReplyError && e.kind === 'invalid') return e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.'
  return t('error.save')
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
        <span class="kicker inv">{t('name.kicker')}</span>
      </span>
      <span style={{ fontSize: 15, fontWeight: 500 }}>
        {t('name.text')}
      </span>
      <input
        ref={nameRef}
        class="field"
        placeholder={t('name.placeholder')}
        autocomplete="name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        data-testid="devreply.profile.name"
        aria-label={t('name.placeholder')}
      />
      <input
        class="field"
        type="email"
        placeholder={t('email.optional')}
        autocomplete="email"
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        data-testid="devreply.profile.email"
        aria-label={t('email.optional')}
      />
      {error && (
        <span class="error" role="alert">
          {error}
        </span>
      )}
      <button type="submit" class="btn" disabled={saving || !name.trim()} data-testid="devreply.profile.save">
        {saving ? t('saving') : t('name.start')}
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
        <span class="card-title">{t('email_ask.title')}</span>
        <button type="button" class="link" onClick={onDone} data-testid="devreply.emailask.skip">
          {t('no_thanks')}
        </button>
      </div>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{t('email_ask.text')}</span>
      <div class="card-row">
        <input
          class="field"
          type="email"
          placeholder="you@example.com"
          autocomplete="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          data-testid="devreply.emailask.field"
          aria-label={t('email_ask.placeholder')}
        />
        <button type="submit" class="btn" disabled={saving || !email.trim()} data-testid="devreply.emailask.save">
          {saving ? '…' : t('save')}
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

function Composer({
  autoFocus,
  initial,
  onSend,
}: {
  autoFocus: boolean
  initial: string
  onSend: (text: string, staged: Outgoing[]) => void
}) {
  const [draft, setDraft] = useState(initial)
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
    const t = ref.current
    if (!autoFocus || !t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length) // a prefilled draft: typing goes on at its end
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
        setPickError(t('too_big', { name: f.name }))
        continue
      }
      next.push({ kind: 'file', mime: f.type || 'application/octet-stream', data: f, filename: f.name })
    }
    setStaged((s) => {
      const all = [...s, ...next]
      if (all.length > 4) setPickError(t('too_many'))
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
              <button type="button" class="rm" aria-label={t('remove_attachment', { name: a.filename ?? t('photo') })} onClick={() => setStaged(staged.filter((x) => x !== a))}>
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      {pickError && <span class="error">{pickError}</span>}
      <div class="composer-row">
        <div class="attach">
          <button type="button" class="icon-btn" aria-label={t('attach')} aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="devreply.attach">
            <Icon name="attach" />
          </button>
          {menu && (
            <div class="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => (setMenu(false), photos.current?.click())}>
                <Icon name="photo" /> {t('photo')}
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), files.current?.click())}>
                <Icon name="file" /> {t('file')}
              </button>
            </div>
          )}
          <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => void add((e.target as HTMLInputElement).files)} data-testid="devreply.photos" />
          <input ref={files} type="file" multiple hidden onChange={(e) => void add((e.target as HTMLInputElement).files)} data-testid="devreply.files" />
        </div>
        <textarea
          ref={ref}
          rows={1}
          placeholder={t('composer.placeholder')}
          value={draft}
          aria-label={t('composer.label')}
          data-testid="devreply.composer"
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && enterSends && !e.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="button" class="send" aria-label={t('send')} disabled={!canSend} onClick={send} data-testid="devreply.send">
          <Icon name="send" />
        </button>
      </div>
    </div>
  )
}
