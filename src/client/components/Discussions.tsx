import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Hash, MessageCircle, Pin, Reply, Search, Send, Trash2, X } from 'lucide-react';
import { apiRequest } from '../api';
import type { SessionUser } from '../contracts';
import Modal from './Modal';

interface Channel { id: number; name: string; description: string; unread: number; lastMessageId: number }
interface Message { id: number; body: string; createdAt: string; authorId: number; authorName: string; authorRole: string; pinned: number; deleted: number; replyId: number | null; replyBody: string | null; replyAuthor: string | null; reactions: { emoji: string; count: number; mine: number }[] }
const reactions = [['👍', 'Like'], ['🎉', 'Celebrate'], ['❤️', 'Appreciate'], ['❓', 'Question']];
function Failure({ error }: { error: Error | null }) { return error ? <p className="form-error" role="alert">{error.message}</p> : null; }

function Conversation({ channel, user }: { channel: Channel; user: SessionUser }) {
  const client = useQueryClient();
  const [text, setText] = useState(''), [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(false), [reply, setReply] = useState<Message | null>(null), [removing, setRemoving] = useState<Message | null>(null);
  const [sent, setSent] = useState(false);
  const base = `/api/discussions/${channel.id}`;
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const messages = useInfiniteQuery({
    queryKey: ['discussion-messages', user.id, channel.id, query, pinned], initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: query, pinned: String(pinned) });
      if (pageParam) params.set('before', String(pageParam));
      return apiRequest<{ messages: Message[]; nextCursor: number | null }>(`${base}/messages?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: 5000,
  });
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['discussion-messages', user.id, channel.id] }), client.invalidateQueries({ queryKey: ['discussion-channels', user.id] })]);
  const send = useMutation({
    mutationFn: () => apiRequest(`${base}/messages`, { method: 'POST', body: { text, replyTo: reply?.id ?? null } }),
    onSuccess: async () => { setText(''); setReply(null); setSearch(''); setQuery(''); setPinned(false); setSent(true); await refresh(); },
  });
  const action = useMutation({
    mutationFn: ({ path, method = 'PUT', body }: { path: string; method?: string; body?: Record<string, unknown> }) => apiRequest(`${base}${path}`, { method, body }),
    onSuccess: async () => { setRemoving(null); await refresh(); },
  });
  const rows = [...(messages.data?.pages.flatMap((page) => page.messages) || [])].reverse();
  const staff = user.role !== 'student';
  // Never render cached conversation text when authorization or another fetch fails.
  if (messages.isError) return <div><Failure error={messages.error} /><button className="secondary-button" onClick={() => messages.refetch()}>Retry discussion</button></div>;
  return <section className="discussion-conversation" aria-label={`${channel.name} discussion`}>
    <header className="section-heading"><div><p className="overline">Group discussion</p><h3><Hash aria-hidden="true" /> {channel.name}</h3></div>{channel.unread > 0 && <button className="secondary-button" disabled={action.isPending} onClick={() => action.mutate({ path: '/read', body: { messageId: channel.lastMessageId } })}>Mark discussion read</button>}</header>
    <p className="view-intro">{channel.description || 'Ask questions, share ideas, and help your group.'} Students in this group and college faculty can participate.</p>
    <div className="discussion-toolbar"><label className="discovery-search"><Search aria-hidden="true" /><span className="sr-only">Search discussion</span><input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages or people…" /></label><button className={`secondary-button${pinned ? ' selected' : ''}`} aria-pressed={pinned} onClick={() => setPinned(!pinned)}><Pin size={16} /> Pinned</button></div>
    {(search || pinned) && <button className="inline-button" onClick={() => { setSearch(''); setQuery(''); setPinned(false); }}>Reset discussion filters</button>}
    <Failure error={action.error} />
    {messages.isPending && <p role="status">Loading messages…</p>}
    {messages.hasNextPage && <button className="secondary-button" disabled={messages.isFetchingNextPage} onClick={() => messages.fetchNextPage()}>{messages.isFetchingNextPage ? 'Loading…' : 'Load older messages'}</button>}
    {messages.isSuccess && !rows.length && <div className="empty-state"><MessageCircle /><h4>{search || pinned ? 'No matching messages' : 'Start the conversation'}</h4><p>{search || pinned ? 'Try another search or reset the filters.' : 'Share the first update or question with your group.'}</p></div>}
    <div className="discussion-messages" aria-label="Discussion messages">
      {rows.map((message) => <article key={message.id} className={`discussion-message${message.authorId === user.id ? ' own-message' : ''}`} aria-label={`Message by ${message.authorName}`}>
        <header><strong>{message.authorName}</strong><span>{message.authorRole}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>{Boolean(message.pinned) && <span className="discussion-pin"><Pin size={13} /> Pinned</span>}</header>
        {message.replyId && <blockquote><strong>{message.replyAuthor}</strong><p>{message.replyBody?.slice(0, 180)}</p></blockquote>}
        <p className="discussion-body">{message.body}</p>
        {!message.deleted && <div className="discussion-message-actions">
          {reactions.map(([emoji, label]) => { const reaction = message.reactions.find((item) => item.emoji === emoji); return <button key={emoji} className="reaction-button" aria-label={`${label} message`} aria-pressed={Boolean(reaction?.mine)} disabled={action.isPending} onClick={() => action.mutate({ path: `/messages/${message.id}/reactions`, body: { emoji, active: !reaction?.mine } })}>{emoji} <span>{reaction?.count || 0}</span></button>; })}
          <button className="inline-button" onClick={() => { setReply(message); setSent(false); }}><Reply size={15} />Reply</button>
          {staff && <button className="inline-button" disabled={action.isPending} onClick={() => action.mutate({ path: `/messages/${message.id}/pin`, body: { pinned: !message.pinned } })}><Pin size={15} />{message.pinned ? 'Unpin' : 'Pin'}</button>}
          {(staff || message.authorId === user.id) && <button className="icon-button" aria-label="Remove message" onClick={() => { action.reset(); setRemoving(message); }}><Trash2 size={15} /></button>}
        </div>}
      </article>)}
    </div>
    <form className="discussion-composer" onSubmit={(event) => { event.preventDefault(); if (text.trim() && !send.isPending) send.mutate(); }}>
      {reply && <div className="discussion-reply"><span>Replying to <strong>{reply.authorName}</strong><small>{reply.body.slice(0, 140)}</small></span><button type="button" className="icon-button" aria-label="Cancel reply" disabled={send.isPending} onClick={() => setReply(null)}><X /></button></div>}
      <label className="field"><span>Message your group</span><textarea value={text} maxLength={2000} rows={3} disabled={send.isPending} onChange={(event) => { setText(event.target.value); setSent(false); }} placeholder="Write a question or update…" /></label>
      <div className="discussion-send"><small>{text.length}/2000 · Updates every 5 seconds</small><button className="primary-button" disabled={!text.trim() || send.isPending}><Send size={16} />{send.isPending ? 'Sending…' : 'Send message'}</button></div>
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
