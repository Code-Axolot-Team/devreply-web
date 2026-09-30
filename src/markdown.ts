// DevReply Markdown (spec 05, "Markdown in team messages"): the small subset team and agent replies are
// written in, parsed to the same tree on every platform. A port of sdk/conformance/markdown/reference.py
// (the rules are at its top); tests/markdown.test.mjs runs every case in cases.json. No dependencies, no
// HTML: the tree is rendered as elements, never as an HTML string. The dashboard imports this file too.

/** A run of text and the marks that are on (only those that are on are present). */
export interface MdSpan {
  text: string
  bold?: true
  italic?: true
  strike?: true
  code?: true
  /** http(s) or mailto only. */
  link?: string
}

export type MdBlock =
  | { type: 'paragraph' | 'heading' | 'quote'; spans: MdSpan[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdSpan[][] }
  | { type: 'code'; text: string }

type Marks = Omit<MdSpan, 'text'>

const ESCAPABLE = '\\`*_~[]()#>!+-.'
const SCHEMES = ['http://', 'https://', 'mailto:']

/** The only URLs a link may have: http, https and mailto. Renderers check it again. */
export const isSafeUrl = (url: string): boolean => SCHEMES.some((s) => url.startsWith(s))

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/u.test(c)
const isAlnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

function findCloser(s: string, i: number, tok: string): number {
  const n = tok.length
  let k = s.indexOf(tok, i + n)
  while (k !== -1) {
    let ok = k > i + n && !isSpace(s[k - 1])
    if (ok && n === 1) ok = s[k - 1] !== tok && (k + 1 >= s.length || s[k + 1] !== tok)
    if (ok && tok[0] === '_') ok = k + n >= s.length || !isAlnum(s[k + n])
    if (ok) return k
    k = s.indexOf(tok, k + 1)
  }
  return -1
}

const EMPHASIS: [string, (keyof Marks)[]][] = [
  ['***', ['bold', 'italic']],
  ['**', ['bold']],
  ['__', ['bold']],
  ['~~', ['strike']],
  ['*', ['italic']],
  ['_', ['italic']],
]

/** Inline Markdown to spans, left to right (reference.py `inline`). */
export function parseInline(s: string, marks: Marks = {}): MdSpan[] {
  const out: MdSpan[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      out.push({ ...marks, text: buf })
      buf = ''
    }
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const k = s.indexOf('`', i + 1)
      if (k !== -1) {
        flush()
        out.push({ ...marks, text: s.slice(i + 1, k), code: true })
        i = k + 1
        continue
      }
    }
    if (c === '[') {
      const close = s.indexOf('](', i + 1)
      const end = close !== -1 ? s.indexOf(')', close + 2) : -1
      if (close !== -1 && end !== -1 && !s.slice(close + 2, end).includes(' ') && close > i + 1) {
        const url = s.slice(close + 2, end)
        flush()
        const inner: Marks = { ...marks }
        if (isSafeUrl(url)) inner.link = url
        out.push(...parseInline(s.slice(i + 1, close), inner))
        i = end + 1
        continue
      }
    }
    if (c === 'h' && (s.startsWith('http://', i) || s.startsWith('https://', i)) && (i === 0 || isSpace(s[i - 1]) || s[i - 1] === '(')) {
      const url = (/^\S+/u.exec(s.slice(i))?.[0] ?? '').replace(/[.,;:!?)]+$/, '')
      if (url.length > 'https://'.length) {
        flush()
        out.push({ ...marks, text: url, link: url })
        i += url.length
        continue
      }
    }
    let handled = false
    for (const [tok, add] of EMPHASIS) {
      if (!s.startsWith(tok, i)) continue
      const n = tok.length
      if (i + n >= s.length || isSpace(s[i + n])) break
      if (tok[0] === '_' && i > 0 && isAlnum(s[i - 1])) break
      const k = findCloser(s, i, tok)
      if (k === -1) break
      flush()
      const inner: Marks = { ...marks }
      for (const a of add) (inner as Record<string, unknown>)[a] = true
      out.push(...parseInline(s.slice(i + n, k), inner))
      i = k + n
      handled = true
      break
    }
    if (handled) continue
    // A run of marker characters that opened nothing stays literal as a whole.
    if (c === '*' || c === '_' || c === '~') {
      let j = i
      while (j < s.length && s[j] === c) j++
      buf += s.slice(i, j)
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return merge(out)
}

const sameMarks = (a: MdSpan, b: MdSpan) =>
  a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.link === b.link

/** Drops empty spans and marks that are off; joins neighbours with the same marks. */
function merge(spans: MdSpan[]): MdSpan[] {
  const res: MdSpan[] = []
  for (const sp of spans) {
    if (!sp.text) continue
    const clean: MdSpan = { text: sp.text }
    if (sp.bold) clean.bold = true
    if (sp.italic) clean.italic = true
    if (sp.strike) clean.strike = true
    if (sp.code) clean.code = true
    if (sp.link) clean.link = sp.link
    const last = res[res.length - 1]
    if (last && sameMarks(last, clean)) last.text += clean.text
    else res.push(clean)
  }
  return res
}

/** A number in any script's decimal digits ("3", "٣"), as Python's int() reads it. */
function digits(s: string): number {
  let n = 0
  for (const ch of s) {
    const v = ch.codePointAt(0)!
    let zero = v
    while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--
    n = n * 10 + ((v - zero) % 10)
  }
  return n
}

type Open =
  | { kind: 'paragraph' | 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[][] }

/** A message's Markdown to blocks, line by line (reference.py `parse`). */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let cur: Open | null = null

  const close = () => {
    if (!cur) return
    if (cur.kind === 'list') {
      blocks.push({ type: 'list', ordered: cur.ordered, start: cur.start, items: cur.items.map((item) => parseInline(item.join('\n'))) })
    } else {
      blocks.push({ type: cur.kind, spans: parseInline(cur.lines.join('\n')) })
    }
    cur = null
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const stripped = line.trim()
    if (!stripped) {
      close()
      i++
      continue
    }
    if (stripped.startsWith('```')) {
      close()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      blocks.push({ type: 'code', text: body.join('\n') })
      i++
      continue
    }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*$/su.exec(line)
    if (heading) {
      close()
      blocks.push({ type: 'heading', spans: parseInline(heading[2]) })
      i++
      continue
    }
    const quote = /^\s*>\s?(.*)$/su.exec(line)
    if (quote) {
      if (cur?.kind !== 'quote') {
        close()
        cur = { kind: 'quote', lines: [] }
      }
      ;(cur as { lines: string[] }).lines.push(quote[1].trim())
      i++
      continue
    }
    const bullet = /^\s?[-*+]\s+(.*)$/su.exec(line)
    const number = /^\s?(\p{Nd}{1,9})[.)]\s+(.*)$/su.exec(line)
    if (bullet || number) {
      const ordered = number !== null
      const text = (number ? number[2] : bullet![1]).trim()
      if (!(cur?.kind === 'list' && cur.ordered === ordered)) {
        close()
        cur = { kind: 'list', ordered, start: number ? digits(number[1]) : 1, items: [] }
      }
      ;(cur as { items: string[][] }).items.push([text])
      i++
      continue
    }
    if (cur?.kind === 'list' && (line.startsWith('  ') || line.startsWith('\t'))) {
      cur.items[cur.items.length - 1].push(stripped)
      i++
      continue
    }
    if (cur?.kind === 'paragraph') cur.lines.push(stripped)
    else {
      close()
      cur = { kind: 'paragraph', lines: [stripped] }
    }
    i++
  }
  close()
  return blocks
}

function spansPlain(spans: MdSpan[]): string {
  let out = ''
  let k = 0
  while (k < spans.length) {
    const link = spans[k].link
    if (link) {
      let text = ''
      while (k < spans.length && spans[k].link === link) text += spans[k++].text
      const shown = link.startsWith('mailto:') ? link.slice('mailto:'.length) : link
      out += text === link || text === shown ? text : `${text} (${shown})`
    } else {
      out += spans[k++].text
    }
  }
  return out
}

/** The plain text of a tree (what the server writes as the fallback; reference.py `plain`). */
export function plainMarkdown(blocks: MdBlock[]): string {
  return blocks
    .map((b) =>
      b.type === 'code'
        ? b.text
        : b.type === 'list'
          ? b.items.map((it, n) => (b.ordered ? `${b.start + n}. ` : '• ') + spansPlain(it)).join('\n')
          : spansPlain(b.spans),
    )
    .join('\n\n')
}
