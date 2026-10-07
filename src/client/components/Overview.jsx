import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Bell, ArrowUpRight, CalendarDays, CheckCheck, Clock3, FileText, GraduationCap, PenLine, Sparkles, Users } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { apiRequest } from '../api.js';

const amount = (value) => Math.max(0, Number(value) || 0);
const dateLabel = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const titleOf = (notice) => notice.title || notice.summary || notice.text || 'Campus circular';

function Panel({ title, label, onOpen, children, className = '' }) {
  return <section className={`overview-panel ${className}`}>
    <header className="overview-panel-heading"><h3>{title}</h3>{onOpen && <button className="inline-button" onClick={onOpen}>{label || 'View all'}<ArrowUpRight aria-hidden="true" /></button>}</header>
    {children}
  </section>;
}

function QuietEmpty({ icon: Icon = CheckCheck, title, copy }) {
  return <div className="overview-empty"><Icon aria-hidden="true" /><strong>{title}</strong><p>{copy}</p></div>;
}

export default function Overview({ user }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const faculty = user.role === 'faculty';
  const base = faculty ? '/faculty' : '/student';
  const query = useQuery({
    queryKey: ['platform-overview', Number(user.id)],
    queryFn: ({ signal }) => apiRequest('/api/platform/overview', { signal }),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const openNotice = (id) => navigate(`${base}/${faculty ? 'sent' : 'circulars'}/${Number(id)}`);
  const firstName = String(user.name || '').trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (query.isPending) return <div className="overview-loading" role="status" aria-label="Loading your dashboard" aria-busy="true"><div className="skeleton-card overview-hero-skeleton" /><div className="overview-stat-grid">{[0, 1, 2, 3].map((id) => <div className="skeleton-card" key={id} />)}</div><div className="skeleton-card overview-panel-skeleton" /></div>;
  if (query.isError) return <div className="empty-state" role="alert"><Bell /><h3>Your dashboard could not load</h3><p>{query.error.message}</p><button className="secondary-button" onClick={() => query.refetch()}>Try again</button></div>;

  const { stats = {}, notices = [], events = [], posts = [], activity = [] } = query.data || {};
  const metrics = faculty ? [
    { label: 'Circulars sent', value: amount(stats.sent), icon: FileText, tone: 'indigo', path: '/faculty/sent' },
    { label: 'Unique recipients', value: amount(stats.recipients), icon: Users, tone: 'lavender', path: '/faculty/analytics' },
    { label: 'Read rate', value: `${amount(stats.readRate)}%`, icon: CheckCheck, tone: 'mint', path: '/faculty/analytics' },
    { label: 'Pending acknowledgments', value: amount(stats.pending), icon: Clock3, tone: 'coral', path: '/faculty/sent' },
  ] : [
    { label: 'Unread circulars', value: amount(stats.unread), icon: FileText, tone: 'indigo', path: '/student' },
    { label: 'Urgent notices', value: amount(stats.urgent), icon: Bell, tone: 'coral', path: '/student' },
    { label: 'Pending acknowledgments', value: amount(stats.pending), icon: Clock3, tone: 'lavender', path: '/student' },
    { label: 'Upcoming events', value: amount(stats.upcoming), icon: CalendarDays, tone: 'peach', path: '/student/events' },
  ];
  const readRate = Math.min(100, amount(stats.readRate));
  const chartData = [{ name: 'Read', value: readRate }, { name: 'Awaiting read', value: 100 - readRate }];

  return <div className="overview-page">
    <motion.section className="overview-welcome" initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div><span className="overview-eyebrow"><GraduationCap aria-hidden="true" />Your campus, connected</span><h1>{greeting}, {firstName}<span className="greeting-period">.</span></h1><p>{faculty ? 'Keep your students informed. See what needs your attention today.' : 'Your notices, campus moments, and next big opportunities — together.'}</p></div>
      <button className="primary-button signature-button" onClick={() => navigate(`${base}/${faculty ? 'compose' : 'campus'}`)}>{faculty ? <PenLine aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{faculty ? 'Compose circular' : 'Explore campus'}<ArrowUpRight aria-hidden="true" /></button>
    </motion.section>

    <div className="overview-stat-grid">
      {metrics.map(({ label, value, icon: Icon, tone, path }) => <motion.button key={label} className={`overview-stat tone-${tone}`} whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={reduceMotion ? undefined : { scale: 0.99 }} onClick={() => navigate(path)}><span className="stat-icon"><Icon aria-hidden="true" /></span><strong>{value}</strong><span>{label}</span><ArrowUpRight className="stat-arrow" aria-hidden="true" /></motion.button>)}
    </div>

    <div className="overview-grid">
      <Panel title={faculty ? 'Recent circulars' : 'Important notices'} onOpen={() => navigate(faculty ? '/faculty/sent' : '/student')}>
        {notices.length ? <div className="overview-notices">{notices.slice(0, 4).map((notice) => <button className="overview-notice" key={notice.id} onClick={() => openNotice(notice.id)}><span className={`notice-indicator ${notice.urgency || 'normal'}`} aria-hidden="true" /><span className="overview-item-copy"><span className="overview-item-meta">{notice.authorName || (faculty ? 'Your circular' : 'Faculty circular')}<time>{dateLabel(notice.createdAt)}</time></span><strong>{titleOf(notice)}</strong><span className="overview-notice-footer">{notice.urgency === 'urgent' && <span className="urgency-pill urgent">Urgent</span>}{notice.requiresAcknowledgment && !notice.acknowledgedAt && !faculty && <span className="target-tag">Acknowledgment needed</span>}{faculty && notice.stats && <span>{amount(notice.stats.read)} of {amount(notice.stats.audience)} read</span>}</span></span><ArrowUpRight aria-hidden="true" /></button>)}</div> : <QuietEmpty title={faculty ? 'Your next circular starts here' : 'You’re all caught up'} copy={faculty ? 'Compose a notice to keep your groups in the loop.' : 'Notices for your groups will appear here.'} />}
      </Panel>

      <Panel title="Upcoming events" onOpen={() => navigate(`${base}/events`)}>
        {events.length ? <div className="overview-events">{events.slice(0, 3).map((event) => {
          const date = new Date(`${event.detectedDate}T12:00:00`);
          return <button className="overview-event" key={event.id} onClick={() => openNotice(event.id)}><time className="mini-event-date" dateTime={event.detectedDate}><span>{Number.isNaN(date.getTime()) ? 'EVENT' : date.toLocaleDateString(undefined, { month: 'short' })}</span><strong>{Number.isNaN(date.getTime()) ? '–' : date.getDate()}</strong></time><span className="overview-item-copy"><strong>{titleOf(event)}</strong><small>{event.eventLocation || event.location || event.authorName || 'Campus event'}</small></span><ArrowUpRight aria-hidden="true" /></button>;
        })}</div> : <QuietEmpty icon={CalendarDays} title="Room for something new" copy="Dates from your circulars will appear here automatically." />}
      </Panel>

      <Panel title="Campus highlights" onOpen={() => navigate(`${base}/campus`)}>
        {posts.length ? <div className="overview-highlights">{posts.slice(0, 3).map((post) => <button className="overview-highlight" key={post.id} onClick={() => navigate(`${base}/campus`)}><span className="highlight-avatar" aria-hidden="true">{String(post.authorName || 'Campus').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span><span className="overview-item-copy"><span className="overview-item-meta">{post.authorName || 'Campus member'}<time>{dateLabel(post.createdAt)}</time></span><p>{post.caption}</p><span className={`campus-topic-badge topic-${post.topic || 'general'}`}>{post.topic || 'general'}</span></span></button>)}</div> : <QuietEmpty icon={Sparkles} title="Start a campus conversation" copy="Share an achievement, an opportunity, or a moment from your day." />}
      </Panel>

      {faculty ? <Panel title="Communication at a glance" className="overview-engagement">
        {amount(stats.sent) ? <><div className="engagement-chart" role="img" aria-label={`${readRate}% read rate; ${amount(stats.acknowledgmentRate)}% acknowledgment rate`}><ResponsiveContainer width="100%" height={190}><PieChart><Pie data={chartData} dataKey="value" innerRadius={65} outerRadius={82} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={!reduceMotion}><Cell fill="var(--primary)" /><Cell fill="var(--surface-3)" /></Pie></PieChart></ResponsiveContainer><div className="engagement-chart-label"><strong>{readRate}%</strong><span>read rate</span></div></div><div className="engagement-facts"><span><strong>{amount(stats.acknowledgmentRate)}%</strong>Acknowledgment rate</span><span><strong>{amount(stats.groups)}</strong>Active groups</span></div><button className="secondary-button" onClick={() => navigate('/faculty/analytics')}>Explore analytics<ArrowUpRight aria-hidden="true" /></button></> : <QuietEmpty icon={Users} title="See your communication’s impact" copy="Delivery and acknowledgment insights appear after your first circular." />}
      </Panel> : <Panel title="Recent activity">
        {activity.length ? <ol className="overview-activity">{activity.slice(0, 5).map((item) => <li key={item.id}><span className="activity-dot" aria-hidden="true" /><div>{typeof item.href === 'string' && item.href.startsWith(`${base}/`) ? <button className="activity-link" onClick={() => navigate(item.href)}>{item.title}</button> : <strong>{item.title}</strong>}{item.message && <p>{item.message}</p>}<time>{dateLabel(item.createdAt)}</time></div></li>)}</ol> : <QuietEmpty icon={Clock3} title="A fresh start" copy="Your latest circular and campus activity will appear here." />}
      </Panel>}
    </div>
  </div>;
}
