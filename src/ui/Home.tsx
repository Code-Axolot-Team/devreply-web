import { useEffect } from 'preact/hooks'
import { store } from '../store'
import { t } from '../i18n'
import { Avatar, CategoryIcon, IconButton, buttonTitle, greeting, intro, relative, replyTime, useStore } from './parts'

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
          <Avatar name={c.teamName} size={40} url={c.appIconUrl} />
          <span class="kicker inv" style={{ flex: 'none' }}>
            {c.teamName || t('chat')}
          </span>
          <span style={{ flex: 1 }} />
          <IconButton icon="close" label={t('close')} onClick={() => store.close()} class="close" />
        </div>
        <h1 class="greeting">{greeting(c)}</h1>
        <p class="intro">{intro(c)}</p>
        {(replyTime(c) || c.team.length > 0) && (
          <div class="reply-line">
            {c.team.length > 0 && (
              <span class="faces" aria-label={`The team: ${c.team.map((p) => p.name).join(', ')}`} data-testid="devreply.team">
                {c.team.map((p) => (
                  <Avatar key={p.name} name={p.name} size={30} url={p.avatarUrl} />
                ))}
              </span>
            )}
            {replyTime(c) && (
              <span class="chip">
                <span class="dot" aria-hidden="true" />
                {replyTime(c)}
              </span>
            )}
          </div>
        )}
      </div>
      <div class="home-body">
        <h2 class="h2">{t('start_title')}</h2>
        <div class="tiles">
          {c.startButtons.map((b) => (
            <button
              type="button"
              class="tile"
              data-testid={`devreply.start.${b.category}`}
              onClick={() => store.push({ screen: 'chat', conversationId: null, category: b.category })}
            >
              <CategoryIcon category={b.category} />
              {buttonTitle(c, b)}
            </button>
          ))}
        </div>
        {conversations.length > 0 && <h2 class="h2">{t('your_conversations')}</h2>}
        {conversations.slice(0, 20).map((conv) => (
          <button
            type="button"
            class={`conv ${conv.status === 'closed' ? 'closed' : ''}`}
            onClick={() => store.push({ screen: 'chat', conversationId: conv.id, category: conv.category })}
          >
            <CategoryIcon category={conv.category} />
            <span class="conv-text">
              <span class="conv-top">
                <span class="kicker">{conv.lastAuthor === 'user' ? t('you') : c.teamName || t('team')}</span>
                {conv.status === 'closed' && <span class="resolved">{t('resolved')}</span>}
                <span class="when">{relative(conv.lastMessageAt)}</span>
              </span>
              <span class="conv-last" style={{ display: 'block' }}>
                {conv.lastText ?? ''}
              </span>
            </span>
            {conv.unread > 0 && (
              <span class="count" aria-label={t('a11y.unread', { count: conv.unread })}>
                {conv.unread}
              </span>
            )}
          </button>
        ))}
        {s.lastError && s.conversations.length === 0 && (
          <p class="error" role="alert">
            {s.lastError.kind === 'network'
              ? t('error.offline')
              : s.lastError.kind === 'invalidKey' || s.lastError.kind === 'forbidden'
                ? t('error.key')
                : t('error.generic')}{' '}
            <button type="button" class="link" onClick={() => void store.refresh()}>
              {t('try_again')}
            </button>
          </p>
        )}
        <p class="powered">
          <a href="https://devreply.com" target="_blank" rel="noopener">
            {t('powered')}
          </a>
        </p>
      </div>
    </div>
  )
}
