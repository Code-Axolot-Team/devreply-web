// DevReply for web apps (spec 05): the same chat as the iOS and Android SDKs, for a site. The script tag:
//
//   <script src="https://api.devreply.com/sdk/web/v0/devreply.js" data-key="pk_…" async></script>
//
// Then, from the site's own code (after the `devreply:ready` event, or whenever window.DevReply exists):
//   DevReply.open()                                  // or open('bug') straight into a new conversation
//   DevReply.setUser({ name: 'Ana', email: 'ana@example.com' })
//   DevReply.setAttributes({ plan: 'pro', trial: false })
//   DevReply.onUnreadChange((n) => …)
//
// Bundlers use the npm package instead (module.ts): import DevReply from '@devreply/web'.
// Everything renders in a shadow root: the site's CSS can't reach it, and it never touches the site's.

import { DevReply, type DevReplyApi, setFontsBase } from './core'
import type { LauncherMode } from './store'

const script = document.currentScript as HTMLScriptElement | null
// Where this script came from: the fonts sit next to it.
if (script?.src) setFontsBase(script.src.replace(/[^/]*$/, ''))

declare global {
  interface Window {
    DevReply?: DevReplyApi
  }
}

if (!window.DevReply) {
  window.DevReply = DevReply
  // <script … data-key="pk_…" data-launcher="unread">
  const key = script?.dataset.key
  if (key) {
    DevReply.configure({
      key,
      launcher: (script?.dataset.launcher as LauncherMode | undefined) ?? undefined,
      apiUrl: script?.dataset.api,
      appVersion: script?.dataset.appVersion,
      locale: script?.dataset.locale,
    })
  }
  window.dispatchEvent(new CustomEvent('devreply:ready'))
}
