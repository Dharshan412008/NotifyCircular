import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { apiRequest, getErrorMessage } from '../api.js';
import CreateGroupDialog from './CreateGroupDialog.tsx';
import { AcademicCommunity } from './Academics.jsx';

function ErrorMessage({ error }) { return error ? <p className="form-error" role="alert">{getErrorMessage(error)}</p> : null; }
function useRefresh() { const client = useQueryClient(); return () => Promise.all(['group-requests', 'group-governance', 'groups', 'admin', 'community-joins', 'memberships', 'inbox', 'staff-designations', 'group-create-options'].map(key => client.invalidateQueries({ queryKey: [key] }))); }

export function GroupRequests({ role }) {
  const refresh = useRefresh(), [review, setReview] = useState(null);
  const query = useQuery({ queryKey: ['group-requests', role], queryFn: () => apiRequest('/api/community/requests'), refetchInterval: 30000 });
  const reject = useMutation({ mutationFn: id => apiRequest(`/api/community/requests/${id}/review`, { method: 'POST', body: { decision: 'reject' } }), onSuccess: refresh });
  return <section className="academic-panel"><h3>{role === 'admin' ? 'Group requests to review' : 'Your group requests'}</h3><ErrorMessage error={query.error || reject.error} />{query.isPending && <p role="status">Loading requests…</p>}{query.data?.requests.length === 0 && <p>No group requests yet.</p>}{query.data?.requests.map(request => <article className="academic-material" key={request.id}><div><strong>{request.payload.name}</strong><small>{request.facultyName} · {request.payload.category} · {request.payload.department || 'All departments'} · {request.status}</small>{request.note && <p>{request.note}</p>}</div>{role === 'admin' && request.status === 'pending' && <div className="filter-row"><button className="secondary-button" onClick={() => setReview(request)}>Review & approve</button><button className="inline-button" disabled={reject.isPending} onClick={() => reject.mutate(request.id)}>Reject request</button></div>}</article>)}{review && <CreateGroupDialog role="admin" draft={review.payload} requestId={review.id} onClose={() => setReview(null)} />}</section>;
}

function DesignationEditor({ staff }) {
  const refresh = useRefresh();
  const [names, setNames] = useState(staff.designations.join(', ')), [department, setDepartment] = useState(staff.department), [employeeId, setEmployeeId] = useState(staff.employeeId);
  const update = useMutation({ mutationFn: () => apiRequest(`/api/community/staff/${staff.id}/designations`, { method: 'PUT', body: { designations: names.split(',').map(s => s.trim()).filter(Boolean), department, employeeId } }), onSuccess: refresh });
  return <form className="academic-panel" onSubmit={e => { e.preventDefault(); update.mutate(); }}><h4>{staff.name}</h4><p>{staff.email}</p><div className="form-grid-two"><label className="field"><span>Staff ID</span><input value={employeeId} maxLength={50} onChange={e => setEmployeeId(e.target.value)} /></label><label className="field"><span>Staff department</span><input value={department} maxLength={80} onChange={e => setDepartment(e.target.value)} /></label></div><label className="field"><span>Designations (comma separated)</span><input aria-label="Designations (comma separated)" value={names} maxLength={970} onChange={e => setNames(e.target.value)} placeholder="HOD, Assistant Professor, PT" /><small>Multiple designations are allowed. HOD and other labels do not grant additional permissions. PT enables sports-group staff eligibility.</small></label><ErrorMessage error={update.error} /><button className="secondary-button" disabled={update.isPending}>Save staff designations</button>{update.isSuccess && <p role="status">Staff designations saved.</p>}</form>;
}
export function StaffDesignations() {
  const query = useQuery({ queryKey: ['staff-designations'], queryFn: () => apiRequest('/api/community/staff') });
  return <section className="academic-panel"><h3>Staff designations</h3><p>Assign one or more designations to each staff member. Faculty cannot assign these labels to themselves.</p><ErrorMessage error={query.error} />{query.isPending && <p role="status">Loading staff…</p>}{query.data?.staff.map(staff => <DesignationEditor key={staff.id} staff={staff} />)}{query.data?.staff.length === 0 && <p>Create a faculty account in Users first.</p>}</section>;
}

export function GroupManagement({ groupId, role }) {
  const refresh = useRefresh(), [invite, setInvite] = useState(null), [facultyIds, setFacultyIds] = useState([]), [studentManagerId, setStudentManagerId] = useState('');
  const query = useQuery({ queryKey: ['group-governance', groupId], queryFn: () => apiRequest(`/api/community/groups/${groupId}`), refetchInterval: 30000 });
  const options = useQuery({ queryKey: ['group-create-options', 'admin'], queryFn: () => apiRequest('/api/admin/groups/create-options'), enabled: role === 'admin' });
  const signature = JSON.stringify(query.data?.facultyIds || []);
  useEffect(() => { setFacultyIds(JSON.parse(signature)); }, [signature]);
  useEffect(() => { setStudentManagerId(String(query.data?.group.student_manager_id || '')); }, [query.data?.group.student_manager_id]);
  const group = query.data?.group;
  const eligible = (options.data?.faculty || []).filter(f => group?.category === 'sports' ? f.designations.some(d => ['PT', 'PT STAFF', 'PHYSICAL EDUCATION', 'PHYSICAL EDUCATION TEACHER', 'PHYSICAL DIRECTOR'].includes(d.toUpperCase())) : !group?.managerDepartment || f.department.trim().toUpperCase() === group.managerDepartment.trim().toUpperCase());
  const managers = useMutation({ mutationFn: () => apiRequest(`/api/community/groups/${groupId}/managers`, { method: 'PUT', body: { facultyIds: facultyIds.filter(id => eligible.some(f => f.id === id)), studentManagerId: studentManagerId ? Number(studentManagerId) : null } }), onSuccess: refresh });
  const createInvite = useMutation({ mutationFn: async () => {
    const result = await apiRequest(`/api/community/groups/${groupId}/invitations`, { method: 'POST', body: { days: 7 } });
    const url = `${window.location.origin}/join/${result.token}`;
    return { ...result, url, qr: await QRCode.toDataURL(url, { width: 240, margin: 2 }) };
  }, onSuccess: result => { setInvite(result); refresh(); } });
  const revoke = useMutation({ mutationFn: id => apiRequest(`/api/community/invitations/${id}/revoke`, { method: 'POST' }), onSuccess: (_data, id) => { if (invite?.id === id) setInvite(null); refresh(); } });
  const review = useMutation({ mutationFn: ({ id, decision }) => apiRequest(`/api/community/join-requests/${id}/review`, { method: 'POST', body: { decision } }), onSuccess: refresh });
  return <section className="academic-panel"><h4>Invitations & membership approvals</h4><ErrorMessage error={query.error || options.error || managers.error || createInvite.error || revoke.error || review.error} />{query.isPending && <p role="status">Loading group management…</p>}{query.isError && <button className="secondary-button" onClick={() => query.refetch()}>Retry group management</button>}
    {group && <>{role === 'admin' && !group.academic_level && <form onSubmit={e => { e.preventDefault(); managers.mutate(); }}><fieldset className="check-field"><legend>Faculty managers</legend>{eligible.map(f => <label className="check-option" key={f.id}><input type="checkbox" checked={facultyIds.includes(f.id)} onChange={e => setFacultyIds(ids => e.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} /><span>{f.name}<small>{f.department} · {f.designations.join(', ')}</small></span></label>)}{!eligible.length && <p>No eligible faculty. Update staff departments or PT designations first.</p>}</fieldset>{group.category === 'club' && <label className="field"><span>Student club manager (label only)</span><select value={studentManagerId} onChange={e => setStudentManagerId(e.target.value)}><option value="">None</option>{options.data?.students.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><small>This does not grant member management or announcement permissions.</small></label>}<button className="secondary-button" disabled={managers.isPending}>Save group managers</button>{managers.isSuccess && <p role="status">Group managers saved.</p>}</form>}
      {!group.academic_level && ['custom', 'activity'].includes(group.kind) && <><p>Links and QR codes create join requests, not instant memberships. Invitations expire after 7 days and can be revoked.</p><button className="secondary-button" disabled={createInvite.isPending} onClick={() => createInvite.mutate()}>Create invitation & QR code</button>{invite && <div className="group-invite-preview"><label className="field"><span>Invitation link</span><input readOnly value={invite.url} onFocus={e => e.target.select()} /></label><img src={invite.qr} width="240" height="240" alt={`Join request QR code for ${group.name}`} /><a href={invite.qr} download="group-invitation.png">Download QR code</a><small>Expires {new Date(invite.expiresAt).toLocaleString()}</small></div>}{query.data.invitations.map(item => <div className="academic-material" key={item.id}><small>Invitation #{item.id} · {item.revoked_at ? 'Revoked' : new Date(item.expires_at) <= new Date() ? 'Expired' : `Expires ${new Date(item.expires_at).toLocaleDateString()}`}</small>{!item.revoked_at && <button className="inline-button" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Revoke invitation #{item.id}</button>}</div>)}</>}
      <h4>Pending student requests</h4>{query.data.requests.length === 0 && <p>No pending join requests.</p>}{query.data.requests.map(item => <div className="academic-material" key={item.id}><div><strong>{item.name}</strong><small>{item.email}</small></div><div className="filter-row"><button className="secondary-button" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, decision: 'approve' })}>Approve {item.name}</button><button className="inline-button" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, decision: 'reject' })}>Reject {item.name}</button></div></div>)}
    </>}
  </section>;
}

export function StudentCommunities({ user }) {
  const refresh = useRefresh();
  const groups = useQuery({ queryKey: ['groups', user.id], queryFn: () => apiRequest('/api/groups') });
  const joins = useQuery({ queryKey: ['community-joins', user.id], queryFn: () => apiRequest('/api/community/my-joins'), refetchInterval: 15000 });
  const change = useMutation({ mutationFn: ({ id, joined }) => apiRequest('/api/memberships', { method: 'POST', body: { groupId: id, joined } }), onSuccess: refresh });
  return <section>{groups.data?.groups.filter(g => g.kind === 'broadcast' && g.isMember).map(g => <article className="academic-panel" key={g.id}><h3>{g.name}</h3><p>{g.description}</p><Link className="secondary-button" to={`/student/discussions?channel=${g.id}`}>Open college community</Link></article>)}<AcademicCommunity user={user} /><h3>College groups, clubs & sports</h3><p>Your academic communities follow your profile. Other groups require approval to join.</p><ErrorMessage error={groups.error || joins.error || change.error} />{groups.isPending && <p role="status">Loading groups…</p>}{groups.data?.groups.filter(g => !g.academicLevel && (g.isMember || g.joinable) && g.kind !== 'role' && g.kind !== 'broadcast').map(g => {
    const status = joins.data?.requests.find(r => r.group_id === g.id)?.status;
    return <article className="academic-panel" key={g.id}><h4>{g.name}</h4><p>{g.description}</p><small>{g.category}{g.sportsName ? ` · ${g.sportsName}` : ''}</small>{g.isMember ? <p>Member {g.joinable && <button className="inline-button" disabled={change.isPending} onClick={() => change.mutate({ id: g.id, joined: false })}>Leave {g.name}</button>}</p> : <p><button className="secondary-button" disabled={change.isPending || status === 'pending' || status === 'rejected'} onClick={() => change.mutate({ id: g.id, joined: true })}>{status === 'pending' ? 'Awaiting approval' : status === 'rejected' ? 'Request declined' : `Request to join ${g.name}`}</button></p>}</article>;
  })}</section>;
}

export function InvitationJoin({ user }) {
  const { token } = useParams(), refresh = useRefresh(), client = useQueryClient();
  const query = useQuery({ queryKey: ['invitation', token, user.id], queryFn: () => apiRequest(`/api/community/invite/${token}`), enabled: user.role === 'student', retry: false });
  const join = useMutation({ mutationFn: () => apiRequest(`/api/community/invite/${token}`, { method: 'POST' }), onSuccess: () => { refresh(); client.invalidateQueries({ queryKey: ['invitation'] }); } });
  if (user.role !== 'student') return <section className="academic-panel"><h3>Student invitation</h3><p>Open this link while signed in with a student account. Faculty review requests from their Groups screen.</p><Link to={`/${user.role}`}>Return to your portal</Link></section>;
  const status = join.data?.status || query.data?.status;
  return <section className="academic-panel"><h3>{query.data?.name || 'Group invitation'}</h3><ErrorMessage error={query.error || join.error} />{query.isPending && <p role="status">Checking invitation…</p>}{query.data && <><p>Your request must be approved by an assigned faculty manager or administrator.</p>{status === 'member' ? <p>You are already a member.</p> : status === 'pending' ? <p role="status">Your join request is awaiting approval.</p> : status === 'rejected' ? <p>Your request was declined. Contact the group manager.</p> : <button className="primary-button" disabled={join.isPending} onClick={() => join.mutate()}>Request to join group</button>}</>}<Link to="/student/groups">Back to your groups</Link></section>;
}
