import type { ComponentChildren } from 'preact'
import { isSafeUrl, parseMarkdown, type MdBlock, type MdSpan } from '../markdown'

// A team reply in DevReply Markdown (0.5.0), as elements: never an HTML string. Line breaks inside a
// paragraph stay (the bubble keeps white space). Links open in a new tab, http(s) and mailto only; the
// app's own deep-link schemes (0.6.0) open in place, so the browser hands them to the app.

function Span({ span }: { span: MdSpan }) {
  let node: ComponentChildren = span.text
  if (span.code) node = <code>{node}</code>
  if (span.strike) node = <s>{node}</s>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong>{node}</strong>
  return <>{node}</>
}

/** Spans, with neighbours that share a link joined into one `<a>`. */
function Spans({ spans, schemes }: { spans: MdSpan[]; schemes: readonly string[] }) {
  const out: ComponentChildren[] = []
  for (let k = 0; k < spans.length; ) {
    const link = spans[k].link
    if (link && isSafeUrl(link, schemes)) {
      const first = k
      const run: MdSpan[] = []
      while (k < spans.length && spans[k].link === link) run.push(spans[k++])
      out.push(
        <a key={first} href={link} {...(isSafeUrl(link) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {run.map((s, j) => (
            <Span key={j} span={s} />
          ))}
        </a>,
      )
    } else {
      out.push(<Span key={k} span={spans[k]} />)
      k++
    }
  }
  return <>{out}</>
}

function Block({ block, schemes }: { block: MdBlock; schemes: readonly string[] }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{<Spans spans={block.spans} schemes={schemes} />}</p>
    case 'heading':
      return <p class="md-h" role="heading" aria-level={3}>{<Spans spans={block.spans} schemes={schemes} />}</p>
    case 'quote':
      return <blockquote>{<Spans spans={block.spans} schemes={schemes} />}</blockquote>
    case 'code':
      return (
        <pre dir="ltr">
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map((it, i) => (
        <li key={i}>
          <Spans spans={it} schemes={schemes} />
        </li>
      ))
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>
    }
  }
}

export function Markdown({ text, schemes = [] }: { text: string; schemes?: readonly string[] }) {
  return (
    <>
      {parseMarkdown(text, schemes).map((b, i) => (
        <Block key={i} block={b} schemes={schemes} />
      ))}
    </>
  )
}
