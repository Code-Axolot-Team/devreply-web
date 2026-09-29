// A tiny static server for the test page and the built SDK (http://localhost:4455).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2' }
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = path === '/' ? 'tests/fixture/page.html' : path.startsWith('/dist/') ? path.slice(1) : join('tests/fixture', path)
  try {
    const body = await readFile(join(root, file))
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(4455)
