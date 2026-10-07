import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { z } from 'zod';
import { apiRequest } from '../api';
import type { SessionUser } from '../contracts';

const count = z.number().int().nonnegative();
const schema = z.object({
  days: count, since: z.string(), until: z.string(),
  summary: z.object({ sent: count, recipientOpportunities: count, uniqueRecipients: count, read: count, required: count, acknowledged: count, pendingRead: count, pendingAcknowledgments: count, readRate: count, acknowledgmentRate: count }),
  daily: z.array(z.object({ date: z.string(), sent: count, recipients: count, read: count })),
  categories: z.array(z.object({ category: z.string(), sent: count })),
  circulars: z.array(z.object({ id: count, title: z.string(), createdAt: z.string(), category: z.string(), audience: count, read: count, pendingAcknowledgments: count })),
});

export default function Analytics({ user }: { user: SessionUser }) {
  const [days, setDays] = useState(30);
  const query = useQuery({ queryKey: ['faculty-analytics', user.id, days], queryFn: async ({ signal }) => schema.parse(await apiRequest(`/api/platform/analytics?days=${days}`, { signal })), refetchInterval: 60_000 });
  const data = query.data;
  return <section className="overview-page analytics-page" aria-labelledby="analytics-title">
    <div className="section-heading"><div><p className="overline">Understand your communication</p><h1 id="analytics-title">Circular analytics</h1></div><label className="field"><span>Reporting period</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label></div>
    <p className="view-intro">Your sent circulars, measured against their current eligible recipients. Dates use UTC; membership changes update these totals.</p>
    {query.isPending && <div className="skeleton-card" role="status">Loading analytics…</div>}
    {query.isError && <div role="alert"><p>{query.error.message}</p><button className="secondary-button" onClick={() => query.refetch()}>Retry analytics</button></div>}
    {data && <>
      <div className="overview-stat-grid">{[
        ['Circulars sent', data.summary.sent], ['Unique recipients', data.summary.uniqueRecipients], ['Read rate', `${data.summary.readRate}%`], ['Pending acknowledgments', data.summary.pendingAcknowledgments],
      ].map(([label, value]) => <article className="overview-stat" key={label}><strong>{value}</strong><span>{label}</span></article>)}</div>
      {!data.summary.sent ? <div className="empty-state"><h3>No circulars in this period</h3><p>Choose a longer period or publish your first circular.</p><Link className="primary-button" to="/faculty/compose">Compose circular</Link></div> : <>
        <div className="overview-grid"><section className="settings-card"><h3>Daily circulars</h3><p>Publication date, including days with no activity.</p><div role="img" aria-label={`${data.summary.sent} circulars sent during the last ${days} days`}><ResponsiveContainer width="100%" height={240}><BarChart data={data.daily}><XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={30} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="sent" name="Circulars sent" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
        <section className="settings-card"><h3>Recipient response</h3><p>{data.summary.read} of {data.summary.recipientOpportunities} recipient–circular pairs have been read.</p><progress max={100} value={data.summary.readRate} aria-label="Read rate" /><p>{data.summary.acknowledged} of {data.summary.required} required acknowledgments received.</p><progress max={100} value={data.summary.acknowledgmentRate} aria-label="Acknowledgment rate" /><h4>By category</h4>{data.categories.map((item) => <p key={item.category}>{item.category}: <strong>{item.sent}</strong></p>)}</section></div>
        <section className="settings-card"><h3>Circular performance</h3><p>Latest 100 circulars in the selected period. Totals above include the entire period.</p><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th scope="col">Circular</th><th scope="col">Recipients</th><th scope="col">Read</th><th scope="col">Pending acknowledgment</th></tr></thead><tbody>{data.circulars.map((item) => <tr key={item.id}><th scope="row"><Link to={`/faculty/sent/${item.id}`}>{item.title}</Link><small>{item.createdAt.slice(0, 10)} · {item.category}</small></th><td>{item.audience}</td><td>{item.read}</td><td>{item.pendingAcknowledgments}</td></tr>)}</tbody></table></div></section>
      </>}
    </>}
  </section>;
}
