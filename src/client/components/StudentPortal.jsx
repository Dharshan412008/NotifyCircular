import { lazy, Suspense } from 'react';
import { RouteLoading } from './RouteBoundary';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  Inbox,
  LogOut,
  UserRound,
  Users,
  Sparkles,
  Search,
  House,
} from 'lucide-react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { apiRequest } from '../api.js';
import CampusFeed from './CampusFeed.jsx';
import PortalThemeButton from './PortalThemeButton.jsx';
const Discussions = lazy(() => import('./Discussions.tsx'));
const Overview = lazy(() => import('./Overview.jsx'));
const EventCheckIn = lazy(() => import('./CircularWorkbench.jsx').then((module) => ({ default: module.EventCheckIn })));
import PortalNavigation from './PortalNavigation.jsx';
import EventCalendar from './EventCalendar.jsx';
import { PortalTools, AccountSettings, CircularExtras, SavedCirculars } from './PlatformTools.jsx';

const inboxKey = (userId) => ['inbox', Number(userId)];
const groupsKey = (userId) => ['groups', 'student', Number(userId)];
const membershipsKey = (userId) => ['memberships', Number(userId)];

async function loadInbox({ signal }) {
  const circulars = [];
  let page;
  do {
    const path = circulars.length ? `/api/inbox?offset=${circulars.length}` : '/api/inbox';
    const payload = await apiRequest(path, { signal });
    page = Array.isArray(payload.circulars) ? payload.circulars : [];
    circulars.push(...page);
  } while (page.length === 100);
  return circulars;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const URGENCY_PRESENTATION = {
  urgent: { value: 'urgent', label: 'Urgent' },
  fyi: { value: 'fyi', label: 'FYI' },
  normal: { value: 'normal', label: 'Normal' },
};

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CR';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] : ''}`.toUpperCase();
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Student';
}

function yearLabel(year) {
  const labels = {
    1: 'First year',
    2: 'Second year',
    3: 'Third year',
    4: 'Final year',
  };
  return labels[Number(year)] || 'Year not assigned';
}

function formatCreatedAt(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return 'Just now';
  if (elapsed >= 0 && elapsed < 3_600_000) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  }
  if (elapsed >= 0 && elapsed < 86_400_000) {
    return `${Math.max(1, Math.floor(elapsed / 3_600_000))}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatEventDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || 'Event date');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
}

function urgencyPresentation(value) {
  return URGENCY_PRESENTATION[value] || URGENCY_PRESENTATION.normal;
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function EmptyState({ title, copy, icon: EmptyIcon = Inbox }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-icon" aria-hidden="true"><EmptyIcon /></span>
      <h4>{title}</h4>
      <p>{copy}</p>
    </div>
  );
}

function LoadingCards({ label = 'Loading', count = 2 }) {
  return (
    <div className="card-list" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

function ErrorState({ error, fallback }) {
  return (
    <div className="form-error" role="alert">
      {errorMessage(error, fallback)}
    </div>
  );
}

function updateCircularStatus(queryClient, userId, circularId, status = {}) {
  const mergeStatus = (circular) => circular ? {
    ...circular,
    readAt: status.readAt ?? circular.readAt ?? null,
    acknowledgedAt: status.acknowledgedAt ?? circular.acknowledgedAt ?? null,
  } : circular;

  queryClient.setQueryData(inboxKey(userId), (current) => Array.isArray(current)
    ? current.map(
        (item) => Number(item.id) === Number(circularId) ? mergeStatus(item) : item,
      )
    : current);
  queryClient.setQueryData(
    ['circular', Number(circularId), Number(userId)],
    mergeStatus,
  );
}

function supportsPushNotifications() {
  return (
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'PushManager' in window
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
  );
}

function urlBase64ToUint8Array(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('The notification server returned an invalid public key.');
  const padding = '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = `${input}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => window.clearTimeout(timer));
}

async function inspectPushNotifications() {
  if (!supportsPushNotifications()) {
    return { kind: 'unsupported', registration: null, subscription: null, error: null };
  }
  if (window.Notification.permission === 'denied') {
    return { kind: 'blocked', registration: null, subscription: null, error: null };
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    return {
      kind: subscription ? 'enabled' : 'available',
      registration: registration || null,
      subscription: subscription || null,
      error: null,
    };
  } catch (error) {
    return { kind: 'error', registration: null, subscription: null, error };
  }
}

function pushStatePresentation(kind) {
  const presentations = {
    checking: { label: 'Checking', action: 'Browser notifications', copy: 'Checking browser support.' },
    unsupported: { label: 'Unavailable', action: 'Notifications unavailable', copy: 'Web Push is not supported by this browser.' },
    blocked: { label: 'Blocked', action: 'Notifications blocked', copy: 'Permission is blocked in browser settings.' },
    available: { label: 'Off', action: 'Enable notifications', copy: 'Receive new circulars outside the app.' },
    enabled: { label: 'On', action: 'Disable notifications', copy: 'New circulars can arrive while the app is closed.' },
    error: { label: 'Error', action: 'Retry notifications', copy: 'Notifications could not be updated.' },
  };
  return presentations[kind] || presentations.error;
}

function StudentShell({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = location.pathname.endsWith('/groups')
    ? 'groups'
    : location.pathname.endsWith('/account')
      ? 'account'
      : location.pathname.endsWith('/campus') ? 'campus'
        : location.pathname.endsWith('/events') ? 'events' : 'inbox';

  const goTo = (view) => {
    navigate(view === 'inbox' ? '/student' : `/student/${view}`);
  };

  return (
    <section className="screen app-screen screen-active" aria-labelledby="studentHeading">
      <header className="app-topbar">
        <div>
          <p className="overline">Student portal</p>
          <h2 id="studentHeading">Hello, {firstName(user.name)}</h2>
        </div>
        <div className="portal-header-actions"><PortalTools user={user} /><PortalThemeButton /><button className="icon-button" aria-label="Go to home" onClick={() => navigate('/')}><House /></button>
        <button
          className="avatar-button"
          type="button"
          onClick={() => goTo('account')}
          aria-label="Open account"
        >
          <span className="avatar">{initials(user.name)}</span>
          <span className="online-dot" aria-hidden="true" />
        </button>
        </div>
      </header>

      <div className="view-scroll">
        <Outlet />
      </div>

      <PortalNavigation role="student" />
    </section>
  );
}

function InboxView({ user }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filter = ['unread', 'urgent', 'action'].includes(params.get('status')) ? params.get('status') : 'all';
  const search = params.get('q') || '';
  const groupFilter = params.get('group') || 'all';
  const period = ['7', '30'].includes(params.get('days')) ? params.get('days') : 'all';
  const sort = ['oldest', 'priority'].includes(params.get('sort')) ? params.get('sort') : 'newest';
  const changeFilters = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === 'all' || (key === 'sort' && value === 'newest')) next.delete(key);
      else next.set(key, value);
    }
    return next;
  }, { replace: true });
  const setFilter = (value) => changeFilters({ status: value });
  const setSearch = (value) => changeFilters({ q: value });
  const hasFilters = Boolean(search || filter !== 'all' || groupFilter !== 'all' || period !== 'all' || sort !== 'newest');
  const query = useQuery({
    queryKey: inboxKey(user.id),
    queryFn: loadInbox,
  });

  const readAllMutation = useMutation({
    mutationFn: () => apiRequest('/api/inbox/read-all', { method: 'POST' }),
    onSuccess: (payload) => {
      const updatedIds = new Set(payload.circularIds.map(Number));
      queryClient.setQueryData(inboxKey(user.id), (current) => (current || []).map((circular) => (
        updatedIds.has(Number(circular.id)) ? { ...circular, readAt: payload.readAt } : circular
      )));
      for (const circularId of updatedIds) {
        queryClient.setQueryData(['circular', circularId, Number(user.id)], (current) => (
          current ? { ...current, readAt: payload.readAt } : current
        ));
      }
    },
  });

  const circulars = query.data || [];
  const unreadCount = circulars.filter((circular) => !circular.readAt).length;
  const pendingCount = circulars.filter((circular) => circular.requiresAcknowledgment && !circular.acknowledgedAt).length;
  const groupOptions = [...new Map(circulars.flatMap((item) => item.targets || []).map((group) => [String(group.id), group])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const cutoff = Date.now() - Number(period) * 86400000;
  const visibleCirculars = circulars.filter((circular) => {
    if (groupFilter !== 'all' && !(circular.targets || []).some((group) => String(group.id) === groupFilter)) return false;
    if (period !== 'all' && !(new Date(circular.createdAt).getTime() >= cutoff)) return false;
    if (filter === 'unread' && circular.readAt) return false;
    if (filter === 'urgent' && circular.urgency !== 'urgent') return false;
    if (filter === 'action' && (!circular.requiresAcknowledgment || circular.acknowledgedAt)) return false;
    const text = [circular.summary, circular.text, circular.faculty?.name, ...(circular.targets || []).map((group) => group.name)].join(' ').toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }).sort((a, b) => {
    const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id;
    if (sort === 'oldest') return -byDate;
    if (sort === 'priority') {
      const rank = { urgent: 0, normal: 1, fyi: 2 };
      return (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) || byDate;
    }
    return byDate;
  });

  return (
    <section aria-labelledby="studentInboxTitle">
      <div className="inbox-heading">
        <div>
          <h3 id="studentInboxTitle">Your circulars</h3>
          <p>
            {unreadCount
              ? `${unreadCount} unread notice${unreadCount === 1 ? '' : 's'} for your groups.`
              : 'Only notices for your groups appear here.'}
          </p>
        </div>
      </div>

      {query.isSuccess && circulars.length > 0 && (
        <div className="inbox-toolbar">
          <span>{unreadCount} unread · {pendingCount} need acknowledgment</span>
          <button className="secondary-button" type="button" disabled={!unreadCount || readAllMutation.isPending} aria-busy={readAllMutation.isPending} onClick={() => readAllMutation.mutate()}>
            <Check aria-hidden="true" />{readAllMutation.isPending ? 'Marking as read...' : 'Mark all as read'}
          </button>
        </div>
      )}
      {readAllMutation.isError && <ErrorState error={readAllMutation.error} fallback="Could not mark notices as read. Please try again." />}
      {readAllMutation.isSuccess && <p className="form-success" role="status">{readAllMutation.data.updatedCount} notice{readAllMutation.data.updatedCount === 1 ? '' : 's'} marked as read. Required acknowledgments still need your confirmation.</p>}
      {pendingCount > 0 && <button className="attention-banner" onClick={() => setParams({ status: 'action' }, { replace: true })}><span className="attention-dot" /><span><strong>{pendingCount} notice{pendingCount === 1 ? '' : 's'} need{pendingCount === 1 ? 's' : ''} your acknowledgment</strong><small>Review and confirm that you have read them</small></span><ChevronRight /></button>}
      <label className="discovery-search"><Search aria-hidden="true" /><span className="sr-only">Search notices</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notices, groups, or faculty..." /></label>
      <div className="filter-row" aria-label="Inbox filters">
        <button
          className={filter === 'all' ? 'active' : ''}
          type="button"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          All
        </button>
        <button
          className={filter === 'unread' ? 'active' : ''}
          type="button"
          onClick={() => setFilter('unread')}
          aria-pressed={filter === 'unread'}
        >
          Unread
        </button>
        <button className={filter === 'urgent' ? 'active' : ''} type="button" onClick={() => setFilter('urgent')} aria-pressed={filter === 'urgent'}>Urgent</button>
        <button className={filter === 'action' ? 'active' : ''} type="button" onClick={() => setFilter('action')} aria-pressed={filter === 'action'}>Needs action</button>
      </div>

      <div className="discovery-controls">
        <label className="field"><span>Audience group</span><select value={groupFilter} onChange={(event) => changeFilters({ group: event.target.value })}><option value="all">All groups</option>{groupFilter !== 'all' && !groupOptions.some((group) => String(group.id) === groupFilter) && <option value={groupFilter}>Unavailable group</option>}{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label className="field"><span>Received</span><select value={period} onChange={(event) => changeFilters({ days: event.target.value })}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <label className="field"><span>Sort notices</span><select value={sort} onChange={(event) => changeFilters({ sort: event.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="priority">Priority first</option></select></label>
      </div>
      {query.isSuccess && <div className="filter-summary"><p aria-live="polite">Showing {visibleCirculars.length} of {circulars.length} notices</p>{hasFilters && <button className="inline-button" onClick={() => setParams({}, { replace: true })}>Reset filters</button>}</div>}
      {query.isPending ? <LoadingCards label="Loading circulars" /> : null}
      {query.isError ? (
        <ErrorState error={query.error} fallback="Could not load your inbox." />
      ) : null}
      {query.isSuccess && !visibleCirculars.length ? (
        <EmptyState
          title={search.trim() || groupFilter !== 'all' || period !== 'all' ? 'No matching notices' : filter === 'action' ? 'You are all caught up' : filter === 'urgent' ? 'No urgent notices' : filter === 'unread' ? 'No unread notices' : 'Your inbox is clear'}
          copy={search.trim() || groupFilter !== 'all' || period !== 'all' ? 'Try another keyword, group, or date range.' : filter === 'action' ? 'There are no acknowledgments waiting for you.' : filter === 'urgent' ? 'Urgent circulars for your groups will appear here.' : filter === 'unread'
            ? 'Every circular in your inbox has been opened.'
            : 'Circulars addressed to your memberships will appear here.'}
          icon={filter === 'unread' ? Check : Inbox}
        />
      ) : null}
      {query.isSuccess && visibleCirculars.length ? (
        <div className="card-list inbox-list">
          {visibleCirculars.map((circular) => {
            const unread = !circular.readAt;
            const targets = Array.isArray(circular.targets) ? circular.targets : [];
            const urgency = urgencyPresentation(circular.urgency);
            return (
              <button
                className={`circular-card inbox-card ${unread ? 'is-unread' : 'is-read'}`}
                type="button"
                key={circular.id}
                onClick={() => navigate(`/student/circulars/${Number(circular.id)}`, { state: { inboxSearch: params.toString() } })}
                aria-label={[
                  unread ? 'Unread' : null,
                  `${urgency.label} priority`,
                  circular.summary || 'Open circular',
                  circular.requiresAcknowledgment
                    ? (circular.acknowledgedAt ? 'Acknowledged' : 'Acknowledgment required')
                    : null,
                ].filter(Boolean).join('. ')}
              >
                <div className="card-top">
                  <span className={`urgency-pill ${urgency.value}`}>{urgency.label}</span>
                  <span className="inbox-card-statuses">
                    <time className="card-time" dateTime={circular.createdAt || undefined}>{formatCreatedAt(circular.createdAt)}</time>
                    {unread ? <span className="unread-label">New</span> : null}
                  </span>
                </div>
                <h4 className="circular-summary">{circular.summary || circular.text}</h4>
                <p className="body-preview">{circular.text}</p>
                <div className="tag-row">
                  {targets.length
                    ? targets.map((group) => (
                        <span className="target-tag" key={group.id}>{group.name}</span>
                      ))
                    : <span className="target-tag">Your audience</span>}
                  {circular.requiresAcknowledgment ? (
                    <span className={`ack-pill${circular.acknowledgedAt ? ' done' : ''}`}>
                      {circular.acknowledgedAt ? 'Acknowledged' : 'Acknowledgment required'}
                    </span>
                  ) : null}
                </div>
                <div className="card-footer">
                  <span>{circular.faculty?.name || 'Faculty'}</span>
                  <ChevronRight aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function EventsView({ user }) {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: inboxKey(user.id), queryFn: loadInbox });
  return <section><div className="section-heading"><div><p className="overline">Plan your campus week</p><h3>Upcoming events</h3></div></div>{query.isPending && <LoadingCards label="Loading upcoming events" />}{query.isError && <ErrorState error={query.error} fallback="Could not load upcoming events." />}{query.isSuccess && <EventCalendar events={query.data || []} role="student" onOpen={(event) => navigate(`/student/circulars/${event.id}`)} />}</section>;
}

function MembershipView({ user }) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const groupsQuery = useQuery({
    queryKey: groupsKey(user.id),
    queryFn: async () => {
      const payload = await apiRequest('/api/groups');
      return Array.isArray(payload.groups) ? payload.groups : [];
    },
  });
  const membershipsQuery = useQuery({
    queryKey: membershipsKey(user.id),
    queryFn: async () => {
      const payload = await apiRequest('/api/memberships');
      return Array.isArray(payload.groupIds) ? payload.groupIds.map(Number) : [];
    },
  });

  const joinableGroups = useMemo(
    () => (groupsQuery.data || []).filter((group) => group.joinable === true),
    [groupsQuery.data],
  );
  const automaticGroups = useMemo(() => {
    const membershipIds = new Set((membershipsQuery.data || []).map(Number));
    return (groupsQuery.data || []).filter((group) => (
      group.joinable !== true
      && (group.isMember === true || membershipIds.has(Number(group.id)))
    ));
  }, [groupsQuery.data, membershipsQuery.data]);
  const membershipSignature = useMemo(
    () => (membershipsQuery.data || []).map(Number).sort((left, right) => left - right).join(','),
    [membershipsQuery.data],
  );

  useEffect(() => {
    if (!groupsQuery.isSuccess || !membershipsQuery.isSuccess) return;
    const memberships = new Set((membershipsQuery.data || []).map(Number));
    setSelectedIds(new Set(
      joinableGroups
        .filter((group) => memberships.has(Number(group.id)) || group.isMember === true)
        .map((group) => Number(group.id)),
    ));
  }, [groupsQuery.isSuccess, joinableGroups, membershipSignature, membershipsQuery.data, membershipsQuery.isSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (groupIds) => apiRequest('/api/memberships', {
      method: 'PUT',
      body: { groupIds },
    }),
    onSuccess: async (payload) => {
      const returnedIds = Array.isArray(payload.groupIds)
        ? payload.groupIds.map(Number)
        : [...selectedIds];
      queryClient.setQueryData(membershipsKey(user.id), returnedIds);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupsKey(user.id) }),
        queryClient.invalidateQueries({ queryKey: inboxKey(user.id) }),
      ]);
    },
  });

  const toggleGroup = (groupId, checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(Number(groupId));
      else next.delete(Number(groupId));
      return next;
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const joinableIds = new Set(joinableGroups.map((group) => Number(group.id)));
    const groupIds = [...selectedIds].filter((id) => joinableIds.has(Number(id)));
    saveMutation.mutate(groupIds);
  };

  const isLoading = groupsQuery.isPending || membershipsQuery.isPending;
  const queryError = groupsQuery.error || membershipsQuery.error;

  return (
    <section aria-labelledby="studentGroupsTitle">
      <div className="section-heading">
        <div>
          <p className="overline">Your audience</p>
          <h3 id="studentGroupsTitle">Group memberships</h3>
        </div>
      </div>
      <p className="view-intro">
        Your study year is automatic. Choose any activity groups you want to follow.
      </p>

      {isLoading ? <LoadingCards label="Loading group memberships" /> : null}
      {queryError ? (
        <ErrorState error={queryError} fallback="Could not load your memberships." />
      ) : null}
      {!isLoading && !queryError && !automaticGroups.length && !joinableGroups.length ? (
        <EmptyState
          title="No memberships found"
          copy="Your assigned groups will appear here after registration is complete."
          icon={Users}
        />
      ) : null}
      {!isLoading && !queryError && (automaticGroups.length || joinableGroups.length) ? (
        <form id="membershipForm" onSubmit={handleSubmit}>
          <div className="card-list">
            {automaticGroups.map((group) => (
              <label className="membership-switch is-locked" key={group.id}>
                <span className="group-monogram">{group.icon || initials(group.name)}</span>
                <span className="group-card-copy">
                  <strong>{group.name}</strong>
                  <small>{group.description || 'Assigned automatically'}</small>
                </span>
                <input type="checkbox" checked disabled aria-label={`${group.name}, assigned automatically`} />
              </label>
            ))}
            {joinableGroups.map((group) => (
              <label className="membership-switch" key={group.id}>
                <span className="group-monogram">{group.icon || initials(group.name)}</span>
                <span className="group-card-copy">
                  <strong>{group.name}</strong>
                  <small>{group.description || 'Optional activity group'}</small>
                </span>
                <input
                  type="checkbox"
                  name="groupIds"
                  value={group.id}
                  checked={selectedIds.has(Number(group.id))}
                  disabled={saveMutation.isPending}
                  onChange={(event) => toggleGroup(group.id, event.target.checked)}
                />
              </label>
            ))}
          </div>
          {saveMutation.isError ? (
            <ErrorState error={saveMutation.error} fallback="Could not save memberships." />
          ) : null}
          {saveMutation.isSuccess ? (
            <p className="auth-security" role="status">
              <Check aria-hidden="true" /> Activity groups saved.
            </p>
          ) : null}
          {joinableGroups.length ? (
            <button
              className={`primary-button${saveMutation.isPending ? ' is-loading' : ''}`}
              type="submit"
              disabled={saveMutation.isPending}
              aria-busy={saveMutation.isPending}
            >
              Save activity groups
            </button>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function PushNotificationControl() {
  const [pushState, setPushState] = useState({
    kind: 'checking',
    registration: null,
    subscription: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    inspectPushNotifications().then((nextState) => {
      if (active) setPushState(nextState);
    });
    return () => {
      active = false;
    };
  }, []);

  const pushMutation = useMutation({
    mutationFn: async (action) => {
      if (action === 'disable') {
        const subscription = pushState.subscription;
        if (!subscription) {
          return { registration: pushState.registration, subscription: null };
        }
        await apiRequest('/api/push/subscribe', {
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
        return { registration: pushState.registration, subscription: null };
      }

      let permission = window.Notification.permission;
      if (permission === 'default') {
        permission = await window.Notification.requestPermission();
      }
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notification permission is blocked in browser settings.'
          : 'Notification permission was not granted.');
      }

      let registration = pushState.registration
        || await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await withTimeout(
          navigator.serviceWorker.register('/sw.js'),
          8_000,
          'Notification setup timed out. Try again.',
        );
      }
      if (!registration.active && navigator.serviceWorker.ready) {
        registration = await withTimeout(
          navigator.serviceWorker.ready,
          8_000,
          'Notification setup timed out. Try again.',
        );
      }
      if (!registration?.pushManager) {
        throw new Error('This browser could not start notification delivery.');
      }

      let subscription = await registration.pushManager.getSubscription();
      let createdSubscription = false;
      if (!subscription) {
        const payload = await apiRequest('/api/push/key');
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(payload?.publicKey),
        });
        createdSubscription = true;
      }

      try {
        const serializedSubscription = typeof subscription.toJSON === 'function'
          ? subscription.toJSON()
          : JSON.parse(JSON.stringify(subscription));
        await apiRequest('/api/push/subscribe', {
          method: 'POST',
          body: { subscription: serializedSubscription },
        });
      } catch (error) {
        if (createdSubscription) {
          try {
            await subscription.unsubscribe();
          } catch {
            // Preserve the server error that triggered the rollback.
          }
        }
        throw error;
      }

      return { registration, subscription };
    },
    onSuccess: ({ registration, subscription }) => {
      setPushState({
        kind: subscription ? 'enabled' : 'available',
        registration: registration || null,
        subscription: subscription || null,
        error: null,
      });
    },
    onError: (error) => {
      setPushState((current) => ({
        ...current,
        kind: window.Notification?.permission === 'denied' ? 'blocked' : 'error',
        error,
      }));
    },
  });

  const presentation = pushStatePresentation(pushState.kind);
  const isEnabled = Boolean(pushState.subscription);
  const canChange = ['available', 'enabled', 'error'].includes(pushState.kind);

  const changePushState = () => {
    pushMutation.reset();
    setPushState((current) => ({
      ...current,
      kind: current.subscription ? 'enabled' : 'available',
      error: null,
    }));
    pushMutation.mutate(isEnabled ? 'disable' : 'enable');
  };

  return (
    <>
      <div className="settings-list notification-settings" aria-label="Notification settings">
        <button
          className={`notification-setting is-${pushState.kind}`}
          type="button"
          onClick={changePushState}
          disabled={!canChange || pushMutation.isPending}
          aria-busy={pushMutation.isPending}
          aria-describedby="pushNotificationDescription"
        >
          <span className="setting-icon">
            {isEnabled ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
          </span>
          <span>
            <strong>{pushMutation.isPending ? 'Updating notifications...' : presentation.action}</strong>
            <small id="pushNotificationDescription">{presentation.copy}</small>
          </span>
          <span className={`status-pill notification-status is-${pushState.kind}`}>{presentation.label}</span>
        </button>
      </div>
      {pushState.error ? (
        <ErrorState error={pushState.error} fallback="Could not update browser notifications." />
      ) : null}
    </>
  );
}

function AccountView({ user, onLogout }) {
  const [logoutError, setLogoutError] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await onLogout();
    } catch (error) {
      setLogoutError(error);
      setIsLoggingOut(false);
    }
  };

  return (
    <section aria-labelledby="studentAccountTitle">
      <div className="profile-card">
        <span className="avatar">{initials(user.name)}</span>
        <h3 id="studentAccountTitle">{user.name}</h3>
        <p>{user.email}</p>
        <span className="soft-badge">Student account - {yearLabel(user.year)}</span>
      </div>
      <PushNotificationControl />
      <div className="settings-list">
        <button
          className="danger-row"
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-busy={isLoggingOut}
        >
          <span className="setting-icon"><LogOut aria-hidden="true" /></span>
          <span>
            <strong>{isLoggingOut ? 'Signing out...' : 'Sign out'}</strong>
            <small>Return to the welcome screen</small>
          </span>
        </button>
      </div>
      {logoutError ? (
        <ErrorState error={logoutError} fallback="Could not sign out." />
      ) : null}
    </section>
  );
}

function CircularDetail({ user }) {
  const location = useLocation();
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedReadIds = useRef(new Set());
  const circularId = Number(routeId);
  const validId = Number.isInteger(circularId) && circularId > 0;
  const cachedCircular = validId
    ? queryClient.getQueryData(inboxKey(user.id))?.find(
        (item) => Number(item.id) === circularId,
      )
    : null;

  const detailQuery = useQuery({
    queryKey: ['circular', circularId, Number(user.id)],
    queryFn: async () => {
      const payload = await apiRequest(`/api/circulars/${circularId}`);
      return payload.circular;
    },
    initialData: cachedCircular || undefined,
    enabled: validId,
  });

  const readMutation = useMutation({
    mutationFn: async (id) => apiRequest(`/api/circulars/${id}/read`, {
      method: 'POST',
    }),
    onSuccess: (payload) => {
      const readAt = payload.status?.readAt || new Date().toISOString();
      updateCircularStatus(queryClient, user.id, circularId, {
        ...payload.status,
        readAt,
      });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id) => apiRequest(`/api/circulars/${id}/ack`, {
      method: 'POST',
    }),
    onSuccess: (payload) => {
      updateCircularStatus(queryClient, user.id, circularId, payload?.status);
    },
  });

  const circular = detailQuery.data;
  useEffect(() => {
    if (!circular?.id || circular.readAt || requestedReadIds.current.has(circularId)) return;
    requestedReadIds.current.add(circularId);
    readMutation.mutate(circularId);
  }, [circular?.id, circular?.readAt, circularId, readMutation]);

  if (!validId) return <Navigate to="/student" replace />;

  const targets = Array.isArray(circular?.targets) ? circular.targets : [];
  const urgency = urgencyPresentation(circular?.urgency);
  const acknowledgmentPending = Boolean(
    circular?.requiresAcknowledgment && !circular.acknowledgedAt,
  );

  return (
    <section className="screen app-screen detail-screen screen-active" aria-labelledby="noticeScreenTitle">
      <header className="topbar detail-topbar">
        <button
          className="icon-button"
          type="button"
          onClick={() => navigate({ pathname: '/student', search: new URLSearchParams(location.state?.inboxSearch || '').toString() })}
          aria-label="Back to inbox"
        >
          <ArrowLeft />
        </button>
        <span id="noticeScreenTitle">Official circular</span>
        <a
          className="icon-button"
          href={`/api/circulars/${circularId}/download.txt`}
          download
          aria-label="Download notice as text"
        >
          <Download />
        </a>
      </header>

      <div className="view-scroll detail-content">
        {detailQuery.isPending ? <LoadingCards label="Loading circular" count={1} /> : null}
        {detailQuery.isError ? (
          <ErrorState error={detailQuery.error} fallback="Could not load this circular." />
        ) : null}
        {detailQuery.isSuccess && !circular ? (
          <EmptyState
            title="Circular unavailable"
            copy="This circular could not be found in your authorized inbox."
          />
        ) : null}
        {circular ? (
          <>
            <section className="detail-hero">
              <div className="card-top">
                <span className={`urgency-pill ${urgency.value}`}>{urgency.label}</span>
                <span className="detail-statuses">
                  <time className="card-time" dateTime={circular.createdAt || undefined}>{formatCreatedAt(circular.createdAt)}</time>
                  <span>{circular.readAt ? 'Read' : 'Opening...'}</span>
                </span>
              </div>
              <h1 id="noticeTitle">{circular.title || circular.summary || 'Official circular'}</h1>
              <div className="detail-meta">
                <span>From {circular.faculty?.name || 'Faculty'}</span>
                <span>{targets.map((group) => group.name).join(' - ') || 'Your group'}</span>
              </div>
            </section>
            <p className="notice-body">{circular.text}</p>
            <CircularExtras circular={circular} user={user} />
            {circular.detectedDate ? (
              <div className="event-card circular-event-card">
                <CalendarDays aria-hidden="true" />
                <span>
                  <strong>{formatEventDate(circular.detectedDate)}</strong>
                  <small>{circular.detectedDateText || 'Detected event date'}</small>
                </span>
              </div>
            ) : null}
            {circular.requiresAcknowledgment && circular.acknowledgedAt ? (
              <div className="acknowledged-card circular-acknowledged" role="status">
                <Check aria-hidden="true" />
                <span>
                  <strong>Acknowledged</strong>
                  <small>{formatCreatedAt(circular.acknowledgedAt)}</small>
                </span>
              </div>
            ) : null}
            <div className="detail-actions">
              <a
                className="secondary-button"
                href={`/api/circulars/${circularId}/download.txt`}
                download
              >
                <Download aria-hidden="true" /> Download .txt
              </a>
              {circular.detectedDate ? (
                <a
                  className="secondary-button calendar-export"
                  href={`/api/circulars/${circularId}/calendar.ics`}
                  download
                >
                  <CalendarDays aria-hidden="true" /> Add to calendar
                </a>
              ) : null}
            </div>
            {readMutation.isError ? (
              <ErrorState
                error={readMutation.error}
                fallback="The circular opened, but read status could not be saved."
              />
            ) : null}
          </>
        ) : null}
      </div>
      {acknowledgmentPending ? (
        <aside className="sticky-action acknowledgment-action" aria-labelledby="acknowledgmentTitle">
          <div>
            <strong id="acknowledgmentTitle">Acknowledgment required</strong>
            {acknowledgeMutation.isError ? (
              <small id="acknowledgmentError" role="alert">
                {errorMessage(acknowledgeMutation.error, 'Could not save your acknowledgment.')}
              </small>
            ) : (
              <small id="acknowledgmentDescription">Confirm that you have read this notice.</small>
            )}
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={acknowledgeMutation.isPending}
            aria-busy={acknowledgeMutation.isPending}
            aria-describedby={acknowledgeMutation.isError ? 'acknowledgmentError' : 'acknowledgmentDescription'}
            onClick={() => acknowledgeMutation.mutate(circularId)}
          >
            <Check aria-hidden="true" />
            {acknowledgeMutation.isPending ? 'Acknowledging...' : 'Acknowledge'}
          </button>
        </aside>
      ) : null}
    </section>
  );
}

export default function StudentPortal({ user, onLogout }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return undefined;
    const socket = io({ transports: ['websocket', 'polling'] });
    const refreshInbox = () => {
      queryClient.invalidateQueries({ queryKey: inboxKey(user.id) });
    };
    socket.on('circular:new', refreshInbox);
    return () => {
      socket.off('circular:new', refreshInbox);
      socket.disconnect();
    };
  }, [queryClient, user?.id]);

  return (
    <Suspense fallback={<RouteLoading />}><Routes>
      <Route element={<StudentShell user={user} />}>
        <Route index element={<InboxView user={user} />} />
        <Route path="groups" element={<MembershipView user={user} />} />
        <Route path="campus" element={<CampusFeed user={user} />} />
          <Route path="discussions" element={<Discussions user={user} />} />
        <Route path="events" element={<EventsView user={user} />} />
        <Route path="overview" element={<Overview user={user} />} />
        <Route path="saved" element={<SavedCirculars user={user} />} />
        <Route path="settings" element={<AccountSettings user={user} />} />
        <Route path="check-in" element={<EventCheckIn user={user} />} />
        <Route path="account" element={<AccountView user={user} onLogout={onLogout} />} />
      </Route>
      <Route path="circulars/:id" element={<CircularDetail user={user} />} />
      <Route path="*" element={<Navigate to="/student" replace />} />
    </Routes></Suspense>
  );
}
