import { useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, LayoutList, MapPin, Users } from 'lucide-react';

const localKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || localKey(date) !== value ? null : date;
};
const titleOf = (event) => event.title || event.summary || event.text || 'Campus event';
const categoryOf = (event) => event.category || event.eventCategory || 'Campus';
const timeOf = (event) => event.eventTime || event.time || event.detectedTime || '';
const locationOf = (event) => event.eventLocation || event.location || '';
const ranges = [['upcoming', 'Upcoming'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['past', 'Past']];

function googleCalendarUrl(event) {
  const start = parseDate(event.detectedDate);
  if (!start) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: titleOf(event), dates: `${localKey(start).replaceAll('-', '')}/${localKey(end).replaceAll('-', '')}`, details: event.text || event.summary || '', location: locationOf(event) });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function EventCard({ event, onOpen }) {
  const date = parseDate(event.detectedDate);
  return <article className="event-item aurora-event-card">
    <time className="event-date" dateTime={event.detectedDate}><span>{date.toLocaleDateString(undefined, { month: 'short' })}</span><strong>{date.getDate()}</strong><span>{date.getFullYear()}</span></time>
    <div className="event-content">{event.detectedDate === localKey(new Date()) && <span className="target-tag">Today</span>}{event.requiresAcknowledgment && !event.acknowledgedAt && <span className="ack-pill">Acknowledgment required</span>}<span className="event-category">{categoryOf(event)}</span><h4>{titleOf(event)}</h4><div className="event-metadata">{timeOf(event) && <span><Clock3 aria-hidden="true" />{timeOf(event)}</span>}{locationOf(event) && <span><MapPin aria-hidden="true" />{locationOf(event)}</span>}{(event.authorName || event.facultyName) && <span><Users aria-hidden="true" />{event.authorName || event.facultyName}</span>}</div></div>
    <div className="event-actions"><button className="secondary-button" onClick={() => onOpen?.(event)}>Open circular<ArrowUpRight aria-hidden="true" /></button><a className="secondary-button calendar-export" href={`/api/circulars/${Number(event.id)}/calendar.ics`} download><Download aria-hidden="true" />Calendar file</a><a className="inline-button" href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">Google Calendar<ArrowUpRight aria-hidden="true" /></a></div>
  </article>;
}

export default function EventCalendar({ events = [], onOpen }) {
  const [view, setView] = useState('list');
  const [range, setRange] = useState('upcoming');
  const [category, setCategory] = useState('all');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState('');
  const today = localKey(new Date());
  const categories = useMemo(() => [...new Set(events.filter((event) => parseDate(event.detectedDate)).map(categoryOf))].sort(), [events]);
  const filtered = useMemo(() => {
    const now = parseDate(today);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (now.getDay() + 6) % 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return events.filter((event) => {
      const date = parseDate(event.detectedDate);
      if (!date || (category !== 'all' && categoryOf(event) !== category)) return false;
      if (range === 'today') return event.detectedDate === today;
      if (range === 'week') return date >= weekStart && date < weekEnd;
      if (range === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      return range === 'past' ? event.detectedDate < today : event.detectedDate >= today;
    }).sort((left, right) => range === 'past' ? right.detectedDate.localeCompare(left.detectedDate) : left.detectedDate.localeCompare(right.detectedDate));
  }, [events, category, range, today]);
  const days = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - (first.getDay() + 6) % 7);
    return Array.from({ length: 42 }, (_, offset) => {
      const date = new Date(first);
      date.setDate(date.getDate() + offset);
      return { date, key: localKey(date) };
    });
  }, [month]);
  const selectedEvents = selectedDate ? filtered.filter((event) => event.detectedDate === selectedDate) : [];
  const changeMonth = (amount) => { setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1)); setSelectedDate(''); };

  return <section className="event-calendar-page" aria-labelledby="events-page-title">
    <div className="page-heading"><div><p className="overline">Plan your campus week</p><h1 id="events-page-title">Events & deadlines</h1><p className="view-intro">Important dates from the circulars shared with you.</p></div><div className="view-switch" aria-label="Event layout"><button aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList aria-hidden="true" />List</button><button aria-pressed={view === 'calendar'} className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays aria-hidden="true" />Calendar</button></div></div>
    <div className="event-filter-toolbar"><div className="filter-row" aria-label="Event date range">{ranges.map(([key, label]) => <button key={key} className={range === key ? 'active' : ''} aria-pressed={range === key} onClick={() => { setRange(key); setSelectedDate(''); if (key === 'today' || key === 'month' || key === 'week') setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); }}>{label}</button>)}</div><label className="event-category-select"><span className="sr-only">Event category</span><select aria-label="Event category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div>
    <p className="collection-note" role="status">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}{category !== 'all' ? ` · ${category}` : ''}</p>
    {view === 'calendar' && <div className="calendar-panel"><div className="calendar-month-heading"><h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><div><button className="icon-button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft /></button><button className="secondary-button" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSelectedDate(today); }}>Today</button><button className="icon-button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight /></button></div></div><div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid" aria-label="Monthly events">{days.map(({ date, key }) => {
      const dayEvents = filtered.filter((event) => event.detectedDate === key);
      return <button className={`calendar-day${date.getMonth() !== month.getMonth() ? ' outside-month' : ''}${key === today ? ' is-today' : ''}${key === selectedDate ? ' selected' : ''}`} key={key} onClick={() => setSelectedDate(key)} aria-label={`${date.toLocaleDateString(undefined, { dateStyle: 'full' })}, ${dayEvents.length} events`} aria-pressed={key === selectedDate}><span>{date.getDate()}</span>{dayEvents.slice(0, 2).map((event) => <span className="calendar-event-label" key={event.id}>{titleOf(event)}</span>)}{dayEvents.length > 2 && <small>+{dayEvents.length - 2} more</small>}</button>;
    })}</div>{selectedDate && <div className="calendar-day-agenda"><h3>{parseDate(selectedDate).toLocaleDateString(undefined, { dateStyle: 'full' })}</h3>{selectedEvents.length ? selectedEvents.map((event) => <EventCard key={event.id} event={event} onOpen={onOpen} />) : <p className="view-intro">No events match your filters on this day.</p>}</div>}</div>}
    {view === 'list' && (filtered.length ? <div className="events-list">{filtered.map((event) => <EventCard key={event.id} event={event} onOpen={onOpen} />)}</div> : <div className="empty-state" role="status"><span className="empty-icon"><CalendarDays aria-hidden="true" /></span><h3>Your calendar has some breathing room</h3><p>No events match this view. Try another date range or category.</p>{category !== 'all' && <button className="secondary-button" onClick={() => setCategory('all')}>Clear category filter</button>}</div>)}
  </section>;
}
