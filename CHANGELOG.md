# Changelog

Released versions stay supported: the API only grows, and every released version's requests are replayed
against the server on every change. The script tag (`/sdk/web/v0/`) always serves the latest 0.x.

## 0.6.0

- Removed "Start a new conversation" from a conversation opened from a topic: the user keeps writing in the open
  conversation (or goes back). `open({ message })` from the app still starts a new one.

- Link buttons (the `links` block, `min_sdk` 0.6.0): a reply can carry 1 to 3 buttons under an optional Markdown
  intro. A click reports the tap (`POST /v1/conversations/{id}/taps`, for the team's stats and webhooks) and opens
  the link: https in a new tab (no opener), the app's own deep-link scheme (`link_schemes` in the messenger
  config) in place, so the app's deep-link handling does the rest. Any other scheme is never opened.
- Markdown links may use the app's own deep-link scheme too; other custom schemes stay plain text.
- Gifts (the `gift` block): a small wrapped-gift card with the title, one line and "Open gift", which tells the
  server (`POST /v1/gifts/{id}/opened`) and opens the gift's link by the same rule. After the expiry the button
  says "This gift has expired".
- Several questions in one reply (the `form` block): single choice, any number ("Pick any") and free text,
  sent together once with "Send answers"; a required question left open says so. Afterwards the form stays as a
  read-only record of the answers; answered on another device (409), it reloads and shows those.
- Offers: a promotional message carries an "Offer" label and "Don't send me offers" (`PATCH /v1/me
  {"no_promotions": true}`), then "You won't get offers. Undo". The profile tells the current choice.
- Older SDKs show these blocks' plain-text fallback.

## 0.5.1

- An unread reply comes first: with a team reply waiting, home shows it on top ("New reply from {team}" and its
  first words); a click opens that conversation.
- A start topic with an open conversation in it opens that conversation, with "Start a new conversation" one click
  away. `open({ category, message })`, and a topic tapped while an `open({ message })` draft waits, still start a
  new one.
- The message box always appears: until the profile (`GET /v1/me`) arrives the chat shows loading, then why it
  can't connect with Try again, and keeps retrying (2 s, 4 s… up to 30 s) while open. A failing profile no longer
  keeps the conversations off home.
- Network timeouts: every request gives up after 20 s (uploads after 60 s) and counts as offline, like the iOS and
  Android SDKs (`AbortSignal.timeout`, with a timer on older browsers).

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
