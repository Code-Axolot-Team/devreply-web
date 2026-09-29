// The chat speaks the user's language (spec 05, "Languages"). Texts come from src/strings.ts, generated
// from sdk/conformance/strings/*.json; matching follows sdk/conformance/strings/locale-vectors.json,
// like the iOS and Android SDKs.
import { LANGUAGES, type Language, STRINGS, type StringKey } from './strings'

/** The best language we have for these preferred tags (the app's choice first, then the browser's). */
export function resolveLanguage(preferred: readonly string[]): Language {
  const known = new Map(LANGUAGES.map((l) => [l.toLowerCase(), l] as const))
  for (const raw of preferred) {
    const tag = raw.trim().replace(/_/g, '-').toLowerCase()
    if (!tag) continue
    const exact = known.get(tag)
    if (exact) return exact
    if (tag === 'pt' || tag.startsWith('pt-')) return 'pt-BR'
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hans'
    const base = known.get(tag.split('-')[0])
    if (base) return base
  }
  return 'en'
}

let override: string | null = null

/** The app's choice (`DevReply.setLocale`), or null to follow the browser. */
export function setLocaleOverride(tag: string | null) {
  override = tag && tag.trim() ? tag.trim() : null
}

export function localeTag(): string {
  if (override) return override
  if (typeof navigator === 'undefined') return 'en'
  return navigator.languages?.[0] ?? navigator.language ?? 'en'
}

export function language(): Language {
  const browser = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]
  return resolveLanguage(override ? [override, ...browser] : browser)
}

/** A text in the chat's language, with `{name}` placeholders filled in. */
export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  const text = STRINGS[language()][key] ?? STRINGS.en[key]
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/** For Intl formatters: the language we show (so dates match the texts). */
export function intlLocale(): string {
  const lang = language()
  return lang === 'en' ? localeTag() : lang
}
