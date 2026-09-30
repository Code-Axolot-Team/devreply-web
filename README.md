# DevReply for the web

The in-app chat between your web app's users and you, answered from the
[DevReply dashboard](https://app.devreply.com). One script, rendered in a shadow root: your site's CSS can't
reach it and it never touches yours.

Two ways in, same chat, same API:

**npm** (Next.js, Vite, Remix, SvelteKit, Vue, Angular…):

```sh
npm install @devreply/web
```

```ts
import DevReply from '@devreply/web'

DevReply.configure({ key: 'pk_…' })   // once, in the browser (safe to import during server rendering)
DevReply.open()                       // from any button, or let the launcher do it
```

**Script tag** (any site, no build step):

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
- Each reply shows who wrote it (the teammate's name, title and photo), and the header shows your app icon.
- 34 languages (Hebrew and Arabic right to left), the browser's by default: `configure({ key, locale: 'es' })`, `data-locale="es"`, or
  `DevReply.setLocale('es')` at any time.
- Replies from email: DevReply's "Reply in the app" button opens your web app with `?devreply=<conversation>`, and
  the script opens that conversation (set your web app's address in the dashboard, the app → Settings).

## React

No wrapper needed: configure once, and keep the unread count in state if you show it.

```tsx
import DevReply from '@devreply/web'
import { useEffect, useState } from 'react'

DevReply.configure({ key: 'pk_…', launcher: 'unread' })

export function HelpButton() {
  const [unread, setUnread] = useState(0)
  useEffect(() => DevReply.onUnreadChange(setUnread), [])
  return <button onClick={() => DevReply.open()}>Help{unread > 0 ? ` (${unread})` : ''}</button>
}
```

In Next.js, call `configure` from a client component (`'use client'`) or a `useEffect`.

## API

```js
window.addEventListener('devreply:ready', () => {
  DevReply.setUser({ name: 'Ana', email: 'ana@example.com' })
  DevReply.setAttributes({ plan: 'pro', trial: false })
  DevReply.onUnreadChange((count) => console.log(count))
})
DevReply.open()          // or open('bug'); returns false if the chat is switched off
DevReply.open({ category: 'bug', message: 'Export fails', attributes: { screen: 'export', plan: 'pro' } })
DevReply.close()
DevReply.isAvailable     // false when not configured or the team switched the chat off in the dashboard
DevReply.on('conversationStarted', ({ conversationId, category }) => analytics.track('support_started'))
DevReply.login(userId)   // signed-in users: see below
DevReply.logout()
DevReply.deleteUser()    // Promise<boolean>: true deleted now, false queued (retried until done)
DevReply.handle(url)     // a DevReply link (?devreply=<id>) your router caught first: opens that conversation
DevReply.configure({ key: 'pk_…', launcher: 'unread', theme: { primary: '#F6EB37', accent: '#FF5FA2' } })
DevReply.configure({ key: 'pk_…', fonts: 'system' })   // no brand fonts loaded from api.devreply.com
```

### Open with a message and context

```js
DevReply.open({ category: 'bug', message: 'The export button does nothing', attributes: { screen: 'export', build: 412 } })
```

- `message` prefills the composer of the new conversation this opens (without a category: once the user picks a
  start button). It's never sent by itself: the user sees it and can edit it.
- `attributes` go with that new conversation only, as its context (the team sees them on the conversation, not on
  the user): at most 20, names of 1–40 letters, digits, `_ - .` or spaces, values text, number or true/false.
  Anything else is left out with a console warning. Existing conversations are left alone.
- `askName: false` skips "Before we start" (the name form) while the messenger is open, for a screen where one tap
  to the message matters more than a name, like a failed payment. The email ask after the first message stays.
- `open('bug', { message, attributes })` works too, and `DevReply.present(…)` is the same function (the name the
  iOS and Android SDKs use).

### Switched off from the dashboard

Your team can switch the chat off in the dashboard. Then `DevReply.isAvailable` is false, `open` returns
`false` and shows nothing, the launcher hides, and an open chat closes. Hide your own help button with it:

```js
helpButton.hidden = !DevReply.isAvailable
```

`isAvailable` is true before the first config arrives (the config is cached for the next page load).

### Events

```js
const stop = DevReply.on('messageSent', ({ conversationId }) => analytics.track('support_message'))
stop() // no more calls
```

`open` and `close` (the messenger appears or goes away, any way), `conversationStarted`
(`{ conversationId, category }`, once the server accepted it) and `messageSent` (`{ conversationId }`, every
message the server accepted, the first one too, right after `conversationStarted`).

### Colours and dark mode

```js
import DevReply, { darkTheme } from '@devreply/web'   // script tag: DevReply.darkTheme

DevReply.configure({ key: 'pk_…', theme: { primary: '#0A84FF', accent: '#FF9F0A' }, darkTheme })
DevReply.setTheme({ dark: { ...darkTheme, primary: '#7A3CFF' } })   // at any time; dark: null = always light
```

Six colours, for light and for dark, all optional: `primary` (the header and the prompt cards), `accent` (send,
start, save), `userBubble` and `userBubbleText` (the user's messages), `background` and `ink` (text). Everything
else is derived from them; other keys are ignored.

- **Light** looks exactly as it always has: the header and cards take `primary`, outlines, shadows and text on
  coloured buttons take `ink`.
- **Dark** (only with `darkTheme`, whenever the browser prefers dark, live): DevReply's "Deep blue" preset, or
  your colours over it. Cards and bubbles are 8 % of the way from `background` toward a half-and-half mix of
  `ink` and `primary`, secondary text 35 % of the way from `ink` to `background`; thin `ink` outlines; shadows darker than the page; text on `primary` and `accent` is black or white,
  whichever reads better. The launcher, the team tag and unread counts stay DevReply's lemon.

If your site sends a Content-Security-Policy: `script-src` and `font-src https://api.devreply.com`,
`connect-src https://api.devreply.com wss://api.devreply.com https://storage.googleapis.com` (`wss:` for live updates;
without it the chat still works, polling every 3 s),
`img-src https://api.devreply.com https://storage.googleapis.com blob:` (team photos and your app icon).

## Sign-in, sign-out and account deletion

If your app has accounts:

```js
DevReply.login(user.id)                // after sign-in: your own id for the user, never an email or a secret
DevReply.logout()                      // on every sign-out and account switch
const ok = await DevReply.deleteUser() // in your delete-account flow; true: deleted now, false: queued
```

- `login` labels the user for your team (the dashboard shows it as "User ID (your app)") and lets your backend
  delete them by it. It doesn't merge chats across browsers: the id isn't verified, so it never gives one browser
  another's conversations. If another id was signed in on this browser, DevReply logs out first.
- `logout` revokes this install and its push token; the browser forgets the chat and the next person starts empty.
  The conversations stay with your team.
- `deleteUser` deletes the user's name, email, attributes, conversations, messages and files, and the browser
  forgets the user. If DevReply can't be reached, the browser still forgets the user at once and the deletion
  waits in `localStorage` (the old install's token), retried on every page load and whenever the tab comes back
  until the server confirms. `true`: deleted now; `false`: queued.

Your backend can delete a user too, with a read-and-write secret key (never in an app):

```sh
curl -X DELETE "https://api.devreply.com/v1/project/users?user_id=<your id>" \
  -H "Authorization: Bearer $DEVREPLY_SECRET_KEY"
# {"deleted": 1}: every DevReply user with that id, on every device. ?id=<DevReply's user id> for one user.
```

Your team can also delete a user in the dashboard (the inbox's user panel → Delete user).

## Build and test

```sh
npm ci
npm run typecheck && npm run build        # dist/devreply.js + fonts (script tag), dist/esm + dist/types (npm)
```

Live tests (Playwright; Chromium, WebKit, a phone profile) need a throwaway app's web key, and for the launcher
test a script that answers "Bubble test <nonce>" with "Founder reply <nonce>" from the dashboard API:

```sh
npx playwright install chromium webkit
DEVREPLY_TEST_PK=pk_… DEVREPLY_TEST_NONCE=1234 npx playwright test
```

`tests/v044.spec.ts` runs without a key against a stubbed API (prefilled message and context, the on/off
switch, events, pending deletions, dark mode). `DEVREPLY_SHOTS=<folder>` saves its screenshots;
`DEVREPLY_BASELINE_DIST=<previous release's dist/>` checks light mode is pixel-identical to it. Units:
`node --test tests/*.test.mjs`.

`scripts/gen-icons.mjs` regenerates `src/icons.ts` from the iOS and Android artwork (maintainers, in the main repo).

## License

MIT, see [LICENSE](LICENSE). Fonts: SIL OFL (`fonts/OFL.txt`). Issues and ideas welcome: see [CONTRIBUTING](CONTRIBUTING.md).
