import { useEffect } from 'preact/hooks'
import { DEFAULT_TITLES } from '../api'
import { store } from '../store'
import { Avatar, CategoryIcon, IconButton, relative, useStore } from './parts'

/** Greeting, start buttons (they set the category), and the user's conversations. */
export function Home() {
  const s = useStore()
  const c = s.config
  // Back from a conversation: the list shows its latest message.
  useEffect(() => void store.refresh(), [])
  const conversations = [...s.conversations].sort((a, b) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0))
  return (
    <div class="home">
      <div class="home-head">
        <div class="home-top">
          <Avatar name={c.teamName} size={40} />
          <span class="kicker inv" style={{ flex: 'none' }}>
            {c.teamName || 'Chat'}
          </span>
          <span style={{ flex: 1 }} />
          <IconButton icon="close" label="Close" onClick={() => store.close()} class="close" />
        </div>
        <h1 class="greeting">{c.greeting}</h1>
        <p class="intro">{c.intro}</p>
        {c.replyTime && (
          <span class="chip">
            <span class="dot" aria-hidden="true" />
            {c.replyTime}
          </span>
        )}
      </div>
      <div class="home-body">
        <h2 class="h2">Start a conversation</h2>
        <div class="tiles">
          {c.startButtons.map((b) => (
            <button
              type="button"
              class="tile"
              data-testid={`devreply.start.${b.category}`}
              onClick={() => store.push({ screen: 'chat', conversationId: null, category: b.category })}
            >
              <CategoryIcon category={b.category} />
              {b.title || DEFAULT_TITLES[b.category]}
            </button>
          ))}
        </div>
        {conversations.length > 0 && <h2 class="h2">Your conversations</h2>}
        {conversations.slice(0, 20).map((conv) => (
          <button
            type="button"
            class={`conv ${conv.status === 'closed' ? 'closed' : ''}`}
            onClick={() => store.push({ screen: 'chat', conversationId: conv.id, category: conv.category })}
          >
            <CategoryIcon category={conv.category} />
            <span class="conv-text">
              <span class="conv-top">
                <span class="kicker">{conv.lastAuthor === 'user' ? 'You' : c.teamName || 'Team'}</span>
                {conv.status === 'closed' && <span class="resolved">✓ Resolved</span>}
                <span class="when">{relative(conv.lastMessageAt)}</span>
              </span>
              <span class="conv-last" style={{ display: 'block' }}>
                {conv.lastText ?? ''}
              </span>
            </span>
            {conv.unread > 0 && (
              <span class="count" aria-label={`${conv.unread} unread`}>
                {conv.unread}
              </span>
            )}
          </button>
        ))}
        {s.lastError && s.conversations.length === 0 && (
          <p class="error" role="alert">
            {s.lastError.kind === 'network'
              ? 'You seem to be offline.'
              : s.lastError.kind === 'invalidKey' || s.lastError.kind === 'forbidden'
                ? "This site's DevReply key isn't set up for it."
                : 'Something went wrong.'}{' '}
            <button type="button" class="link" onClick={() => void store.refresh()}>
              Try again
            </button>
          </p>
        )}
        <p class="powered">
          Powered by{' '}
          <a href="https://devreply.com" target="_blank" rel="noopener">
            DevReply
          </a>
        </p>
      </div>
    </div>
  )
}
