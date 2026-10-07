import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, Inbox, CalendarDays, Users, UserRound, FilePenLine, ClipboardList, House, Bookmark, Ellipsis, BarChart3, Layers, Settings, Radio } from 'lucide-react';
import Modal from './Modal.jsx';

type NavigationItem = [string, string, LucideIcon];
export default function PortalNavigation({ role }: { role: 'faculty' | 'student' }) {
  const navigate = useNavigate(), location = useLocation();
  const [more, setMore] = useState(false);
  const base = `/${role}`;
  const items: NavigationItem[] = role === 'faculty' ? [
    ['compose', 'Compose', FilePenLine], ['sent', 'Sent', ClipboardList], ['campus', 'Campus', Sparkles], ['groups', 'Groups', Users],
    ['overview', 'Overview', House], ['workbench', 'Circular studio', Layers], ['events', 'Events', CalendarDays], ['analytics', 'Analytics', BarChart3], ['account', 'Account', UserRound], ['settings', 'Preferences', Settings],
  ] : [
    ['campus', 'Campus', Sparkles], ['', 'Inbox', Inbox], ['events', 'Events', CalendarDays], ['groups', 'Groups', Users],
    ['overview', 'Overview', House], ['saved', 'Saved notices', Bookmark], ['account', 'Account', UserRound], ['settings', 'Preferences', Settings],
  ];
  function itemButton([path, label, Icon]: NavigationItem, index: number, inModal = false) {
    const href = path ? `${base}/${path}` : base;
    const active = path ? location.pathname.startsWith(href) : location.pathname === base;
    return <button className={`${active ? 'active ' : ''}${!inModal && index > 3 ? 'desktop-nav-item' : ''}`} aria-current={active ? 'page' : undefined} type="button" key={path} onClick={() => { navigate(href); setMore(false); }}><Icon /><span>{label}</span></button>;
  }
  return <><nav className={`bottom-nav ${role}-nav`} aria-label={`${role === 'faculty' ? 'Faculty' : 'Student'} navigation`}><div className="nav-brand"><Radio /><span>CampusRelay<small>Your campus, connected</small></span></div>{items.map((item, index) => itemButton(item, index))}<button className="mobile-more" aria-expanded={more} onClick={() => setMore(true)}><Ellipsis /><span>More</span></button></nav><Modal open={more} onClose={() => setMore(false)} title="Your workspace"><div className="more-navigation">{items.slice(4).map((item, index) => itemButton(item, index, true))}</div></Modal></>;
}
