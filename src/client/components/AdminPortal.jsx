import CreateGroupDialog from './CreateGroupDialog.tsx';
import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Flag, House, LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, Users, UsersRound } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, getErrorMessage } from '../api.js';
import Modal from './Modal.jsx';
import PortalThemeButton from './PortalThemeButton.jsx';

const dateLabel = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const manageable = (group) => ['custom', 'activity'].includes(group.kind);

function ErrorMessage({ error }) {
  return error ? <p className="form-error" role="alert">{getErrorMessage(error)}</p> : null;
}
function useAdminList(resource, filters = {}) {
  return useInfiniteQuery({
    queryKey: ['admin', resource, filters], initialPageParam: null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(filters);
      if (pageParam) params.set('before', pageParam);
      return apiRequest(`/api/admin/${resource}?${params}`, { signal });
    },
    getNextPageParam: (result) => result.nextCursor ?? undefined,
  });
}
function ListState({ query, empty, children }) {
  return <>
    {query.isPending && <p role="status">Loading…</p>}
    <ErrorMessage error={query.error} />
    {query.isError && <button className="secondary-button" onClick={() => query.refetch()}>Try again</button>}
    {query.isSuccess && empty && <p className="empty-state">Nothing here yet.</p>}
    {children}
    {query.hasNextPage && <button className="secondary-button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
  </>;
}
function PageHeading({ title, subtitle, children }) {
  return <><div className="section-heading"><div><p className="overline">Campus administration</p><h3>{title}</h3></div>{children}</div>{subtitle && <p className="view-intro">{subtitle}</p>}</>;
}
function MiniChart({ title, rows }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <article className="admin-panel"><h4>{title}</h4><p className="view-intro">Activity during the last 30 days</p>{!rows.length && <p>No activity recorded in this period.</p>}{rows.map((row) => <div className="admin-chart-row" key={row.day}><time>{row.day}</time><span className="admin-chart-track"><span className="admin-chart-bar" style={{ width: `${row.count / max * 100}%` }} /></span><strong>{row.count}</strong></div>)}</article>;
}
function Overview() {
  const query = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => apiRequest('/api/admin/stats') });
  const stats = [['students', 'Students'], ['faculty', 'Faculty'], ['enabledUsers', 'Enabled accounts'], ['circulars', 'Circulars'], ['groups', 'Groups'], ['posts', 'Campus posts'], ['pendingReports', 'Reports to review'], ['acknowledgments', 'Acknowledgments']];
  return <section className="tab-view"><PageHeading title="Your campus, at a glance" subtitle="Manage access, care for your community, and follow college communication." /><ListState query={query} empty={false}>{query.data && <><div className="admin-grid">{stats.map(([key, label]) => <article className="admin-stat" key={key}><span>{label}</span><strong>{query.data.counts[key].toLocaleString()}</strong></article>)}</div><div className="admin-grid admin-charts"><MiniChart title="Account growth" rows={query.data.growth} /><MiniChart title="Circular activity" rows={query.data.activity} /></div></>}</ListState></section>;
}

function UserEditor({ item, currentUser, onClose }) {
  const client = useQueryClient();
  const isNew = !item.id;
  const [form, setForm] = useState({ name: item.name || '', email: item.email || '', password: '', role: item.role || 'student', year: item.year || 1, disabled: Boolean(item.disabled) });
  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/admin/users${isNew ? '' : `/${item.id}`}`, { method: isNew ? 'POST' : 'PATCH', body: { name: form.name, email: form.email, role: form.role, year: form.role === 'student' ? Number(form.year) : null, ...(isNew ? { password: form.password } : { disabled: form.disabled }) } }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['session'] }), client.invalidateQueries({ queryKey: ['groups'] })]); onClose(); },
  });
  return <Modal open onClose={onClose} dismissible={!save.isPending} title={isNew ? 'Create an account' : `Edit ${item.name}`} eyebrow="Secure college access"><form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
    <label className="field"><span>Full name</span><input required minLength={2} maxLength={100} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label className="field"><span>Email address</span><input type="email" required maxLength={254} value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
    <label className="field"><span>Account role</span><select value={form.role} disabled={item.role === 'admin'} onChange={(event) => update('role', event.target.value)}>{item.role === 'admin' ? <option value="admin">Administrator</option> : <><option value="student">Student</option><option value="faculty">Faculty</option></>}</select></label>
    {form.role === 'student' && <label className="field"><span>Academic year</span><select value={form.year} onChange={(event) => update('year', Number(event.target.value))}>{[1, 2, 3, 4].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label>}
    {isNew && <label className="field"><span>Initial password</span><input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={form.password} onChange={(event) => update('password', event.target.value)} /><small>At least 8 characters. Share credentials privately with the account owner.</small></label>}
    {!isNew && <label className="check-option"><input type="checkbox" checked={form.disabled} disabled={item.id === currentUser.id} onChange={(event) => update('disabled', event.target.checked)} /><span>Disable account access</span></label>}
    {form.disabled && <p className="collection-note">Saving ends this account’s active sessions. Their existing content stays available.</p>}
    {!isNew && form.role !== item.role && <p className="collection-note">Changing the role ends active sessions and updates automatic group memberships.</p>}
    <ErrorMessage error={save.error} /><button className="primary-button" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Create account' : 'Save account'}</button>
  </form></Modal>;
}
function UserDirectory({ user }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [editing, setEditing] = useState(null);
  const query = useAdminList('users', { q: search, role });
  const users = query.data?.pages.flatMap((result) => result.users) || [];
  return <section className="tab-view"><PageHeading title="People & access" subtitle="Create faculty and student accounts, update academic years, and manage access."><button className="round-add" aria-label="Create account" onClick={() => setEditing({})}><Plus /></button></PageHeading>
    <div className="admin-toolbar"><label className="discovery-search"><Search /><span className="sr-only">Search accounts</span><input type="search" maxLength={100} placeholder="Search people or email…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field"><span>Filter role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option><option value="student">Students</option><option value="faculty">Faculty</option><option value="admin">Administrators</option></select></label></div>
    <ListState query={query} empty={!users.length}><div className="card-list">{users.map((item) => <article className="admin-row" key={item.id}><div><strong>{item.name}</strong><p>{item.email}</p><small>{item.role}{item.year ? ` · Year ${item.year}` : ''} · {item.disabled ? 'Disabled' : 'Enabled'}</small></div><button className="secondary-button" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}>Edit</button></article>)}</div></ListState>
    {editing && <UserEditor key={editing.id || 'new'} item={editing} currentUser={user} onClose={() => setEditing(null)} />}
  </section>;
}

function GroupMembers({ group }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const membersQuery = useAdminList(`groups/${group.id}/members`);
  const members = membersQuery.data?.pages.flatMap((result) => result.members) || [];
  const candidatesQuery = useQuery({ queryKey: ['admin', 'member-search', search], queryFn: ({ signal }) => apiRequest(`/api/admin/users?role=student&q=${encodeURIComponent(search)}`, { signal }), enabled: search.trim().length >= 2 });
  const change = useMutation({ mutationFn: ({ id, add }) => apiRequest(`/api/admin/groups/${group.id}/members/${id}`, { method: add ? 'PUT' : 'DELETE' }), onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['groups'] })]) });
  return <div className="admin-members"><h4>Members</h4><p className="view-intro">Search by name or email to add an enabled student.</p><label className="field"><span>Find students</span><input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Type at least 2 characters" /></label>
    {candidatesQuery.isFetching && <p role="status">Finding students…</p>}<ErrorMessage error={candidatesQuery.error || change.error} />
    {search.trim().length >= 2 && candidatesQuery.data?.users.filter((candidate) => !candidate.disabled && !members.some((member) => member.id === candidate.id)).map((candidate) => <div className="admin-row" key={candidate.id}><div><strong>{candidate.name}</strong><small>{candidate.email}</small></div><button className="inline-button" disabled={change.isPending} aria-label={`Add ${candidate.name}`} onClick={() => change.mutate({ id: candidate.id, add: true })}>Add</button></div>)}
    <ListState query={membersQuery} empty={!members.length}>{members.map((member) => <div className="admin-row" key={member.id}><div><strong>{member.name}</strong><small>{member.email}</small></div><button className="inline-button" disabled={change.isPending} aria-label={`Remove ${member.name}`} onClick={() => change.mutate({ id: member.id, add: false })}>Remove</button></div>)}</ListState>
  </div>;
}
function GroupEditor({ group, onClose }) {
  const client = useQueryClient();
  const [name, setName] = useState(group.name || '');
  const [description, setDescription] = useState(group.description || '');
  const [joinable, setJoinable] = useState(group.id ? Boolean(group.joinable) : true);
  const save = useMutation({ mutationFn: () => apiRequest(`/api/admin/groups${group.id ? `/${group.id}` : ''}`, { method: group.id ? 'PATCH' : 'POST', body: { name, description, joinable } }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['groups'] })]); onClose(); } });
  return <Modal open onClose={onClose} dismissible={!save.isPending} title={group.id ? 'Manage group' : 'Create a group'} eyebrow="Campus communities"><form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><label className="field"><span>Group name</span><input value={name} required minLength={2} maxLength={100} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Description</span><textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label><label className="check-option"><input type="checkbox" checked={joinable} onChange={(event) => setJoinable(event.target.checked)} /><span>Students can join this group</span></label><ErrorMessage error={save.error} /><button className="primary-button" disabled={save.isPending}>{save.isPending ? 'Saving…' : group.id ? 'Save group' : 'Create group'}</button></form>{group.id && <GroupMembers group={group} />}</Modal>;
}
function GroupDirectory() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const query = useAdminList('groups', { q: search });
  const groups = query.data?.pages.flatMap((result) => result.groups) || [];
  return <section className="tab-view"><PageHeading title="Groups & memberships" subtitle="Year and college memberships follow student accounts. Manage custom communities here."><button className="round-add" aria-label="Create group" onClick={() => setEditing({})}><Plus /></button></PageHeading><label className="discovery-search"><Search /><span className="sr-only">Search groups</span><input type="search" placeholder="Find a group…" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label><ListState query={query} empty={!groups.length}><div className="card-list">{groups.map((group) => <article className="admin-row" key={group.id}><div><strong>{group.name}</strong><p>{group.description}</p><small>{group.kind} · {group.memberCount} students · {group.circularCount} circulars</small></div>{manageable(group) ? <button className="secondary-button" aria-label={`Manage ${group.name}`} onClick={() => setEditing(group)}>Manage</button> : <span className="soft-badge">Automatic</span>}</article>)}</div></ListState>{editing && (editing.id ? <GroupEditor key={editing.id} group={editing} onClose={() => setEditing(null)} /> : <CreateGroupDialog role="admin" onClose={() => setEditing(null)} />)}</section>;
}

function Reports() {
  const client = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [review, setReview] = useState(null);
  const [note, setNote] = useState('');
  const query = useAdminList('reports', { status });
  const reports = query.data?.pages.flatMap((result) => result.reports) || [];
  const resolve = useMutation({ mutationFn: () => apiRequest(`/api/admin/reports/${review.id}/resolve`, { method: 'POST', body: { action: review.action, note } }), onSuccess: async () => { setReview(null); setNote(''); await Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['campus-feed'] }), client.invalidateQueries({ queryKey: ['campus-comments'] })]); } });
  return <section className="tab-view"><PageHeading title="Community care" subtitle="Review reports with context. Every moderation decision is recorded in the audit log." /><div className="filter-row">{[['pending', 'To review'], ['dismissed', 'Dismissed'], ['removed', 'Removed'], ['all', 'All reports']].map(([value, label]) => <button key={value} className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div><ListState query={query} empty={!reports.length}><div className="card-list">{reports.map((report) => <article className="admin-panel admin-report" key={report.id}><div className="section-heading"><h4>Reported {report.target_type}</h4><span className="soft-badge">{report.status}</span></div><p><strong>Author:</strong> {report.authorName || 'Deleted account'} · <strong>Reporter:</strong> {report.reporterName || 'Deleted account'}</p><small>{dateLabel(report.created_at)}</small><blockquote className="admin-content-preview">{report.content_snapshot}</blockquote>{Boolean(report.hasImage) && report.target_type === 'post' && <img className="campus-photo" src={`/api/posts/${report.post_id}/image`} alt="Photo attached to the reported post" loading="lazy" />}<p><strong>Reason:</strong> {report.reason}</p>{report.resolution_note && <p><strong>Review note:</strong> {report.resolution_note}</p>}{report.status === 'pending' && <div className="admin-toolbar"><button className="secondary-button" onClick={() => { resolve.reset(); setNote(''); setReview({ ...report, action: 'dismiss' }); }}>Dismiss report</button><button className="secondary-button" onClick={() => { resolve.reset(); setNote(''); setReview({ ...report, action: 'remove' }); }}>Remove {report.target_type}</button></div>}</article>)}</div></ListState>
    <Modal open={Boolean(review)} onClose={() => setReview(null)} dismissible={!resolve.isPending} title={review?.action === 'remove' ? `Remove this ${review.target_type}?` : 'Dismiss this report?'} eyebrow="Moderation decision"><form className="form-stack" onSubmit={(event) => { event.preventDefault(); resolve.mutate(); }}><p>{review?.action === 'remove' ? 'The content will be removed from campus. Report evidence and your decision remain in the audit history.' : 'The content stays on campus. Your review will be recorded.'}</p><label className="field"><span>Review note (optional)</span><textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label><ErrorMessage error={resolve.error} /><button className="primary-button" disabled={resolve.isPending}>{resolve.isPending ? 'Saving decision…' : 'Confirm decision'}</button></form></Modal>
  </section>;
}

function Configuration({ initial }) {
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = useMutation({ mutationFn: () => apiRequest('/api/admin/config', { method: 'PUT', body: form }), onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['college-config'] })]) });
  return <article className="admin-panel"><h4>College configuration</h4><form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><label className="field"><span>College name</span><input required minLength={2} maxLength={100} value={form.collegeName} onChange={(event) => update('collegeName', event.target.value)} /></label><label className="field"><span>Support email</span><input type="email" maxLength={254} value={form.supportEmail} onChange={(event) => update('supportEmail', event.target.value)} /></label><label className="field"><span>Campus guidelines</span><textarea rows={4} maxLength={2000} value={form.campusGuidelines} onChange={(event) => update('campusGuidelines', event.target.value)} /></label><label className="check-option"><input type="checkbox" checked={form.registrationOpen} onChange={(event) => update('registrationOpen', event.target.checked)} /><span>Allow new student registration</span></label><ErrorMessage error={save.error} />{save.isSuccess && <p className="form-success" role="status">College settings saved.</p>}<button className="primary-button" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</button></form></article>;
}
function System({ user, onLogout }) {
  const config = useQuery({ queryKey: ['admin', 'config'], queryFn: () => apiRequest('/api/admin/config') });
  const notifications = useQuery({ queryKey: ['admin', 'notifications'], queryFn: () => apiRequest('/api/admin/notifications') });
  const logs = useAdminList('audit');
  const entries = logs.data?.pages.flatMap((result) => result.entries) || [];
  const logout = useMutation({ mutationFn: onLogout });
  return <section className="tab-view"><PageHeading title="System & settings" subtitle={`Signed in as ${user.name}. Administration changes are recorded.`} /><ListState query={notifications} empty={false}>{notifications.data && <article className="admin-panel"><h4>Notification status</h4><p><strong>{notifications.data.subscribedUsers}</strong> people with active push subscriptions · <strong>{notifications.data.subscriptions}</strong> subscribed browsers</p><p>Email delivery: {notifications.data.emailMode === 'smtp' ? 'Configured SMTP' : 'Local preview transport'}{notifications.data.outboundDisabled ? ' · Outbound notifications disabled' : ''}</p></article>}</ListState><ListState query={config} empty={false}>{config.data && <Configuration initial={config.data.config} />}</ListState><article className="admin-panel"><h4>Audit history</h4><ListState query={logs} empty={!entries.length}>{entries.map((entry) => <div className="admin-row" key={entry.id}><div><strong>{entry.action}</strong><p>{entry.actorName || 'System'} · {entry.resource}{entry.resourceId ? ` #${entry.resourceId}` : ''}</p><small>{dateLabel(entry.createdAt)}</small>{Object.keys(entry.metadata).length > 0 && <details><summary>Action details</summary><pre className="admin-content-preview">{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</div></div>)}</ListState></article><ErrorMessage error={logout.error} /><button className="secondary-button" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut /> {logout.isPending ? 'Signing out…' : 'Sign out'}</button></section>;
}

export default function AdminPortal({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const nav = [['overview', 'Overview', Activity], ['users', 'Users', Users], ['groups', 'Groups', UsersRound], ['reports', 'Reports', Flag], ['system', 'System', Settings]];
  return <section className="screen app-screen screen-active admin-screen" aria-label="Admin portal"><header className="app-topbar"><div><p className="overline"><ShieldCheck aria-hidden="true" /> Admin portal</p><h2>Care for your campus</h2></div><div className="portal-header-actions"><PortalThemeButton /><button className="icon-button" aria-label="Refresh administration" onClick={() => client.invalidateQueries({ queryKey: ['admin'] })}><RefreshCw /></button><button className="icon-button" aria-label="Go to home" onClick={() => navigate('/')}><House /></button></div></header><div className="view-scroll"><Routes><Route index element={<Navigate to="overview" replace />} /><Route path="overview" element={<Overview />} /><Route path="users" element={<UserDirectory user={user} />} /><Route path="groups" element={<GroupDirectory />} /><Route path="reports" element={<Reports />} /><Route path="system" element={<System user={user} onLogout={onLogout} />} /><Route path="*" element={<Navigate to="overview" replace />} /></Routes></div><nav className="bottom-nav" aria-label="Admin navigation">{nav.map(([path, label, Icon]) => <button key={path} className={location.pathname === `/admin/${path}` ? 'active' : ''} aria-current={location.pathname === `/admin/${path}` ? 'page' : undefined} onClick={() => navigate(`/admin/${path}`)}><Icon /><span>{label}</span></button>)}</nav></section>;
}
