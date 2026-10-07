import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ClipboardList, Copy, Download, FilePlus2, Paperclip, Pin, QrCode, RefreshCw, Save, Send, Sparkles, Trash2, X } from 'lucide-react';
import { apiRequest, getErrorMessage } from '../api.js';
import Modal from './Modal.jsx';

const ROOT = '/api/circular-tools';
const CATEGORIES = ['academic', 'examination', 'placement', 'event', 'scholarship', 'sports', 'club', 'emergency', 'general'];
const PRIORITIES = ['normal', 'important', 'urgent', 'emergency'];
const blank = () => ({ title: '', text: '', category: 'general', priority: 'normal', targetGroupIds: [], attachmentIds: [], requiresAcknowledgment: false, detectedDate: '', eventTime: '', location: '', deadline: '', pinnedUntil: '' });
const label = (value) => value ? value[0].toUpperCase() + value.slice(1) : '';
const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
const localInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const normalized = (form) => ({ ...form, detectedDate: form.detectedDate || null, eventTime: form.eventTime || null, deadline: form.deadline || null, pinnedUntil: form.pinnedUntil || null });

function Message({ error, children }) {
  if (!error && !children) return null;
  return <p className={error ? 'form-error' : 'form-success'} role={error ? 'alert' : 'status'}>{error ? getErrorMessage(error) : children}</p>;
}

function MetadataFields({ form, setForm, eventDate = true }) {
  const update = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  return <>
    <label className="field"><span>Circular title</span><input value={form.title} onChange={update('title')} maxLength={240} placeholder="A clear headline for your campus" /></label>
    <div className="form-grid-two">
      <label className="field"><span>Category</span><select value={form.category} onChange={update('category')}>{CATEGORIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label className="field"><span>Priority</span><select value={form.priority} onChange={update('priority')}>{PRIORITIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    </div>
    <div className="form-grid-two">
      {eventDate && <label className="field"><span>Event date</span><input type="date" value={form.detectedDate || ''} onChange={(event) => setForm((previous) => ({ ...previous, detectedDate: event.target.value, ...(!event.target.value ? { eventTime: '' } : {}) }))} /></label>}
      <label className="field"><span>Event time</span><input type="time" value={form.eventTime || ''} disabled={!form.detectedDate} onChange={update('eventTime')} /></label>
      <label className="field"><span>Application deadline</span><input type="date" value={form.deadline || ''} onChange={update('deadline')} /></label>
      <label className="field"><span>Pin through</span><input type="date" value={form.pinnedUntil || ''} onChange={update('pinnedUntil')} /></label>
    </div>
    <label className="field"><span>Location or meeting link</span><input value={form.location || ''} maxLength={240} onChange={update('location')} placeholder="Auditorium, room number, or meeting URL" /></label>
  </>;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this file. Please select it again.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

export default function CircularWorkbench({ user }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('create');
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [attachmentNames, setAttachmentNames] = useState({});
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState(null);
  const [review, setReview] = useState(null);
  const [sendAt, setSendAt] = useState('');
  const [selectedCircular, setSelectedCircular] = useState(null);
  const [offset, setOffset] = useState(0);
  const queryKey = ['circular-workbench', user.id];
  const templates = useQuery({ queryKey: [...queryKey, 'templates'], queryFn: () => apiRequest(`${ROOT}/templates`) });
  const items = useQuery({ queryKey: [...queryKey, 'items', offset], queryFn: () => apiRequest(`${ROOT}/items?offset=${offset}`), refetchInterval: 15000 });
  const groups = useQuery({ queryKey: ['groups', 'faculty', user.id], queryFn: () => apiRequest('/api/groups') });
  const sent = useQuery({ queryKey: ['faculty-circulars', user.id], queryFn: () => apiRequest('/api/circulars?limit=100'), enabled: tab === 'published' });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['faculty-circulars'] });
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };
  const mutate = useMutation({ mutationFn: ({ path, method = 'POST', body }) => apiRequest(`${ROOT}${path}`, { method, body }), onSuccess: refresh });
  const upload = useMutation({
    mutationFn: async (file) => {
      const limit = templates.data?.maxAttachmentBytes || 5 * 1024 * 1024;
      if (file.size > limit) throw new Error(`Each attachment must be ${Math.floor(limit / 1024 / 1024)} MB or smaller.`);
      if (form.attachmentIds.length >= 5) throw new Error('You can attach up to five files.');
      return apiRequest(`${ROOT}/attachments`, { method: 'POST', body: { name: file.name, data: await readFile(file) } });
    },
    onSuccess: ({ attachment }) => {
      setForm((previous) => ({ ...previous, attachmentIds: [...previous.attachmentIds, attachment.id] }));
      setAttachmentNames((previous) => ({ ...previous, [attachment.id]: attachment.name }));
      setMessage(`${attachment.name} is attached.`);
    },
  });
  const suggest = useMutation({
    mutationFn: () => apiRequest(`${ROOT}/suggest`, { method: 'POST', body: { text: form.text } }),
    onSuccess: ({ suggestions }) => {
      setForm((previous) => ({ ...previous, title: previous.title || suggestions.title, category: suggestions.category, priority: suggestions.priority, detectedDate: previous.detectedDate || suggestions.detectedDate || '', deadline: previous.deadline || suggestions.deadline || '', requiresAcknowledgment: suggestions.requiresAcknowledgment, targetGroupIds: previous.targetGroupIds.length ? previous.targetGroupIds : (suggestions.suggestedGroups || []).map((group) => Number(group.id)).filter((id) => Number.isInteger(id) && id > 0) }));
      setMessage('Suggestions applied. Review the category, priority, date, and audience before sending.');
    },
  });
  const busy = mutate.isPending || upload.isPending || suggest.isPending;
  const clearFeedback = () => { setMessage(''); setLocalError(null); mutate.reset(); upload.reset(); suggest.reset(); };
  const reset = () => { setForm(blank()); setEditingId(null); setSendAt(''); clearFeedback(); };
  const load = (item, asCopy = false) => {
    clearFeedback();
    setForm({ ...blank(), ...item.payload });
    setEditingId(item.builtin || item.kind === 'template' || asCopy || item.status === 'sent' ? null : item.id);
    setSendAt(localInput(item.sendAt));
    setTab('create');
    setMessage(item.status === 'scheduled' && !asCopy ? 'This circular is still scheduled. Save changes or cancel it from Drafts & schedules.' : `Loaded ${item.name}. Review and complete the fields below.`);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };
  const save = async (kind) => {
    clearFeedback();
    try {
      if (kind === 'scheduled' && (!sendAt || !Number.isFinite(new Date(sendAt).getTime()) || new Date(sendAt) <= new Date())) throw new Error('Choose a future date and time for delivery.');
      const payload = normalized(form);
      const itemId = kind === 'template' ? null : editingId;
      const result = await mutate.mutateAsync({ path: itemId ? `/items/${itemId}` : '/items', method: itemId ? 'PUT' : 'POST', body: { kind, name: (form.title || 'Untitled circular').slice(0, 120), payload, ...(kind === 'scheduled' ? { sendAt: new Date(sendAt).toISOString() } : {}) } });
      if (kind !== 'template') setEditingId(result.item.id);
      setMessage(kind === 'scheduled' ? `Scheduled for ${dateTime(result.item.sendAt)}. The server will deliver it while running.` : kind === 'template' ? 'Saved to your reusable templates.' : 'Draft saved. You can safely return to it later.');
      setReview(null);
    } catch (error) { setLocalError(error); }
  };
  const sendNow = async () => {
    clearFeedback();
    try {
      // Persist a work item first so retries use its id and cannot send duplicates.
      let itemId = editingId;
      if (!itemId) {
        const saved = await mutate.mutateAsync({ path: '/items', body: { kind: 'draft', name: (form.title || 'Untitled circular').slice(0, 120), payload: normalized(form) } });
        itemId = saved.item.id;
        setEditingId(itemId);
      }
      const result = await mutate.mutateAsync({ path: '/send', body: { itemId, payload: normalized(form) } });
      setReview(null);
      setEditingId(null);
      setForm(blank());
      setMessage(`Circular sent to ${result.circular.stats?.audienceCount ?? result.circular.stats?.audience ?? 'your selected'} recipients.`);
      setTab('published');
    } catch (error) { setLocalError(error); }
  };
  const actOnItem = async (item, action) => {
    clearFeedback();
    try {
      await mutate.mutateAsync({ path: `/items/${item.id}${action === 'cancel' ? '/cancel' : ''}`, method: action === 'cancel' ? 'POST' : 'DELETE' });
      if (editingId === item.id) setEditingId(null);
      setMessage(action === 'cancel' ? 'Scheduled delivery cancelled.' : 'Saved item deleted.');
    } catch (error) { setLocalError(error); }
  };
  const openReview = (kind) => {
    clearFeedback();
    if (form.text.trim().length < 5 || !form.targetGroupIds.length) {
      setLocalError(new Error('Write a message of at least five characters and select at least one audience group.'));
      return;
    }
    setReview(kind);
  };
  const selectedGroups = (groups.data?.groups || []).filter((group) => form.targetGroupIds.includes(group.id));

  return <section className="workbench-page" aria-labelledby="workbench-title">
    <header className="section-heading workbench-heading"><div><p className="overline">Plan. Publish. Connect.</p><h2 id="workbench-title">Circular studio</h2><p>Prepare announcements, schedule delivery, and check in your event audience.</p></div><Sparkles aria-hidden="true" /></header>
    <nav className="workbench-tabs filter-row" aria-label="Circular studio views">
      {[['create', 'Create'], ['saved', 'Drafts & schedules'], ['templates', 'Templates'], ['published', 'Published']].map(([value, text]) => <button key={value} type="button" className={`filter-chip ${tab === value ? 'active' : ''}`} aria-pressed={tab === value} onClick={() => setTab(value)}>{text}</button>)}
    </nav>
    <Message error={localError || mutate.error || upload.error || suggest.error}>{message}</Message>
    {tab === 'create' && <div className="workbench-layout">
      <form className="form-stack workbench-editor" onSubmit={(event) => { event.preventDefault(); openReview('send'); }}>
        <div className="workbench-section-heading"><h3>{editingId ? 'Edit saved circular' : 'Create a circular'}</h3><button type="button" className="text-button" disabled={busy} onClick={() => setReview('reset')}><FilePlus2 aria-hidden="true" />Start fresh</button></div>
        <fieldset disabled={busy} className="workbench-fields form-stack">
          <label className="field"><span>Message</span><textarea rows={7} value={form.text} maxLength={5000} placeholder="Share the details your students need: what, when, where, and the next step." onChange={(event) => setForm((previous) => ({ ...previous, text: event.target.value }))} /><small>{form.text.length}/5,000 characters</small></label>
          <button type="button" className="secondary-button" disabled={form.text.trim().length < 5} onClick={() => { clearFeedback(); suggest.mutate(); }}><Sparkles aria-hidden="true" />{suggest.isPending ? 'Finding suggestions…' : 'Suggest title, priority & audience'}</button>
          <MetadataFields form={form} setForm={setForm} />
          <fieldset className="check-field workbench-audience"><legend>Audience groups</legend>
            {groups.isPending && <p role="status">Loading groups…</p>}
            <Message error={groups.error} />
            {(groups.data?.groups || []).map((group) => <label key={group.id} className="workbench-group-option"><input type="checkbox" checked={form.targetGroupIds.includes(group.id)} onChange={(event) => setForm((previous) => ({ ...previous, targetGroupIds: event.target.checked ? [...previous.targetGroupIds, group.id] : previous.targetGroupIds.filter((id) => id !== group.id) }))} /><span>{group.name}<small>{group.memberCount ?? 0} members</small></span></label>)}
          </fieldset>
          <label className="checkbox-row"><input type="checkbox" checked={form.requiresAcknowledgment} onChange={(event) => setForm((previous) => ({ ...previous, requiresAcknowledgment: event.target.checked }))} /><span>Require recipients to acknowledge this circular</span></label>
          <div className="workbench-attachments"><label className="field"><span><Paperclip aria-hidden="true" />Attachments</span><input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.webp" disabled={form.attachmentIds.length >= 5} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { clearFeedback(); upload.mutate(file); } }} /><small>Up to 5 files, {Math.floor((templates.data?.maxAttachmentBytes || 5242880) / 1048576)} MB each. PDF, DOCX, PNG, JPEG, or WebP.</small></label>
            {form.attachmentIds.map((id, index) => <div className="workbench-attachment" key={id}><a href={`${ROOT}/attachments/${id}`} download>{attachmentNames[id] || `Saved attachment ${index + 1}`}</a><button type="button" className="icon-button" aria-label={`Remove ${attachmentNames[id] || `attachment ${index + 1}`}`} onClick={() => setForm((previous) => ({ ...previous, attachmentIds: previous.attachmentIds.filter((value) => value !== id) }))}><X aria-hidden="true" /></button></div>)}
          </div>
          <div className="workbench-actions"><button type="button" className="secondary-button" onClick={() => save('draft')}><Save aria-hidden="true" />Save draft</button><button type="button" className="secondary-button" onClick={() => save('template')}><Copy aria-hidden="true" />Save template</button><button type="button" className="secondary-button" onClick={() => openReview('schedule')}><CalendarClock aria-hidden="true" />Schedule</button><button className="primary-button" type="submit"><Send aria-hidden="true" />Review & send</button></div>
        </fieldset>
      </form>
      <aside className="workbench-preview card"><p className="overline">Recipient preview</p><span className="status-badge">{label(form.category)} · {label(form.priority)}</span><h3>{form.title || 'Your circular title'}</h3><p className="workbench-message">{form.text || 'Your announcement will appear here as you write.'}</p>{form.detectedDate && <p>Event: {form.detectedDate}{form.eventTime && ` at ${form.eventTime}`}</p>}{form.location && <p>{form.location}</p>}{form.deadline && <p>Apply by {form.deadline}</p>}{form.pinnedUntil && <p><Pin aria-hidden="true" />Pinned through {form.pinnedUntil}</p>}<p>{selectedGroups.length ? selectedGroups.map((group) => group.name).join(' · ') : 'Choose groups to define who receives this.'}</p><small>{form.attachmentIds.length} attachments{form.requiresAcknowledgment ? ' · Acknowledgment required' : ''}</small></aside>
    </div>}
    {tab === 'saved' && <div className="workbench-library"><div className="workbench-section-heading"><h3>Drafts & scheduled delivery</h3><button type="button" className="icon-button" aria-label="Refresh saved circulars" onClick={() => items.refetch()}><RefreshCw aria-hidden="true" /></button></div><Message error={items.error} />{items.isPending && <p role="status">Loading your saved work…</p>}{items.data?.items.length === 0 && <div className="empty-state"><ClipboardList aria-hidden="true" /><h3>Room for your next idea</h3><p>Save a draft or schedule a circular from the Create tab.</p></div>}
      {items.data?.items.map((item) => <article className="workbench-item card" key={item.id}><div><span className={`status-badge ${item.status}`}>{label(item.status)}</span><h3>{item.name}</h3><p>{item.kind === 'scheduled' ? dateTime(item.sendAt) : `Updated ${dateTime(item.updatedAt)}`}</p>{item.error && <p role="alert" className="form-error">{item.error}</p>}</div><div className="workbench-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => load(item, item.status === 'sent')}>{item.status === 'sent' ? 'Use as new circular' : 'Open'}</button>{item.status === 'scheduled' && <button type="button" className="text-button" disabled={busy} onClick={() => actOnItem(item, 'cancel')}>Cancel delivery</button>}{!['scheduled', 'sent'].includes(item.status) && <button type="button" className="icon-button" disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => setReview({ deleteItem: item })}><Trash2 aria-hidden="true" /></button>}</div></article>)}
      <div className="workbench-actions">{offset > 0 && <button className="secondary-button" type="button" onClick={() => setOffset(Math.max(0, offset - 50))}>Previous page</button>}{items.data?.hasMore && <button className="secondary-button" type="button" onClick={() => setOffset(offset + 50)}>Older saved work</button>}</div>
    </div>}
    {tab === 'templates' && <div className="workbench-library"><h3>A head start for every announcement</h3><p>Choose a ready-made outline or reuse one of your own. Replace the bracketed details before sending.</p><Message error={templates.error} />{templates.isPending && <p role="status">Loading templates…</p>}<div className="workbench-template-grid">{templates.data?.templates.map((item) => <article className="workbench-template card" key={item.id}><span className="status-badge">{item.builtin ? 'Campus essentials' : 'Your template'}</span><h3>{item.name}</h3><p>{item.payload.text}</p><div className="workbench-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => load(item, true)}><Copy aria-hidden="true" />Use template</button>{!item.builtin && <button type="button" className="icon-button" disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => setReview({ deleteItem: item })}><Trash2 aria-hidden="true" /></button>}</div></article>)}</div></div>}
    {tab === 'published' && <div className="workbench-library"><h3>Published circulars</h3><p>Update notice details, pin important announcements, or manage event attendance.</p><Message error={sent.error} />{sent.isPending && <p role="status">Loading published circulars…</p>}{sent.data?.circulars.length === 0 && <div className="empty-state"><Send aria-hidden="true" /><h3>Your first circular starts here</h3><p>Publish from the Create tab to see it here.</p></div>}{sent.data?.circulars.map((circular) => <article className="workbench-item card" key={circular.id}><div><h3>{circular.title || circular.summary}</h3><p>{dateTime(circular.createdAt)}{circular.detectedDate && ` · Event ${circular.detectedDate}`}</p></div><button type="button" className="secondary-button" onClick={() => setSelectedCircular(circular)}><QrCode aria-hidden="true" />Manage details & attendance</button></article>)}</div>}
    <Modal open={Boolean(review)} onClose={() => setReview(null)} title={review === 'schedule' ? 'Schedule circular' : review === 'reset' ? 'Start a new circular?' : review?.deleteItem ? 'Delete saved item?' : 'Review your circular'} eyebrow="Circular studio" dismissible={!busy}>
      {review === 'reset' ? <><p>Your unsaved edits will be cleared. Saved drafts remain in your library.</p><button type="button" className="primary-button" onClick={() => { reset(); setReview(null); }}>Start fresh</button></> : review?.deleteItem ? <><p>Delete “{review.deleteItem.name}” from your library?</p><button type="button" className="primary-button" disabled={busy} onClick={async () => { await actOnItem(review.deleteItem, 'delete'); setReview(null); }}>Delete saved item</button></> : <div className="form-stack"><h4>{form.title || 'Untitled circular'}</h4><p className="workbench-message">{form.text}</p><p><strong>Audience:</strong> {selectedGroups.map((group) => group.name).join(', ')}</p><p>{label(form.priority)} priority · {form.attachmentIds.length} attachments{form.requiresAcknowledgment && ' · Acknowledgment required'}</p>{review === 'schedule' && <label className="field"><span>Delivery date and time (your local time)</span><input type="datetime-local" value={sendAt} onChange={(event) => setSendAt(event.target.value)} /><small>The server must be running at delivery time; missed schedules are delivered after restart.</small></label>}<Message error={localError || mutate.error} /><button className="primary-button" type="button" disabled={busy} onClick={() => review === 'schedule' ? save('scheduled') : sendNow()}>{busy ? 'Saving…' : review === 'schedule' ? 'Confirm schedule' : 'Send circular now'}</button></div>}
    </Modal>
    {selectedCircular && <PublishedCircularManager key={selectedCircular.id} user={user} circular={selectedCircular} onClose={() => setSelectedCircular(null)} onUpdate={refresh} />}
  </section>;
}

function PublishedCircularManager({ circular, user, onClose, onUpdate }) {
  const queryClient = useQueryClient();
  const key = ['circular-tools-details', user.id, circular.id];
  const details = useQuery({ queryKey: key, queryFn: () => apiRequest(`${ROOT}/circulars/${circular.id}/details`) });
  const history = useQuery({ queryKey: [...key, 'history'], queryFn: () => apiRequest(`${ROOT}/circulars/${circular.id}/history`) });
  const attendance = useQuery({ queryKey: [...key, 'attendance'], queryFn: () => apiRequest(`${ROOT}/circulars/${circular.id}/attendance`), enabled: Boolean(circular.detectedDate), refetchInterval: 15000 });
  const [edited, setEdited] = useState(null);
  const [qr, setQr] = useState(null);
  const [minutes, setMinutes] = useState(15);
  const [feedback, setFeedback] = useState('');
  const [copyError, setCopyError] = useState(null);
  const form = edited || { ...blank(), title: circular.summary || '', priority: circular.urgency === 'urgent' ? 'urgent' : 'normal', detectedDate: circular.detectedDate, ...details.data?.details };
  const setForm = (updater) => setEdited(updater(form));
  const mutation = useMutation({ mutationFn: ({ path, method, body }) => apiRequest(`${ROOT}/circulars/${circular.id}${path}`, { method, body }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: key }); onUpdate(); } });
  const saveDetails = async (event) => {
    event.preventDefault(); setFeedback('');
    try { await mutation.mutateAsync({ path: '/details', method: 'PATCH', body: normalized(form) }); setFeedback('Circular details updated. The previous version is kept in revision history.'); } catch { /* Mutation renders the API error. */ }
  };
  const generate = async () => {
    setFeedback('');
    try { const result = await mutation.mutateAsync({ path: '/attendance-token', method: 'POST', body: { ttlMinutes: Number(minutes) } }); setQr(result); setFeedback('New check-in link created. Any earlier link has expired.'); } catch { /* Mutation renders the API error. */ }
  };
  return <Modal open onClose={onClose} title="Details & event attendance" eyebrow={circular.title || circular.summary} dismissible={!mutation.isPending} className="workbench-manager">
    <Message error={details.error || mutation.error || copyError}>{feedback}</Message>
    {details.isPending ? <p role="status">Loading circular details…</p> : details.data && <form className="form-stack" onSubmit={saveDetails}><fieldset className="workbench-fields form-stack" disabled={mutation.isPending}><MetadataFields form={form} setForm={setForm} eventDate={false} /><button className="primary-button" type="submit"><Save aria-hidden="true" />Save details</button></fieldset></form>}
    {details.data?.details.attachments?.length > 0 && <div className="workbench-attachments"><h4>Published attachments</h4>{details.data.details.attachments.map((file) => <a key={file.id} href={file.url} download className="secondary-button"><Download aria-hidden="true" />{file.name}</a>)}</div>}
    {circular.detectedDate ? <section className="workbench-attendance"><h4><QrCode aria-hidden="true" />Event check-in</h4><p>Share a temporary link with students in this circular’s audience. Each student can check in once.</p><label className="field"><span>Link lifetime</span><select value={minutes} disabled={mutation.isPending} onChange={(event) => setMinutes(event.target.value)}>{[5, 15, 30, 60, 120].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label><div className="workbench-actions"><button type="button" className="secondary-button" disabled={mutation.isPending} onClick={generate}><QrCode aria-hidden="true" />{qr ? 'Replace check-in link' : 'Create check-in link'}</button>{(qr || details.data?.details.attendanceAvailable) && <button type="button" className="text-button" disabled={mutation.isPending} onClick={async () => { try { await mutation.mutateAsync({ path: '/attendance-token', method: 'DELETE' }); setQr(null); setFeedback('Check-in link revoked.'); } catch { /* Mutation renders the API error. */ } }}>Revoke link</button>}</div>
      {qr && <div className="workbench-qr"><img src={qr.qrDataUrl} width="280" height="280" alt="QR code for student event check-in" /><p>Expires {dateTime(qr.expiresAt)}</p><label className="field"><span>Student check-in link</span><input readOnly value={new URL(qr.checkInPath, window.location.origin).href} onFocus={(event) => event.target.select()} /></label><button className="secondary-button" type="button" onClick={async () => { setCopyError(null); try { await navigator.clipboard.writeText(new URL(qr.checkInPath, window.location.origin).href); setFeedback('Check-in link copied.'); } catch { setCopyError(new Error('Select and copy the check-in link from the field above.')); } }}><Copy aria-hidden="true" />Copy link</button></div>}
      <div className="workbench-section-heading"><h4>{attendance.data?.total || 0} checked in</h4><button type="button" className="icon-button" aria-label="Refresh attendance" onClick={() => attendance.refetch()}><RefreshCw aria-hidden="true" /></button></div><Message error={attendance.error} />{attendance.data?.attendance.map((entry) => <div className="workbench-attendee" key={entry.studentId}><strong>{entry.name}</strong><span>{entry.email}</span><small>{dateTime(entry.checkedInAt)}</small></div>)}{attendance.data?.total === 0 && <p>No check-ins yet. Attendance refreshes every 15 seconds.</p>}
    </section> : <p>Add an event date when creating a circular to enable event check-in.</p>}
    <details className="workbench-history"><summary>Revision history ({history.data?.revisions.length || 0})</summary><Message error={history.error} />{history.data?.revisions.length === 0 && <p>No revisions yet.</p>}{history.data?.revisions.map((entry) => <div key={entry.id}><strong>{dateTime(entry.createdAt)}</strong><p>Previous title: {entry.previous.title || circular.summary} · {label(entry.previous.priority || 'normal')}{entry.previous.pinnedUntil && ` · Pinned through ${entry.previous.pinnedUntil}`}</p></div>)}</details>
  </Modal>;
}

export function EventCheckIn({ user }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const key = ['event-check-in', user.id, token];
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: key, queryFn: () => apiRequest(`${ROOT}/attendance/preview`, { method: 'POST', body: { token } }), enabled: token.length === 43, retry: false });
  const checkIn = useMutation({ mutationFn: () => apiRequest(`${ROOT}/attendance/check-in`, { method: 'POST', body: { token } }), onSuccess: (result) => queryClient.setQueryData(key, (previous) => ({ ...previous, checkedInAt: result.checkedInAt })) });
  const checkedInAt = preview.data?.checkedInAt;
  return <section className="workbench-page workbench-check-in" aria-labelledby="check-in-title"><Link className="text-button" to="/student">Back to inbox</Link><div className="card"><QrCode aria-hidden="true" /><p className="overline">Campus events</p><h2 id="check-in-title">Event check-in</h2>{token.length !== 43 ? <p role="alert">Open the check-in link or scan the QR code provided by your faculty member.</p> : preview.isPending ? <p role="status">Checking your event invitation…</p> : <><Message error={preview.error || checkIn.error} />{preview.data?.circular && <><h3>{preview.data.circular.title || preview.data.circular.summary}</h3><p className="workbench-message">{preview.data.circular.text}</p><p>Event date: {preview.data.circular.detectedDate}</p>{checkedInAt ? <p className="form-success" role="status"><CheckCircle2 aria-hidden="true" />You’re checked in, {user.name}. Recorded {dateTime(checkedInAt)}.</p> : <><p>Check in as <strong>{user.name}</strong>. This link expires {dateTime(preview.data.expiresAt)}.</p><button type="button" className="primary-button" disabled={checkIn.isPending} onClick={() => checkIn.mutate()}><CheckCircle2 aria-hidden="true" />{checkIn.isPending ? 'Checking in…' : 'Confirm my attendance'}</button></>}</>}</>}</div></section>;
}
