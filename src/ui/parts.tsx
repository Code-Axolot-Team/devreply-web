import { useEffect, useState } from 'preact/hooks'
import { icons, type IconName } from '../icons'
import type { Category } from '../api'
import { store } from '../store'

/** Re-renders when the store (or a model) changes. */
export function useSubscribe(source: { subscribe(fn: () => void): () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => source.subscribe(() => setTick((x) => x + 1)), [source])
}

export function useStore() {
  useSubscribe(store)
  return store
}

export function Icon({ name, class: cls = 'i' }: { name: IconName; class?: string }) {
  return <span class={cls} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />
}

export function CategoryIcon({ category, class: cls = 'cat' }: { category: Category | null; class?: string }) {
  return <Icon name={category ?? 'other'} class={cls} />
}

/** The team's avatar: initials on a square, ink outline. */
export function Avatar({ name, size, fill = '#fff' }: { name: string; size: number; fill?: string }) {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'DR'
  return (
    <span class="avatar" aria-hidden="true" style={{ width: size, height: size, background: fill, fontSize: Math.round(size * 0.4) }}>
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

export const PROMPTS: Record<Category, string> = {
  bug: 'What happened, and what did you expect instead? A screenshot helps a lot.',
  billing: "Tell us what's wrong with your purchase or subscription.",
  idea: 'What would make the app better for you?',
  question: 'What would you like to know?',
  other: 'How can we help?',
}

/** "2 minutes ago", "yesterday", like the mobile SDKs. */
export function relative(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
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
