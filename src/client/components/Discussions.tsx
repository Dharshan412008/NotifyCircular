import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Check, CheckCheck, Copy, Hash, MessageCircle, Pin, Reply, Search, Send, Star, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { io } from 'socket.io-client';
import { apiRequest } from '../api';
import type { SessionUser } from '../contracts';
import Modal from './Modal';

interface Channel { id: number; name: string; description: string; unread: number; lastMessageId: number }
interface Message {
  id: number;
  body: string;
  createdAt: string;
  authorId: number;
  authorName: string;
  authorRole: string;
  pinned: number;
  deleted: number;
  starred?: boolean;
  isRead?: boolean;
  replyId: number | null;
  replyBody: string | null;
  replyAuthor: string | null;
  reactions: { emoji: string; count: number; mine: number }[];
}

const reactions = [
  ['👍', 'Like'],
  ['❤️', 'Appreciate'],
  ['🔥', 'Fire'],
  ['🎉', 'Celebrate'],
  ['👏', 'Clap'],
  ['🚀', 'Rocket'],
  ['👀', 'Eyes'],
  ['❓', 'Question'],
];

const quickEmojis = ['😀', '👍', '❤️', '🔥', '🎉', '👏', '🚀', '👀', '💯', '📌'];

function Failure({ error }: { error: Error | null }) { return error ? <p className="form-error" role="alert">{error.message}</p> : null; }

function highlightText(text: string, query?: string) {
  if (!query || !query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, pIdx) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={pIdx} className="discussion-search-match">{part}</mark>
    ) : part
  );
}

function renderInlineFormats(str: string, highlight?: string) {
  const tokenRegex = /(https?:\/\/[^\s<]+|`[^`]+`|\*(?!\s)[^*]+?(?<!\s)\*|_(?!\s)[^_]+?(?<!\s)_|~(?!\s)[^~]+?(?<!\s)~|@[a-zA-Z0-9_.-]+)/g;
  const tokens = str.split(tokenRegex);

  return tokens.map((token, idx) => {
    if (!token) return null;
    if (token.startsWith('http://') || token.startsWith('https://')) {
      return (
        <a key={idx} href={token} target="_blank" rel="noopener noreferrer" className="discussion-link">
          {token}
        </a>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return <code key={idx} className="discussion-code">{token.slice(1, -1)}</code>;
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      return <strong key={idx}>{highlight ? highlightText(token.slice(1, -1), highlight) : token.slice(1, -1)}</strong>;
    }
    if (token.startsWith('_') && token.endsWith('_') && token.length > 2) {
      return <em key={idx}>{highlight ? highlightText(token.slice(1, -1), highlight) : token.slice(1, -1)}</em>;
    }
    if (token.startsWith('~') && token.endsWith('~') && token.length > 2) {
      return <del key={idx}>{highlight ? highlightText(token.slice(1, -1), highlight) : token.slice(1, -1)}</del>;
    }
    if (token.startsWith('@') && token.length > 1) {
      return <mark key={idx} className="discussion-mention">{token}</mark>;
    }
    return highlight ? <span key={idx}>{highlightText(token, highlight)}</span> : token;
  });
}

function FormattedBody({ text, highlight }: { text: string; highlight?: string }) {
  if (!text) return null;
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const blocks = text.split(codeBlockRegex);

  return (
    <span className="discussion-body">
      {blocks.map((block, bIdx) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const code = block.slice(3, -3).replace(/^\w+\n/, '');
          return (
            <pre key={bIdx} className="discussion-code-block">
              <code>{code}</code>
            </pre>
          );
        }
        return <span key={bIdx}>{renderInlineFormats(block, highlight)}</span>;
      })}
    </span>
  );
}

function playChatSound(type: 'sent' | 'received') {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'sent') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(560, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.setValueAtTime(750, now + 0.06);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.14);
    }
  } catch {
    // audio blocked or unsupported
  }
}

function Conversation({ channel, user }: { channel: Channel; user: SessionUser }) {
  const client = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(''), [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(false), [starred, setStarred] = useState(false);
  const [reply, setReply] = useState<Message | null>(null), [removing, setRemoving] = useState<Message | null>(null);
  const [sent, setSent] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('cr-chat-sounds') !== 'false'; } catch { return true; }
  });
  const [enterToSend, setEnterToSend] = useState(() => {
    try { return localStorage.getItem('cr-enter-to-send') === 'true'; } catch { return false; }
  });

  const base = `/api/discussions/${channel.id}`;
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);

  // Real-time Socket.IO sync for messages
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('discussion:changed', (data?: { groupId?: number }) => {
      if (!data?.groupId || data.groupId === channel.id) {
        if (soundEnabled) playChatSound('received');
        refresh();
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [channel.id, soundEnabled]);

  const messages = useInfiniteQuery({
    queryKey: ['discussion-messages', user.id, channel.id, query, pinned, starred], initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: query, pinned: String(pinned), starred: String(starred) });
      if (pageParam) params.set('before', String(pageParam));
      return apiRequest<{ messages: Message[]; nextCursor: number | null }>(`${base}/messages?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: 5000,
  });

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['discussion-messages', user.id, channel.id] }), client.invalidateQueries({ queryKey: ['discussion-channels', user.id] })]);

  const send = useMutation({
    mutationFn: () => apiRequest(`${base}/messages`, { method: 'POST', body: { text, replyTo: reply?.id ?? null } }),
    onSuccess: async () => {
      if (soundEnabled) playChatSound('sent');
      setText(''); setReply(null); setSearch(''); setQuery(''); setPinned(false); setStarred(false); setSent(true); await refresh();
    },
  });

  const action = useMutation({
    mutationFn: ({ path, method = 'PUT', body }: { path: string; method?: string; body?: Record<string, unknown> }) => apiRequest(`${base}${path}`, { method, body }),
    onSuccess: async () => { setRemoving(null); await refresh(); },
  });

  // Automatically mark discussion read when opening an unread channel
  useEffect(() => {
    if (channel.unread > 0 && channel.lastMessageId > 0) {
      action.mutate({ path: '/read', body: { messageId: channel.lastMessageId } });
    }
  }, [channel.id]);

  function insertFormatting(prefix: string, suffix: string = prefix) {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + prefix + suffix);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.substring(start, end) || 'text';
    const next = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = text.substring(0, start) + emoji + text.substring(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  function toggleEnterToSend() {
    setEnterToSend((prev) => {
      const next = !prev;
      try { localStorage.setItem('cr-enter-to-send', String(next)); } catch {}
      return next;
    });
  }

  function toggleSounds() {
    setSoundEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem('cr-chat-sounds', String(next)); } catch {}
      return next;
    });
  }

  async function copyMessage(message: Message) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.body);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = message.body;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((curr) => (curr === message.id ? null : curr)), 2000);
    } catch {
      // safe fallback
    }
  }

  const rows = [...(messages.data?.pages.flatMap((page) => page.messages) || [])].reverse();
  const staff = user.role !== 'student';

  if (messages.isError) return <div><Failure error={messages.error} /><button className="secondary-button" onClick={() => messages.refetch()}>Retry discussion</button></div>;

  return <section className="discussion-conversation" aria-label={`${channel.name} discussion`}>
    <header className="section-heading">
      <div><p className="overline">Group discussion</p><h3><Hash aria-hidden="true" /> {channel.name}</h3></div>
      {channel.unread > 0 && <button className="secondary-button" disabled={action.isPending} onClick={() => action.mutate({ path: '/read', body: { messageId: channel.lastMessageId } })}>Mark discussion read</button>}
    </header>
    <p className="view-intro">{channel.description || 'Ask questions, share ideas, and help your group.'} Students in this group and college faculty can participate.</p>
    <div className="discussion-toolbar">
      <label className="discovery-search">
        <Search aria-hidden="true" /><span className="sr-only">Search discussion</span>
        <input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages or people…" />
      </label>
      <button className={`secondary-button${pinned ? ' selected' : ''}`} aria-pressed={pinned} onClick={() => { setPinned(!pinned); setStarred(false); }}>
        <Pin size={16} /> Pinned
      </button>
      <button className={`secondary-button${starred ? ' selected' : ''}`} aria-pressed={starred} onClick={() => { setStarred(!starred); setPinned(false); }}>
        <Star size={16} fill={starred ? 'currentColor' : 'none'} /> Starred
      </button>
      <button
        type="button"
        className={`secondary-button${soundEnabled ? ' selected' : ''}`}
        aria-pressed={soundEnabled}
        aria-label={soundEnabled ? 'Mute sound alerts' : 'Enable sound alerts'}
        title={soundEnabled ? 'Sound alerts on' : 'Sound alerts muted'}
        onClick={toggleSounds}
      >
        {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />} {soundEnabled ? 'Sounds' : 'Muted'}
      </button>
    </div>
    {(search || pinned || starred) && <button className="inline-button" onClick={() => { setSearch(''); setQuery(''); setPinned(false); setStarred(false); }}>Reset discussion filters</button>}
    {rows.some((m) => Boolean(m.pinned)) && !pinned && !starred && !query && (
      <div className="pinned-announcements-bar" role="status">
        <span><Pin size={14} /> <strong>{rows.filter((m) => Boolean(m.pinned)).length} pinned notice(s)</strong> in this discussion</span>
        <button type="button" className="inline-button" onClick={() => { setPinned(true); setStarred(false); }}>View pinned</button>
      </div>
    )}
    <Failure error={action.error} />
    {messages.isPending && <p role="status">Loading messages…</p>}
    {messages.hasNextPage && <button className="secondary-button" disabled={messages.isFetchingNextPage} onClick={() => messages.fetchNextPage()}>{messages.isFetchingNextPage ? 'Loading…' : 'Load older messages'}</button>}
    {messages.isSuccess && !rows.length && <div className="empty-state"><MessageCircle /><h4>{search || pinned || starred ? 'No matching messages' : 'Start the conversation'}</h4><p>{search || pinned || starred ? 'Try another search or reset the filters.' : 'Share the first update or question with your group.'}</p></div>}
    <div className="discussion-messages" aria-label="Discussion messages">
      {rows.map((message) => <article key={message.id} className={`discussion-message${message.authorId === user.id ? ' own-message' : ''}`} aria-label={`Message by ${message.authorName}`}>
        <header>
          <strong>{message.authorName}</strong>
          <span>{message.authorRole}</span>
          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          {Boolean(message.pinned) && <span className="discussion-pin"><Pin size={13} /> Pinned</span>}
          {Boolean(message.starred) && <span className="discussion-star-badge" title="Starred"><Star size={13} fill="currentColor" /> Starred</span>}
          {message.authorId === user.id && (
            <span className={`message-status ${message.isRead ? 'read' : 'sent'}`} title={message.isRead ? 'Seen by group members' : 'Sent'}>
              {message.isRead ? <CheckCheck size={14} aria-label="Seen by group" /> : <Check size={14} aria-label="Sent" />}
            </span>
          )}
        </header>
        {message.replyId && <blockquote><strong>{message.replyAuthor}</strong><p>{message.replyBody?.slice(0, 180)}</p></blockquote>}
        <FormattedBody text={message.body} highlight={query} />
        {!message.deleted && <div className="discussion-message-actions">
          {reactions.map(([emoji, label]) => {
            const reaction = message.reactions.find((item) => item.emoji === emoji);
            return <button key={emoji} className="reaction-button" aria-label={`${label} message`} aria-pressed={Boolean(reaction?.mine)} disabled={action.isPending} onClick={() => action.mutate({ path: `/messages/${message.id}/reactions`, body: { emoji, active: !reaction?.mine } })}>{emoji} <span>{reaction?.count || 0}</span></button>;
          })}
          <button className="inline-button" onClick={() => { setReply(message); setSent(false); }}><Reply size={15} />Reply</button>
          <button
            className={`icon-button star-button${message.starred ? ' starred' : ''}`}
            aria-label={message.starred ? 'Unstar message' : 'Star message'}
            title={message.starred ? 'Unstar message' : 'Star message'}
            disabled={action.isPending}
            onClick={() => action.mutate({ path: `/messages/${message.id}/star`, body: { starred: !message.starred } })}
          >
            <Star size={15} fill={message.starred ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-button" aria-label="Copy message text" title="Copy text" onClick={() => copyMessage(message)}>
            <Copy size={15} />
          </button>
          {copiedId === message.id && <span className="copy-feedback">Copied!</span>}
          {staff && <button className="inline-button" disabled={action.isPending} onClick={() => action.mutate({ path: `/messages/${message.id}/pin`, body: { pinned: !message.pinned } })}><Pin size={15} />{message.pinned ? 'Unpin' : 'Pin'}</button>}
          {(staff || message.authorId === user.id) && <button className="icon-button" aria-label="Remove message" onClick={() => { action.reset(); setRemoving(message); }}><Trash2 size={15} /></button>}
        </div>}
      </article>)}
    </div>
    <form className="discussion-composer" onSubmit={(event) => { event.preventDefault(); if (text.trim() && !send.isPending) send.mutate(); }}>
      {reply && <div className="discussion-reply"><span>Replying to <strong>{reply.authorName}</strong><small>{reply.body.slice(0, 140)}</small></span><button type="button" className="icon-button" aria-label="Cancel reply" disabled={send.isPending} onClick={() => setReply(null)}><X /></button></div>}
      <div className="discussion-format-toolbar">
        <div className="format-group">
          <button type="button" className="format-btn" title="Bold (*text*)" onClick={() => insertFormatting('*')}><strong>B</strong></button>
          <button type="button" className="format-btn" title="Italic (_text_)" onClick={() => insertFormatting('_')}><em>I</em></button>
          <button type="button" className="format-btn" title="Strikethrough (~text~)" onClick={() => insertFormatting('~')}><del>S</del></button>
          <button type="button" className="format-btn" title="Inline code (`code`)" onClick={() => insertFormatting('`')}><code>&lt;/&gt;</code></button>
        </div>
        <div className="emoji-quick-bar">
          {quickEmojis.map((emoji) => (
            <button key={emoji} type="button" className="emoji-quick-btn" title={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Message your group</span>
        <textarea
          ref={textareaRef}
          aria-label="Message your group"
          value={text}
          maxLength={2000}
          rows={3}
          disabled={send.isPending}
          onChange={(event) => { setText(event.target.value); setSent(false); }}
          onKeyDown={(event) => {
            if (enterToSend && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (text.trim() && !send.isPending) send.mutate();
            }
          }}
          placeholder="Write a message… (Use *bold*, _italic_, ~strike~, `code`)"
        />
      </label>
      <div className="discussion-send">
        <div className="format-group">
          <small>{text.length}/2000 · Live sync active</small>
          <label className="enter-send-toggle">
            <input type="checkbox" checked={enterToSend} onChange={toggleEnterToSend} />
            <span>Enter to send</span>
          </label>
        </div>
        <button className="primary-button" disabled={!text.trim() || send.isPending}>
          <Send size={16} />{send.isPending ? 'Sending…' : 'Send message'}
        </button>
      </div>
      <Failure error={send.error} />{sent && <p className="form-success" role="status">Message sent to your group.</p>}
    </form>
    <Modal open={Boolean(removing)} title="Remove this message?" dismissible={!action.isPending} onClose={() => setRemoving(null)}><p>The message text and its reactions will be removed. Replies will show “Message removed”.</p><Failure error={action.error} /><button className="primary-button" disabled={action.isPending} onClick={() => removing && action.mutate({ path: `/messages/${removing.id}`, method: 'DELETE' })}>Remove message permanently</button></Modal>
  </section>;
}

export default function Discussions({ user }: { user: SessionUser }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const channels = useQuery({ queryKey: ['discussion-channels', user.id], queryFn: ({ signal }) => apiRequest<{ channels: Channel[] }>('/api/discussions', { signal }), refetchInterval: 5000 });
  const all = channels.data?.channels || [];
  const selectedId = params.get('channel');
  const selected = selectedId ? all.find((channel) => String(channel.id) === selectedId) : all[0];
  if (channels.isError) return <div><Failure error={channels.error} /><button className="secondary-button" onClick={() => channels.refetch()}>Retry channels</button></div>;
  return <section className="tab-view"><div className="section-heading"><div><p className="overline">Keep your campus connected</p><h3>Discussions</h3></div><MessageCircle /></div><p className="view-intro">Group conversations, replies and reactions. Official circulars remain in your inbox.</p>
    {channels.isPending ? <p role="status">Loading your groups…</p> : <div className="discussions-layout">
      <aside className="discussion-channels" aria-label="Discussion channels"><label className="discovery-search"><Search aria-hidden="true" /><span className="sr-only">Find a discussion group</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a group…" /></label>
        {all.filter((channel) => channel.name.toLowerCase().includes(filter.trim().toLowerCase())).map((channel) => <button key={channel.id} className={`discussion-channel${selected?.id === channel.id ? ' active' : ''}`} aria-pressed={selected?.id === channel.id} onClick={() => setParams({ channel: String(channel.id) })}><Hash size={16} /><span>{channel.name}</span>{channel.unread > 0 && <strong aria-label={`${channel.unread} unread messages`}>{channel.unread > 99 ? '99+' : channel.unread}</strong>}</button>)}
        {all.length === 0 && <p>You have no discussion groups yet.</p>}
        {all.length > 0 && !all.some((channel) => channel.name.toLowerCase().includes(filter.trim().toLowerCase())) && <p>No groups match your search.</p>}
      </aside>
      {selected ? <Conversation key={selected.id} channel={selected} user={user} /> : <p role="status">Choose an available group to open its discussion.</p>}
    </div>}
  </section>;
}
