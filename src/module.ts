// The npm package: import DevReply from '@devreply/web'. Same API as the script tag's window.DevReply,
// no globals, safe to import during server rendering (it does nothing until configure() runs in a browser).
//
//   DevReply.configure({ key: 'pk_…' })
//   DevReply.open()
import { DevReply } from './core'

export default DevReply
export { DevReply }
export type { DevReplyApi, Options } from './core'
export type { Category } from './api'
export type { Attribute, LauncherMode } from './store'
export type { Theme } from './styles'
