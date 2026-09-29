# Changelog

Released versions stay supported: the API only grows, and every released version's requests are replayed
against the server on every change. The script tag (`/sdk/web/v0/`) always serves the latest 0.x.

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
