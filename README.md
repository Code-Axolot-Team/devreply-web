# DevReply for the web

The in-app chat between your web app's users and you, answered from the
[DevReply dashboard](https://app.devreply.com). One script, rendered in a shadow root: your site's CSS can't
reach it and it never touches yours.

```html
<script src="https://api.devreply.com/sdk/web/v0/devreply.js" data-key="pk_…" async></script>
```

`pk_…` is your app's web public key from the dashboard (Settings → Platforms → Web). It's public by design; set
your site's domain there so it only works on your site. Using a coding agent? Give it your app's setup guide from
the dashboard: it has your key and does this for you.

- A round button bottom right with the unread count (`data-launcher="always"`, the default), only while a reply
  waits (`"unread"`), or none (`"none"`: open it from your own link).
- Home with start buttons, the user's conversations, and the chat: photos and files, name first, optional email,
  "we got it" with your reply time. Full screen on phones, a panel on desktop.

## API

```js
window.addEventListener('devreply:ready', () => {
  DevReply.setUser({ name: 'Ana', email: 'ana@example.com' })
  DevReply.setAttributes({ plan: 'pro', trial: false })
  DevReply.onUnreadChange((count) => console.log(count))
})
DevReply.open()          // or open('bug')
DevReply.close()
DevReply.configure({ key: 'pk_…', launcher: 'unread', theme: { primary: '#F6EB37', accent: '#FF5FA2' } })
```

If your site sends a Content-Security-Policy: `script-src` and `font-src https://api.devreply.com`,
`connect-src https://api.devreply.com https://storage.googleapis.com`, `img-src https://storage.googleapis.com blob:`.

## Build and test

```sh
npm ci
npm run typecheck && npm run build        # dist/devreply.js + fonts
```

Live tests (Playwright; Chromium, WebKit, a phone profile) need a throwaway app's web key, and for the launcher
test a script that answers "Bubble test <nonce>" with "Founder reply <nonce>" from the dashboard API:

```sh
npx playwright install chromium webkit
DEVREPLY_TEST_PK=pk_… DEVREPLY_TEST_NONCE=1234 npx playwright test
```

`scripts/gen-icons.mjs` regenerates `src/icons.ts` from the iOS and Android artwork (maintainers, in the main repo).

## License

MIT, see [LICENSE](LICENSE). Fonts: SIL OFL (`fonts/OFL.txt`). Issues and ideas welcome: see [CONTRIBUTING](CONTRIBUTING.md).
