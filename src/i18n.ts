// The chat speaks the user's language (spec 05, "Languages"). Texts come from src/strings.ts, generated
// from sdk/conformance/strings/*.json; matching follows sdk/conformance/strings/locale-vectors.json,
// like the iOS and Android SDKs.
import { LANGUAGES, type Language, RTL, STRINGS, type StringKey } from './strings'

/** The best language we have for these preferred tags (the app's choice first, then the browser's). */
export function resolveLanguage(preferred: readonly string[]): Language {
  const known = new Map(LANGUAGES.map((l) => [l.toLowerCase(), l] as const))
  for (const raw of preferred) {
    const tag = raw.trim().replace(/_/g, '-').toLowerCase()
    if (!tag) continue
    const exact = known.get(tag)
    if (exact) return exact
    const special = known.get(specialCase(tag))
    if (special) return special
    const base = known.get(tag.split('-')[0])
    if (base) return base
  }
  return 'en'
}

/** The cases a plain language match gets wrong (locale-vectors.json): Chinese by script, Portuguese by
 *  country, and the old codes some systems still send (iw, in, no). Lowercase in and out. */
function specialCase(tag: string): string {
  const [base, ...rest] = tag.split('-')
  const region = rest.find((s) => s.length === 2 || /^\d{3}$/.test(s))
  if (base === 'zh') {
    if (rest.includes('hant')) return 'zh-hant'
    if (rest.includes('hans')) return 'zh-hans'
    return region && ['tw', 'hk', 'mo'].includes(region) ? 'zh-hant' : 'zh-hans'
  }
  if (base === 'pt') return !region || region === 'br' ? 'pt-br' : 'pt-pt'
  return ({ iw: 'he', in: 'id', no: 'nb', nn: 'nb' } as Record<string, string>)[base] ?? ''
}

/** True when the chat's language is written right to left (Hebrew, Arabic). */
export function isRTL(): boolean {
  return RTL.includes(language())
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
