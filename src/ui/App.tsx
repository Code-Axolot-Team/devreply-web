import { useEffect, useRef, useState } from 'preact/hooks'
import { store } from '../store'
import { Chat } from './Chat'
import { Home } from './Home'
import { t } from '../i18n'
import { DarkLook, Icon, useStore } from './parts'

/**
 * The launcher (bottom right, with the unread count) and the messenger panel above it. On a phone the
 * panel takes the whole screen. The launcher shows always (`always`, the default on the web), only
 * while a reply is waiting (`unread`, like the mobile SDKs' bubble), or never (`none`: the site opens
 * the chat from its own button with `DevReply.open()`).
 */
/** Whether the browser prefers dark (`prefers-color-scheme`), following it live. */
function usePrefersDark(): boolean {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = () => setDark(query.matches)
    on()
    // Safari before 14 only has addListener.
    if (query.addEventListener) query.addEventListener('change', on)
    else query.addListener(on)
    return () => (query.removeEventListener ? query.removeEventListener('change', on) : query.removeListener(on))
  }, [])
  return dark
}

export function App() {
  const s = useStore()
  const prefersDark = usePrefersDark()
  // No dark theme (the default): light, whatever the browser prefers.
  const dark = prefersDark && s.theme.dark !== null
  const themeStyle = dark ? s.theme.dark! : s.theme.light
  const unread = s.unreadCount
  const team = s.config.teamName || t('team')
  // Switched off by the team: no launcher, whatever the mode.
  const showsLauncher = s.isAvailable && (s.launcher === 'always' || (s.launcher === 'unread' && (unread > 0 || s.isOpen)))
  const launcher = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const route = s.route[s.route.length - 1] ?? { screen: 'home' }

  // Opening moves focus into the panel; closing brings it back to the launcher.
  // Escape closes it, wherever focus is.
  useEffect(() => {
    if (!s.isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.isOpen])

  const wasOpen = useRef(false)
  useEffect(() => {
    if (s.isOpen && !wasOpen.current) panel.current?.querySelector<HTMLElement>('button, input, textarea')?.focus()
    if (!s.isOpen && wasOpen.current) launcher.current?.focus()
    wasOpen.current = s.isOpen
  }, [s.isOpen])

  const label = s.isOpen
    ? t('launcher.close')
    : unread === 1
      ? t('launcher.one', { team })
      : unread > 1
        ? t('launcher.many', { team, count: unread })
        : t('launcher.open', { team })

  return (
    <DarkLook.Provider value={dark}>
      <div class={`dr ${s.isOpen ? 'open' : ''}`} style={themeStyle} data-theme={dark ? 'dark' : 'light'} lang={s.language}>
        {s.isOpen && (
          <div
            ref={panel}
            class="panel"
            role="dialog"
            aria-label={`Chat with ${team}`}
            data-testid="devreply.panel"
          >
            {route.screen === 'home' ? (
              <Home />
            ) : (
              <Chat key={`${route.conversationId ?? 'new'}-${route.category ?? ''}`} conversationId={route.conversationId} category={route.category} />
            )}
          </div>
        )}
        {showsLauncher && (
          <button
            ref={launcher}
            type="button"
            class="launcher"
            aria-label={label}
            aria-expanded={s.isOpen}
            data-testid="devreply.launcher"
            onClick={() => {
              if (s.isOpen) store.close()
              else {
                // With a reply waiting, straight to it.
                const waiting = s.conversations.find((c) => c.unread > 0)
                store.open(waiting ? { screen: 'chat', conversationId: waiting.id, category: waiting.category } : undefined)
              }
            }}
          >
            {s.isOpen ? <Icon name="close" class="x" /> : <Icon name="mark" class="mark" />}
            {!s.isOpen && unread > 0 && (
              <span class="badge" aria-hidden="true">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        )}
      </div>
    </DarkLook.Provider>
  )
}
