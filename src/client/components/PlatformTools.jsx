import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bell, Bookmark, Search, ArrowUpRight, CheckCheck, Paperclip, Pin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { apiRequest } from '../api.js';
import { profileSchema } from '../contracts.ts';
import Modal from './Modal.jsx';
import { ThemePreference } from './PortalThemeButton.jsx';
import DisplayPreferences from './DisplayPreferences';
import EventCalendar from './EventCalendar.jsx';

const dateLabel = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function Failure({ error }) { return error ? <p className="form-error" role="alert">{error.message}</p> : null; }

export function PortalTools({ user }) {
  const navigate = useNavigate(), client = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false), [notificationsOpen, setNotificationsOpen] = useState(false);
  const [input, setInput] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearch(input.trim()), 250); return () => clearTimeout(timer); }, [input]);
  useEffect(() => {
    const keydown = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen((open) => !open); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    const refresh = () => { for (const key of ['platform-notifications', 'platform-overview', 'platform-events', 'inbox', 'faculty-inbox', 'faculty-circulars', 'platform-circulars']) client.invalidateQueries({ queryKey: [key] }); };
    const campus = () => { client.invalidateQueries({ queryKey: ['campus-feed'] }); client.invalidateQueries({ queryKey: ['campus-comments'] }); refresh(); };
    socket.on('circular:new', refresh); socket.on('circular:created', refresh); socket.on('notification:changed', refresh); socket.on('campus:changed', campus);
    return () => socket.disconnect();
  }, [user.id, client]);
  const results = useQuery({ queryKey: ['platform-search', user.id, search], queryFn: ({ signal }) => apiRequest(`/api/platform/search?q=${encodeURIComponent(search)}`, { signal }), enabled: searchOpen && Boolean(search) });
  const notifications = useQuery({ queryKey: ['platform-notifications', user.id], queryFn: () => apiRequest('/api/platform/notifications'), refetchInterval: 30_000 });
  const update = useMutation({ mutationFn: ({ path = '/api/platform/notifications/read', method = 'POST', body = {} }) => apiRequest(path, { method, body }), onSuccess: () => client.invalidateQueries({ queryKey: ['platform-notifications'] }) });
  function openNotification(item) { update.mutate({ body: { id: item.id } }); setNotificationsOpen(false); navigate(item.href); }
  return <div className="platform-topbar-actions">
    <button className="icon-button command-trigger" aria-label="Search campus (Control K)" title="Search campus · Ctrl K" onClick={() => setSearchOpen(true)}><Search /><span className="command-hint">Search <kbd>⌘ K</kbd></span></button>
    <button className="icon-button notification-trigger" aria-label={`Notifications${notifications.data?.unread ? ` (${notifications.data.unread} unread)` : ''}`} onClick={() => setNotificationsOpen(true)}><Bell />{notifications.data?.unread > 0 && <span className="notification-count">{notifications.data.unread > 99 ? '99+' : notifications.data.unread}</span>}</button>
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Search campus" eyebrow="Circulars, events, groups, posts & people">
      <label className="discovery-search command-input"><Search /><span className="sr-only">Search everything</span><input autoFocus type="search" maxLength={100} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search your campus…" /></label>
      {!search && <p className="view-intro">Search a notice, group, person, or campus story. Only circulars you can access appear here.</p>}
      {results.isFetching && <p role="status">Searching…</p>}<Failure error={results.error} />
      <div className="command-results">{results.data?.results.map((result) => <button className="command-result" key={result.id} onClick={() => { setSearchOpen(false); navigate(result.href); }}><span><small>{result.kind}</small><strong>{result.title}</strong><span>{result.subtitle}</span></span><ArrowUpRight /></button>)}</div>
      {search && results.isSuccess && !results.data.results.length && <p className="empty-state">No results. Try a name, topic, or fewer words.</p>}
    </Modal>
    <Modal open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title="Notifications" eyebrow="Your campus updates" className="notification-drawer">
      <div className="notification-actions"><button className="inline-button" disabled={update.isPending || !notifications.data?.unread} onClick={() => update.mutate({})}><CheckCheck />Mark all read</button><button className="inline-button" disabled={update.isPending || !notifications.data?.notifications?.length} onClick={() => update.mutate({ path: '/api/platform/notifications', method: 'DELETE' })}>Clear all</button></div>
      <Failure error={notifications.error || update.error} />
      {notifications.isPending && <p role="status">Loading updates…</p>}
      {notifications.data?.notifications?.map((item) => <button className={`notification-item${item.readAt ? '' : ' is-unread'}`} key={item.id} onClick={() => openNotification(item)}><Bell /><span><strong>{item.title}</strong><p>{item.message}</p><small>{dateLabel(item.createdAt)}</small></span></button>)}
      {notifications.isSuccess && !notifications.data?.notifications?.length && <div className="empty-state"><Bell /><h4>You’re all caught up</h4><p>New notices and campus reactions appear here.</p></div>}
      <button className="secondary-button" onClick={() => { setNotificationsOpen(false); navigate(`/${user.role}/settings`); }}>Notification preferences</button>
    </Modal>
  </div>;
}

function ProfileForm({ profile, user }) {
  const client = useQueryClient();
  const form = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user.name, register_number: '', department: '', program: '', section: '', academic_year: '', bio: '', ...profile } });
  const mutation = useMutation({ mutationFn: (body) => apiRequest('/api/platform/profile', { method: 'PUT', body }), onSuccess: async (_data, values) => { form.reset(values); await Promise.all([client.invalidateQueries({ queryKey: ['profile'] }), client.invalidateQueries({ queryKey: ['session'] })]); } });
  return <form className="form-stack profile-editor" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
    <h4>Your profile</h4><p className="view-intro">Keep your college details current. Study-year memberships are managed by your college.</p>
    {[['name', 'Full name'], ['register_number', 'Register number'], ['department', 'Department'], ['program', 'Program'], ['section', 'Section'], ['academic_year', 'Academic year'], ['bio', 'About you']].map(([key, label]) => <label className="field" key={key}><span>{label}</span>{key === 'bio' ? <textarea rows={3} {...form.register(key)} /> : <input {...form.register(key)} />}{form.formState.errors[key] && <small className="form-error">{form.formState.errors[key].message}</small>}</label>)}
    <Failure error={mutation.error} />{mutation.isSuccess && !form.formState.isDirty && <p className="form-success" role="status">Profile saved.</p>}
    <button className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save profile'}</button>
  </form>;
}
function PreferencesForm({ preferences: initial }) {
  const [preferences, setPreferences] = useState(initial);
  const mutation = useMutation({ mutationFn: () => apiRequest('/api/platform/preferences', { method: 'PUT', body: preferences }) });
  return <form className="form-stack preference-list" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><h4>Choose your notifications</h4>
    {[['circular', 'Official circulars'], ['event', 'Upcoming events and deadlines'], ['social', 'Reactions and comments on your posts'], ['email', 'Email updates']].map(([key, label]) => <label className="preference-row" key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => { mutation.reset(); setPreferences({ ...preferences, [key]: event.target.checked }); }} /></label>)}
    <label className="field"><span>Email frequency</span><select value={preferences.digest} disabled={!preferences.email} onChange={(event) => { mutation.reset(); setPreferences({ ...preferences, digest: event.target.value }); }}><option value="instant">As notices arrive</option><option value="daily">Daily digest</option></select></label>
    <Failure error={mutation.error} />{mutation.isSuccess && <p className="form-success" role="status">Preferences saved.</p>}<button className="secondary-button" disabled={mutation.isPending}>Save preferences</button>
  </form>;
}
export function AccountSettings({ user }) {
  const query = useQuery({ queryKey: ['profile', user.id], queryFn: () => apiRequest('/api/platform/profile') });
  const prefs = useQuery({ queryKey: ['preferences', user.id], queryFn: () => apiRequest('/api/platform/preferences') });
  return <section className="tab-view"><div className="section-heading"><div><p className="overline">Make it yours</p><h3>Profile & preferences</h3></div></div><div className="settings-card"><ThemePreference /></div><div className="settings-card"><DisplayPreferences /></div><Failure error={query.error || prefs.error} />{query.isPending && <p role="status">Loading profile…</p>}{query.data && <div className="settings-card"><ProfileForm profile={query.data.profile} user={user} /></div>}{prefs.data && <div className="settings-card"><PreferencesForm preferences={prefs.data.preferences} /></div>}</section>;
}
export function SavedCirculars({ user }) {
  const navigate = useNavigate();
  const query = useInfiniteQuery({ queryKey: ['platform-circulars', user.id, 'saved'], initialPageParam: 0, queryFn: ({ pageParam, signal }) => apiRequest(`/api/platform/circulars?saved=true&offset=${pageParam}`, { signal }), getNextPageParam: (page, pages) => page.hasMore ? pages.length * 20 : undefined });
  const rows = query.data?.pages.flatMap((page) => page.circulars) || [];
  return <section className="tab-view notice-collection"><div className="section-heading"><div><p className="overline">Keep close</p><h3>Saved notices</h3></div><Bookmark /></div><Failure error={query.error} />{query.isPending && <p role="status">Loading saved notices…</p>}{rows.map((item) => <button className="command-result" key={item.id} onClick={() => navigate(`/student/circulars/${item.id}`)}><span><small>{item.category || 'Circular'} · {item.faculty?.name}</small><strong>{item.title || item.summary}</strong><small>{dateLabel(item.createdAt)}</small></span><ArrowUpRight /></button>)}{query.isSuccess && !rows.length && <div className="empty-state"><Bookmark /><h4>Your reading list starts here</h4><p>Open a circular and choose Save notice to keep it handy.</p></div>}{query.hasNextPage && <button className="secondary-button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Load more</button>}</section>;
}
export function CircularExtras({ circular, user }) {
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => apiRequest(`/api/platform/circulars/${circular.id}/save`, { method: circular.saved ? 'DELETE' : 'PUT' }), onSuccess: () => { for (const key of ['circular', 'inbox', 'platform-circulars']) client.invalidateQueries({ queryKey: [key] }); } });
  return <div className="circular-extras"><div className="tag-row">{circular.category && <span className="target-tag">{circular.category}</span>}{circular.priority && <span className={`urgency-pill ${circular.priority}`}>{circular.priority}</span>}{circular.pinnedUntil >= new Date().toISOString().slice(0, 10) && <span className="target-tag"><Pin />Pinned until {circular.pinnedUntil}</span>}</div>{(circular.eventTime || circular.location) && <p>{[circular.eventTime, circular.location].filter(Boolean).join(' · ')}</p>}{circular.deadline && <p><strong>Deadline:</strong> {circular.deadline}</p>}{circular.attachments?.map((file) => <a className="secondary-button" key={file.id} href={file.url} download><Paperclip />{file.name}<small>{Math.ceil(file.size / 1024)} KB</small></a>)}{user.role === 'student' && <button className="secondary-button" disabled={save.isPending} aria-pressed={Boolean(circular.saved)} onClick={() => save.mutate()}><Bookmark />{circular.saved ? 'Unsave notice' : 'Save notice'}</button>}<Failure error={save.error} /></div>;
}
export function CampusCalendar({ user }) {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['platform-events', user.id], queryFn: () => apiRequest('/api/platform/events') });
  return <><Failure error={query.error} />{query.isPending ? <div className="skeleton-card" role="status">Loading events…</div> : query.data && <EventCalendar events={query.data.events} role={user.role} onOpen={(event) => navigate(user.role === 'student' ? `/student/circulars/${event.id}` : `/faculty/sent/${event.id}`)} />}</>;
}
