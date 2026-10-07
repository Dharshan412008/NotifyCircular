import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import Modal from './Modal';

interface Student { id: number; name: string; email: string; year: number; department: string; section: string; groupIds: number[] }
interface Options { students: Student[]; groups: { id: number; name: string }[] }
export default function CreateGroupDialog({ role, onClose }: { role: 'faculty' | 'admin'; onClose: () => void }) {
  const client = useQueryClient(), uniqueId = useId();
  const endpoint = role === 'admin' ? '/api/admin/groups' : '/api/groups';
  const options = useQuery({ queryKey: ['group-create-options', role], queryFn: ({ signal }) => apiRequest<Options>(`${endpoint}/create-options`, { signal }), staleTime: 0 });
  const [year, setYear] = useState(''), [department, setDepartment] = useState(''), [section, setSection] = useState(''), [parent, setParent] = useState('');
  const [kind, setKind] = useState('custom'), [joinable, setJoinable] = useState(false), [automatic, setAutomatic] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(() => new Set()), [search, setSearch] = useState('');
  const students = options.data?.students || [];
  const normalize = (value: string) => value.trim().toLowerCase();
  const hasFilters = Boolean(year || department.trim() || section.trim() || parent);
  const matching = useMemo(() => students.filter((student) => (!year || student.year === Number(year))
    && (!department.trim() || normalize(student.department) === normalize(department))
    && (!section.trim() || normalize(student.section) === normalize(section))
    && (!parent || student.groupIds.includes(Number(parent)))), [students, year, department, section, parent]);
  const automaticIds = new Set(automatic && hasFilters ? matching.map((student) => student.id) : []);
  const total = new Set([...selected, ...automaticIds]).size;
  const visible = students.filter((student) => normalize(`${student.name} ${student.email} ${student.department} ${student.section}`).includes(normalize(search)));
  const create = useMutation({
    mutationFn: (form: FormData) => apiRequest(endpoint, { method: 'POST', body: {
      name: form.get('name'), description: form.get('description'), icon: form.get('icon'), kind, joinable,
      year: year ? Number(year) : null, department: department.trim(), section: section.trim(), parentGroupId: parent ? Number(parent) : null,
      autoAddMatches: automatic, memberStudentIds: [...selected],
    } }),
    onSuccess: async () => { await Promise.all(['groups', 'admin', 'group-create-options'].map((key) => client.invalidateQueries({ queryKey: [key] }))); onClose(); },
  });
  return <Modal open onClose={onClose} dismissible={!create.isPending} title="Create a group" eyebrow="Build your college community">
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
      <fieldset className="group-create-fields" disabled={create.isPending}>
        <label className="field"><span>Group name</span><input name="name" required minLength={2} maxLength={80} placeholder="Robotics Club" /></label>
        <label className="field"><span>Description</span><textarea name="description" maxLength={240} rows={2} placeholder="What is this group for?" /></label>
        <div className="form-grid-two"><label className="field"><span>Icon or initials</span><input name="icon" defaultValue="CR" maxLength={16} required /></label><label className="field"><span>Group type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="custom">Community / announcement</option><option value="activity">Activity / club</option></select></label></div>
        <label className="check-option"><input type="checkbox" checked={joinable} onChange={(event) => setJoinable(event.target.checked)} /><span>Students can join this group<small>Turn off to keep membership managed by faculty and administrators.</small></span></label>
        <h4>Choose your audience</h4>
        <div className="form-grid-two"><label className="field"><span>Study year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">All years</option>{[1, 2, 3, 4].map((value) => <option value={value} key={value}>Year {value}</option>)}</select></label><label className="field"><span>Department</span><input list={`${uniqueId}-departments`} maxLength={80} value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="All departments" /></label><label className="field"><span>Section</span><input list={`${uniqueId}-sections`} maxLength={30} value={section} onChange={(event) => setSection(event.target.value)} placeholder="All sections" /></label><label className="field"><span>Parent group</span><select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Standalone group</option>{options.data?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></div>
        <datalist id={`${uniqueId}-departments`}>{[...new Set(students.map((student) => student.department).filter(Boolean))].sort().map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id={`${uniqueId}-sections`}>{[...new Set(students.filter((student) => !department || normalize(student.department) === normalize(department)).map((student) => student.section).filter(Boolean))].sort().map((value) => <option key={value} value={value} />)}</datalist>
        <p className="view-intro">Choose existing department and section suggestions or enter your own. Filters use current student profiles.</p>
        <label className="check-option"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} /><span>Add students matching these filters<small>{hasFilters ? `${matching.length} students match. This adds them once when the group is created.` : 'Set a year, department, section, or parent group to use this option.'}</small></span></label>
        <fieldset className="check-field"><legend>Select individual students</legend><p className="view-intro">You can add students outside the filters. Turn off automatic additions to select members individually.</p><label className="field"><span>Search members</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, department or section" /></label>
          {options.isPending && <p role="status">Loading students…</p>}{options.isError && <div role="alert"><p>{options.error.message}</p><button type="button" className="secondary-button" onClick={() => options.refetch()}>Retry members</button></div>}
          <div className="member-chip-grid">{visible.map((student) => <label className="check-option" key={student.id}><input type="checkbox" aria-label={`Add ${student.name}`} checked={selected.has(student.id) || automaticIds.has(student.id)} disabled={automaticIds.has(student.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(student.id); else next.delete(student.id); return next; })} /><span>{student.name}<small>{[student.department, `Year ${student.year}`, student.section && `Section ${student.section}`, automaticIds.has(student.id) && 'Added by filters'].filter(Boolean).join(' · ')}</small></span></label>)}</div>
          {options.isSuccess && !visible.length && <p>No students match this search.</p>}
        </fieldset>
        {options.isSuccess && <p className="group-create-count" role="status">{total} student{total === 1 ? '' : 's'} will be added. {total === 0 && 'You can add members later.'}</p>}
        {create.isError && <p className="form-error" role="alert">{create.error.message}</p>}
        <button className="primary-button" type="submit" disabled={!options.isSuccess || options.isFetching}>{create.isPending ? 'Creating…' : 'Create group'}</button>
      </fieldset>
    </form>
  </Modal>;
}
