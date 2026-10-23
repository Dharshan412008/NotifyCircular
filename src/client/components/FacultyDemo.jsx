import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PortalThemeButton from './PortalThemeButton';

const groups = [
  { id: 'whole', name: 'Whole College', members: 240 },
  { id: 'first', name: 'First Year', members: 60 },
  { id: 'robotics', name: 'Robotics Club', members: 24 },
];
const initialCirculars = [
  { id: 1, title: 'Welcome to the new semester', text: 'Sample circular: orientation begins at 9 AM in the auditorium.', group: 'Whole College', read: 180, audience: 240 },
  { id: 2, title: 'Robotics workshop', text: 'Sample circular: bring your project ideas to the lab on Friday.', group: 'Robotics Club', read: 18, audience: 24 },
];

export default function FacultyDemo({ user, onLogout }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('Compose');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState('whole');
  const [circulars, setCirculars] = useState(initialCirculars);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  function send(event) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) return;
    const group = groups.find((item) => item.id === target);
    setCirculars((items) => [{ id: Date.now(), title: title.trim(), text: text.trim(), group: group.name, read: 0, audience: group.members }, ...items]);
    setTitle(''); setText(''); setTab('Sent');
    setNotice('Demo circular added. No real recipients were notified.');
  }
  async function logout() {
    setBusy(true);
    try { await onLogout(); } catch { setNotice('Could not sign out. Please try again.'); } finally { setBusy(false); }
  }
  return <section className="screen app-screen screen-active" aria-label="Faculty demo">
    <header className="app-topbar"><div><p className="overline">Sample workspace</p><h2>Faculty demo</h2></div><PortalThemeButton /></header>
    <div className="view-scroll">
      <section className="settings-card">
        <p>Welcome, {user.name}. Try composing circulars, viewing delivery reports, and exploring groups using sample data.</p>
        <p className="collection-note">Your account remains a student account. Demo changes reset when you leave or reload this page.</p>
        <div className="filter-row"><button className="secondary-button" onClick={() => navigate('/student')}>Back to Student portal</button><button className="inline-button" disabled={busy} onClick={logout}>{busy ? 'Signing out…' : 'Sign out'}</button></div>
      </section>
      <nav className="filter-row" aria-label="Faculty demo navigation">{['Compose', 'Sent', 'Groups', 'Reports'].map((name) => <button key={name} className={tab === name ? 'active' : ''} aria-pressed={tab === name} onClick={() => { setTab(name); setNotice(''); }}>{name}</button>)}</nav>
      {notice && <p className="collection-note" role="status">{notice}</p>}
      {tab === 'Compose' && <section className="settings-card"><h3>Compose a demo circular</h3><form className="form-stack" onSubmit={send}>
        <label className="field"><span>Circular title</span><input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field"><span>Message</span><textarea required maxLength={5000} rows={5} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <label className="field"><span>Target group</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <button className="primary-button" type="submit">Send demo circular</button>
      </form></section>}
      {tab === 'Sent' && <section className="tab-view"><h3>Demo sent circulars</h3>{circulars.map((item) => <article className="settings-card" key={item.id}><h4>{item.title}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p><p className="collection-note">{item.group} · {item.audience} sample recipients</p></article>)}</section>}
      {tab === 'Groups' && <section className="tab-view"><h3>Demo groups</h3>{groups.map((group) => <article className="settings-card" key={group.id}><h4>{group.name}</h4><p>{group.members} sample members</p></article>)}</section>}
      {tab === 'Reports' && <section className="tab-view"><h3>Demo delivery reports</h3><p>Illustrative counts for the sample circulars.</p>{circulars.map((item) => <article className="settings-card" key={item.id}><h4>{item.title}</h4><p>{item.read} of {item.audience} sample recipients have read this circular.</p><progress aria-label={`${item.title} read count`} value={item.read} max={item.audience} /></article>)}</section>}
    </div>
  </section>;
}
