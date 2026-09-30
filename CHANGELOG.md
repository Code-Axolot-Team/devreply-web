# Changelog

Released versions stay supported: the API only grows, and every released version's requests are replayed
against the server on every change. The script tag (`/sdk/web/v0/`) always serves the latest 0.x.

## 0.5.0

- Live updates: while the chat is open and the tab visible, new messages arrive over a WebSocket the moment they're
  sent (the 3 s poll runs only while it's down; reconnects with backoff and catches up on what it missed).
- Button replies: the team can ask a question with 2 to 5 answer buttons; a tap sends the label as the user's
  answer, the chosen one stays highlighted, and typing still works.
- Same device after logout: a random device key, kept in `localStorage` through `logout()`, goes with the
  install; signing back in with the same account on this browser brings the old conversations back.

- 34 languages (adds Arabic, Catalan, Croatian, Czech, Danish, Finnish, Hebrew, Hindi, Hungarian, Indonesian, Malay,
  Norwegian, European Portuguese, Romanian, Slovak, Swedish, Thai, Vietnamese, Traditional Chinese). Hebrew and Arabic
  lay the chat out right to left.
- `open(…, { askName: false })`: no name form while the messenger is open (e.g. from a failed payment); the chat
  goes straight to the composer. The email ask after the first message stays.
- Replies from the team and agents in Markdown (the `markdown` block, `min_sdk` 0.5.0): bold, italic, strike, code,
  links, headings, lists, code blocks and quotes, as page elements. Older versions show the plain-text fallback.
- The launcher wears DevReply's new logo: the "Tilt" star on a black circle with a pink shadow.

## 0.4.4

* `DevReply.open({ category, message, attributes })` (or `open('bug', { message, attributes })`; `present` is
  the same function): `message` prefills the new conversation's composer (never sent by itself), `attributes`
  go with that conversation as its context for the team. Returns `false` when DevReply isn't configured or the
  chat is switched off. `open()` and `open('bug')` work as before.
* The team can switch the chat off in the dashboard: `DevReply.isAvailable` turns false, `open` does nothing,
  the launcher hides, and an open chat closes. Everything else keeps working.
* `deleteUser()` never gives up: if DevReply can't be reached, the browser forgets the user at once (like
  `logout`) and the deletion is retried on every page load and whenever the tab comes back, with the old
  install's token only. `true`: deleted now; `false`: queued.
* Events for your analytics: `DevReply.on('open' | 'close' | 'conversationStarted' | 'messageSent', fn)`,
  returns a function that stops it.
* Dark mode, opt-in: `configure({ key, darkTheme })` with DevReply's "Deep blue" `darkTheme` preset (or your
  six colours: `primary`, `accent`, `userBubble`, `userBubbleText`, `background`, `ink`) is used whenever the
  browser prefers dark; every other colour, the icons included, follows. `DevReply.setTheme({ light, dark })`
  changes them at any time. Without a dark theme the chat looks exactly as before.

## 0.4.3

* Signed-in users: `DevReply.login(userId)` after sign-in (your own id for the user; the team sees it, your
  backend can delete the user by it), `DevReply.logout()` on every sign-out (the browser forgets the chat;
  the next person starts empty), `await DevReply.deleteUser()` in your delete-account flow (deletes the
  user's data, then logs out; `false` if DevReply couldn't be reached).

## 0.4.0

* Replies show who wrote them: the teammate's name, title and photo, once per group of replies.
* The app's icon in the chat's header; the team's faces on the chat's home.
* Links from DevReply's emails (`?devreply=<id>`) open the right conversation: `DevReply.handle(url)`.
* A refused public key waits 1 min, 5 min, 30 min, then 6 h before trying again.
* The chat speaks the user's language (15 languages, the browser's by default); `configure({ key, locale })`
  or `DevReply.setLocale('es')`. Latin Extended fonts load only when needed.

## 0.3.0 – 0.3.2

* The first releases: one script (or npm `@devreply/web`) with the chat in a shadow DOM (launcher, home
  with start buttons, conversations, photos and files, name first, optional email, "we got it"),
  `setUser`, `setAttributes`, `onUnreadChange`, launcher modes.
