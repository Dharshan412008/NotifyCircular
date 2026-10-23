import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import Modal from './Modal';

interface Student { id: number; name: string; email: string; year: number; department: string; section: string; groupIds: number[] }
interface Faculty { id: number; name: string; email: string; department: string; designations: string[] }
interface Options { faculty: Faculty[]; students: Student[]; groups: { id: number; name: string; department: string }[] }
export default function CreateGroupDialog({ role, onClose, draft = {}, requestId }: { role: 'faculty' | 'admin'; onClose: () => void; draft?: Record<string, any>; requestId?: number }) {
  const client = useQueryClient(), uniqueId = useId();
  const endpoint = role === 'admin' ? '/api/admin/groups' : '/api/groups';
  const options = useQuery({ queryKey: ['group-create-options', role], queryFn: ({ signal }) => apiRequest<Options>(`${endpoint}/create-options`, { signal }), staleTime: 0 });
  const [year, setYear] = useState(String(draft.year || '')), [department, setDepartment] = useState(draft.department || ''), [section, setSection] = useState(draft.section || ''), [parent, setParent] = useState(String(draft.parentGroupId || ''));
  const [kind, setKind] = useState(draft.kind || 'custom'), [joinable, setJoinable] = useState(draft.joinable ?? true), [automatic, setAutomatic] = useState(draft.autoAddMatches ?? true);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(draft.memberStudentIds || [])), [search, setSearch] = useState('');
  const students = options.data?.students || [];
  const [category, setCategory] = useState(draft.category || 'community');
  const [facultyIds, setFacultyIds] = useState<number[]>(draft.facultyIds || []);
  const [studentManagerId, setStudentManagerId] = useState(String(draft.studentManagerId || ''));
  const managerDepartment = department.trim() || options.data?.groups.find(g => g.id === Number(parent))?.department || '';
  const eligibleFaculty = (options.data?.faculty || []).filter(f => category === 'sports' ? f.designations.some(d => ['PT','PT STAFF','PHYSICAL EDUCATION','PHYSICAL EDUCATION TEACHER','PHYSICAL DIRECTOR'].includes(d.toUpperCase())) : !managerDepartment || f.department.trim().toLowerCase() === managerDepartment.trim().toLowerCase());
  const normalize = (value: string) => value.trim().toLowerCase();
  const hasFilters = Boolean(year || department.trim() || section.trim() || parent);
  const matching = useMemo(() => students.filter((student) => (!year || student.year === Number(year))
    && (!department.trim() || normalize(student.department) === normalize(department))
    && (!section.trim() || normalize(student.section) === normalize(section))
    && (!parent || student.groupIds.includes(Number(parent)))), [students, year, department, section, parent]);
  const automaticIds = new Set(automatic && hasFilters ? matching.map((student) => student.id) : []);
  const total = new Set([...selected].filter(id => matching.some(s => s.id === id)).concat([...automaticIds])).size;
  const visible = matching.filter((student) => normalize(`${student.name} ${student.email} ${student.department} ${student.section}`).includes(normalize(search)));
  const create = useMutation({
    mutationFn: (form: FormData) => {
      const body = {
        name: form.get('name'), description: form.get('description'), icon: form.get('icon'), kind, joinable, category,
        sportsType: form.get('sportsType') || '', sportsName: form.get('sportsName') || '',
        ...(role === 'admin' ? { facultyIds: facultyIds.filter(id => eligibleFaculty.some(f => f.id === id)) } : {}),
        studentManagerId: category === 'club' && studentManagerId ? Number(studentManagerId) : null,
        year: year ? Number(year) : null, department: department.trim(), section: section.trim(), parentGroupId: parent ? Number(parent) : null,
        autoAddMatches: automatic, memberStudentIds: [...selected].filter(id => matching.some(s => s.id === id)),
      };
      return apiRequest(requestId ? `/api/community/requests/${requestId}/review` : endpoint, { method: 'POST', body: requestId ? { decision: 'approve', group: body } : body });
    },
    onSuccess: async () => { await Promise.all(['groups', 'admin', 'group-create-options', 'group-requests'].map((key) => client.invalidateQueries({ queryKey: [key] }))); onClose(); },
  });
  return <Modal open onClose={onClose} dismissible={!create.isPending} title={role === 'faculty' ? "Request a group" : requestId ? "Approve group request" : "Create a group"} eyebrow="Build your college community">
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
      <fieldset className="group-create-fields" disabled={create.isPending}>
        <label className="field"><span>Group name</span><input name="name" defaultValue={draft.name || ''} required minLength={2} maxLength={80} placeholder="Robotics Club" /></label>
        <label className="field"><span>Description</span><textarea name="description" defaultValue={draft.description || ''} maxLength={240} rows={2} placeholder="What is this group for?" /></label>
        <div className="form-grid-two"><label className="field"><span>Icon or initials</span><input name="icon" defaultValue={draft.icon || 'CR'} maxLength={16} required /></label><label className="field"><span>Group type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="custom">Community / announcement</option><option value="activity">Activity / club</option></select></label></div>
        <label className="check-option"><input type="checkbox" checked={joinable} onChange={(event) => setJoinable(event.target.checked)} /><span>Students can request to join<small>Requests need approval. Turn off to allow invitation requests only.</small></span></label>
        <label className="field"><span>Category</span><select aria-label="Category" value={category} onChange={e => { setCategory(e.target.value); setFacultyIds([]); }}><option value="community">Community / class</option><option value="club">Club</option><option value="sports">Sports</option><option value="exam">Exam Cell / committee</option></select></label>
        {category === 'sports' && <div className="form-grid-two"><label className="field"><span>Sports type</span><input name="sportsType" defaultValue={draft.sportsType || ''} required maxLength={80} placeholder="Indoor / Outdoor" /></label><label className="field"><span>Sports name</span><input name="sportsName" defaultValue={draft.sportsName || ''} required maxLength={80} placeholder="Football" /></label></div>}
        {role === 'faculty' && <p className="collection-note">An administrator must approve this request before the group is created or any students are added.</p>}
        <h4>Choose your audience</h4>
        <div className="form-grid-two"><label className="field"><span>Study year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">All years</option>{[1, 2, 3, 4].map((value) => <option value={value} key={value}>Year {value}</option>)}</select></label><label className="field"><span>Department</span><input list={`${uniqueId}-departments`} maxLength={80} value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="All departments" /></label><label className="field"><span>Section</span><input list={`${uniqueId}-sections`} maxLength={30} value={section} onChange={(event) => setSection(event.target.value)} placeholder="All sections" /></label><label className="field"><span>Parent group</span><select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Standalone group</option>{options.data?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></div>
        <datalist id={`${uniqueId}-departments`}>{[...new Set(students.map((student) => student.department).filter(Boolean))].sort().map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id={`${uniqueId}-sections`}>{[...new Set(students.filter((student) => !department || normalize(student.department) === normalize(department)).map((student) => student.section).filter(Boolean))].sort().map((value) => <option key={value} value={value} />)}</datalist>
        <p className="view-intro">Choose existing department and section suggestions or enter your own. Filters use current student profiles.</p>
        <label className="check-option"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} /><span>Add students matching these filters<small>{hasFilters ? `${matching.length} students match. This adds them once when the group is created.` : 'Set a year, department, section, or parent group to use this option.'}</small></span></label>
        <fieldset className="check-field"><legend>Select individual students</legend><p className="view-intro">Student profiles must match the chosen audience. Turn off automatic additions to select matching members individually.</p><label className="field"><span>Search members</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, department or section" /></label>
          {options.isPending && <p role="status">Loading students…</p>}{options.isError && <div role="alert"><p>{options.error.message}</p><button type="button" className="secondary-button" onClick={() => options.refetch()}>Retry members</button></div>}
          <div className="member-chip-grid">{visible.map((student) => <label className="check-option" key={student.id}><input type="checkbox" aria-label={`Add ${student.name}`} checked={selected.has(student.id) || automaticIds.has(student.id)} disabled={automaticIds.has(student.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(student.id); else next.delete(student.id); return next; })} /><span>{student.name}<small>{[student.department, `Year ${student.year}`, student.section && `Section ${student.section}`, automaticIds.has(student.id) && 'Added by filters'].filter(Boolean).join(' · ')}</small></span></label>)}</div>
          {options.isSuccess && !visible.length && <p>No students match this search.</p>}
        </fieldset>
        {role === 'admin' && <fieldset className="check-field"><legend>Assigned faculty managers</legend>{eligibleFaculty.map(f => <label className="check-option" key={f.id}><input type="checkbox" aria-label={`Assign ${f.name}`} checked={facultyIds.includes(f.id)} onChange={e => setFacultyIds(ids => e.target.checked ? [...ids,f.id] : ids.filter(id => id !== f.id))} /><span>{f.name}<small>{f.department || 'No department'} · {f.designations.join(', ')}</small></span></label>)}{!eligibleFaculty.length && <p>{category === 'sports' ? 'Assign a PT designation to faculty in Staff designations first.' : 'No matching faculty. Complete their department in Staff designations first.'}</p>}</fieldset>}
        {category === 'club' && <label className="field"><span>Student club manager (label only)</span><select aria-label="Student club manager" value={studentManagerId} onChange={e => setStudentManagerId(e.target.value)}><option value="">None</option>{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select><small>This label does not grant member management or announcement permissions.</small></label>}
        {options.isSuccess && <p className="group-create-count" role="status">{total} student{total === 1 ? '' : 's'} will be added. {total === 0 && 'You can add members later.'}</p>}
        {create.isError && <p className="form-error" role="alert">{create.error.message}</p>}
        <button className="primary-button" type="submit" disabled={!options.isSuccess || options.isFetching}>{create.isPending ? 'Saving…' : role === 'faculty' ? 'Submit group request' : requestId ? 'Approve and create group' : 'Create group'}</button>
      </fieldset>
    </form>
  </Modal>;
}
