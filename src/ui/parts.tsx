import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { icons, iconsDark, type IconName } from '../icons'
import type { Category, Config, StartButton } from '../api'
import { intlLocale, t } from '../i18n'
import type { StringKey } from '../strings'
import { store } from '../store'

/** Re-renders when the store (or a model) changes. */
export function useSubscribe(source: { subscribe(fn: () => void): () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const stop = source.subscribe(() => setTick((x) => x + 1))
    setTick((x) => x + 1) // a change between the first render and now (e.g. setTheme on devreply:ready)
    return stop
  }, [source])
}

export function useStore() {
  useSubscribe(store)
  return store
}

/** True while the chat shows its dark look (a dark theme is set and the browser prefers dark). */
export const DarkLook = createContext(false)

export function Icon({ name, class: cls = 'i' }: { name: IconName; class?: string }) {
  return <span class={cls} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />
}

/** The category's artwork, drawn for the light or the dark look. */
export function CategoryIcon({ category, class: cls = 'cat' }: { category: Category | null; class?: string }) {
  const c = category ?? 'other'
  const svg = useContext(DarkLook) ? iconsDark[c] : icons[c]
  return <span class={cls} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** A square face with an ink outline: the photo (app icon, persona) or initials. */
export function Avatar({ name, size, fill = 'var(--dr-surface)', url }: { name: string; size: number; fill?: string; url?: string | null }) {
  if (url) {
    return <img class="avatar" src={url} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />
  }
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'DR'
  return (
    <span class={`avatar ${fill === 'var(--dr-lemon)' ? 'on-lemon' : ''}`} aria-hidden="true" style={{ width: size, height: size, background: fill, fontSize: Math.round(size * 0.4) }}>
      {initials}
    </span>
  )
}

export function IconButton({ icon, label, onClick, class: cls = '' }: { icon: IconName; label: string; onClick: () => void; class?: string }) {
  return (
    <button type="button" class={`icon-btn ${cls}`} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

/** The empty chat's question for each kind of request. */
export const prompt = (c: Category) => t(`prompt.${c}` as StringKey)

// Texts the server sends: in the user's language while they're DevReply's defaults (`localize`),
// as written when the team wrote their own.
const localized = (c: Config, field: string) => c.localize.includes(field)
export const greeting = (c: Config) => (localized(c, 'greeting') ? t('greeting') : c.greeting)
export const intro = (c: Config) => (localized(c, 'intro') ? t('intro') : c.intro)
export const buttonTitle = (c: Config, b: StartButton) =>
  localized(c, 'start_buttons') ? t(`category.${b.category}` as StringKey) : b.title
export const categoryTitle = (c: Config, cat: Category) => {
  const b = c.startButtons.find((x) => x.category === cat)
  return b ? buttonTitle(c, b) : t(`category.${cat}` as StringKey)
}
const knownTime = (k: string | null) => k !== null && ['hour', 'hours', 'day', '2_days', '3_working_days', 'week'].includes(k)
/** "Usually replies within 3 working days", in the user's language. */
export const replyTime = (c: Config) => (knownTime(c.replyWithinKey) ? t(`reply_time.${c.replyWithinKey}` as StringKey) : c.replyTime)
/** "Please allow up to 3 working days for a reply.", in the user's language. */
export const replyAllow = (c: Config) =>
  knownTime(c.replyWithinKey) ? t(`reply_allow.${c.replyWithinKey}` as StringKey) : `Please allow up to ${c.replyWithin} for a reply.`

/** "2 minutes ago", "yesterday", like the mobile SDKs. */
export function relative(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' })
  if (s < 60) return rtf.format(0, 'second') === 'now' ? 'now' : rtf.format(-s, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

export function fileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
