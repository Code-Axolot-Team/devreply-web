import type { ComponentChildren } from 'preact'
import { isSafeUrl, parseMarkdown, type MdBlock, type MdSpan } from '../markdown'

// A team reply in DevReply Markdown (0.5.0), as elements: never an HTML string. Line breaks inside a
// paragraph stay (the bubble keeps white space). Links open in a new tab, http(s) and mailto only.

function Span({ span }: { span: MdSpan }) {
  let node: ComponentChildren = span.text
  if (span.code) node = <code>{node}</code>
  if (span.strike) node = <s>{node}</s>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong>{node}</strong>
  return <>{node}</>
}

/** Spans, with neighbours that share a link joined into one `<a>`. */
function Spans({ spans }: { spans: MdSpan[] }) {
  const out: ComponentChildren[] = []
  for (let k = 0; k < spans.length; ) {
    const link = spans[k].link
    if (link && isSafeUrl(link)) {
      const first = k
      const run: MdSpan[] = []
      while (k < spans.length && spans[k].link === link) run.push(spans[k++])
      out.push(
        <a key={first} href={link} target="_blank" rel="noopener noreferrer">
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

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{<Spans spans={block.spans} />}</p>
    case 'heading':
      return <p class="md-h" role="heading" aria-level={3}>{<Spans spans={block.spans} />}</p>
    case 'quote':
      return <blockquote>{<Spans spans={block.spans} />}</blockquote>
    case 'code':
      return (
        <pre dir="ltr">
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map((it, i) => (
        <li key={i}>
          <Spans spans={it} />
        </li>
      ))
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>
    }
  }
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  )
}
