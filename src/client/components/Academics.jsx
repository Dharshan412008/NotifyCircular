import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest, getErrorMessage } from '../api.js';

const label = c => `Year ${c.year} · ${c.department} · Section ${c.section}`;
const years = ['First year', 'Second year', 'Third year', 'Final year'];
function Error({ error }) { return error ? <p role="alert" className="form-error">{getErrorMessage(error)}</p> : null; }
function useAcademics() { return useQuery({ queryKey: ['academics'], queryFn: () => apiRequest('/api/academics'), refetchOnWindowFocus: true, refetchInterval: 30000 }); }

export function AcademicCommunity({ user }) {
  const query = useAcademics();
  const classes = query.data?.classes || [];
  return <article className="academic-panel"><div className="section-heading"><div><p className="overline">Your academic community</p><h3>Year → Department → Section</h3></div><Link className="secondary-button" to={`/${user.role}/materials`}>Study materials</Link></div>
    {query.isPending && <p role="status">Loading your classes…</p>}<Error error={query.error} />
    {query.isSuccess && !classes.length && <p>{user.role === 'student' ? 'Complete your department and section in Account settings to see your class community.' : 'An administrator needs to assign your teaching classes. Assigned classes will appear here.'}</p>}
    {[1, 2, 3, 4].filter(y => classes.some(c => c.year === y)).map(y => <details className="academic-year" key={y} open><summary>{years[y - 1]}</summary>
      {[...new Set(classes.filter(c => c.year === y).map(c => c.department))].map(dept => <details className="academic-department" key={dept} open><summary>{dept}</summary><div className="academic-sections">{classes.filter(c => c.year === y && c.department === dept).map(c => <Link key={c.id} to={`/${user.role}/materials?class=${c.id}`}>Section {c.section}<small>Subjects & materials</small></Link>)}</div></details>)}
    </details>)}
  </article>;
}

export default function StudyMaterials({ user }) {
  const query = useAcademics(), client = useQueryClient();
  const [chosenClass, setChosenClass] = useState(() => new URLSearchParams(window.location.search).get('class') || '');
  const [subjectName, setSubjectName] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const classes = query.data?.classes || [], subjects = query.data?.subjects || [];
  const classId = classes.some(c => String(c.id) === chosenClass) ? chosenClass : String(classes[0]?.id || '');
  const visibleSubjects = subjects.filter(s => String(s.class_id) === classId);
  const subjectId = visibleSubjects.some(s => String(s.id) === selectedSubject) ? selectedSubject : String(visibleSubjects[0]?.id || '');
  const refresh = () => client.invalidateQueries({ queryKey: ['academics'] });
  const create = useMutation({ mutationFn: () => apiRequest('/api/academics/subjects', { method: 'POST', body: { classId: Number(classId), name: subjectName } }), onSuccess: () => { setSubjectName(''); refresh(); } });
  const upload = useMutation({ mutationFn: async () => {
    if (!file || file.size > 5 * 1024 * 1024) throw new globalThis.Error('Choose a file up to 5 MB.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new globalThis.Error('Could not read the file.')); reader.readAsDataURL(file); });
    return apiRequest(`/api/academics/subjects/${subjectId}/materials`, { method: 'POST', body: { title, name: file.name, data } });
  }, onSuccess: () => { setTitle(''); setFile(null); setFormKey(v => v + 1); refresh(); } });
  const remove = useMutation({ mutationFn: id => apiRequest(`/api/academics/materials/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  return <section className="academic-workspace"><div className="section-heading"><div><p className="overline">Your classroom library</p><h3>Subjects & study materials</h3></div></div>
    {query.isPending && <p role="status">Loading materials…</p>}<Error error={query.error} />{query.isError && <button className="secondary-button" onClick={() => query.refetch()}>Try again</button>}
    {query.isSuccess && !classes.length && <p className="academic-panel">{user.role === 'faculty' ? 'No teaching classes assigned yet. Ask your administrator to assign your year, department, and section in Groups → Class administration.' : 'Complete your department and section in Account settings. Your class subjects will appear here.'}</p>}
    {!!classes.length && <><label className="academic-field">Class<select aria-label="Class" value={classId} onChange={e => setChosenClass(e.target.value)}>{classes.map(c => <option value={c.id} key={c.id}>{label(c)}</option>)}</select></label>
      {user.role === 'faculty' && <div className="academic-editor-grid"><form className="academic-panel" onSubmit={e => { e.preventDefault(); create.mutate(); }}><h4>Create a subject</h4><label className="academic-field">Subject name<input value={subjectName} onChange={e => setSubjectName(e.target.value)} required minLength={2} maxLength={120} placeholder="e.g. Data Structures" /></label><Error error={create.error} /><button className="primary-button" disabled={create.isPending}>Create subject</button></form>
        <form key={formKey} className="academic-panel" onSubmit={e => { e.preventDefault(); upload.mutate(); }}><h4>Add study material</h4><label className="academic-field">Subject<select aria-label="Subject" value={subjectId} onChange={e => setSelectedSubject(e.target.value)} required><option value="" disabled>Choose a subject</option>{visibleSubjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="academic-field">Material title<input required minLength={2} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Unit 1 notes" /></label><label className="academic-field">File (up to 5 MB)<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.webp" required onChange={e => setFile(e.target.files?.[0] || null)} /></label><small>PDF, DOCX, PNG, JPEG or WebP</small><Error error={upload.error} /><button className="primary-button" disabled={!subjectId || upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload material'}</button>{upload.isSuccess && <p role="status">Material shared with this class.</p>}</form></div>}
      {!visibleSubjects.length && <p className="empty-state">No subjects yet. Your assigned staff can create subjects and add materials here.</p>}
      <Error error={remove.error} />{visibleSubjects.map(subject => <article className="academic-panel" key={subject.id}><h4>{subject.name}</h4><p>Created by {subject.faculty_name}</p>{!subject.materials.length && <p>No materials uploaded yet.</p>}{subject.materials.map(material => <div className="academic-material" key={material.id}><div><strong>{material.title}</strong><small>{material.name} · {(material.size / 1024).toFixed(1)} KB · {new Date(material.created_at).toLocaleDateString()}</small></div><a className="secondary-button" href={`/api/academics/materials/${material.id}/download`} download>Download</a>{user.role === 'faculty' && material.faculty_id === user.id && <button className="secondary-button" disabled={remove.isPending} onClick={() => remove.mutate(material.id)}>Remove</button>}</div>)}</article>)}
    </>}
  </section>;
}

function StaffAssignment({ cls, faculty, assignments, onSaved }) {
  const [ids, setIds] = useState(assignments.filter(a => a.class_id === cls.id).map(a => a.faculty_id));
  const assignmentKey = JSON.stringify(assignments.filter(a => a.class_id === cls.id).map(a => a.faculty_id));
  useEffect(() => setIds(JSON.parse(assignmentKey)), [assignmentKey]);
  const save = useMutation({ mutationFn: () => apiRequest(`/api/academics/classes/${cls.id}/staff`, { method: 'PUT', body: { facultyIds: ids } }), onSuccess: onSaved });
  return <form className="academic-panel" onSubmit={e => { e.preventDefault(); save.mutate(); }}><h4>{label(cls)}</h4><p>Choose the staff allowed to create subjects and share materials for this class.</p>{faculty.map(f => <label className="academic-staff" key={f.id}><input type="checkbox" checked={ids.includes(f.id)} onChange={e => setIds(current => e.target.checked ? [...current, f.id] : current.filter(id => id !== f.id))} /><span>{f.name}<small>{f.email}</small></span></label>)}{!faculty.length && <p>No staff from this department are available. Faculty must save their department in Account settings first.</p>}<Error error={save.error} /><button className="secondary-button" disabled={save.isPending}>Save assigned staff</button>{save.isSuccess && <p role="status">Staff assignments saved.</p>}</form>;
}

export function AcademicAdministration() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'academics'], queryFn: () => apiRequest('/api/academics/administration') });
  const [year, setYear] = useState('2'), [department, setDepartment] = useState('IT'), [section, setSection] = useState('A');
  const refresh = () => { client.invalidateQueries({ queryKey: ['admin', 'academics'] }); client.invalidateQueries({ queryKey: ['academics'] }); };
  const create = useMutation({ mutationFn: () => apiRequest('/api/academics/classes', { method: 'POST', body: { year: Number(year), department, section } }), onSuccess: refresh });
  return <section className="academic-workspace"><h3>Class administration</h3><p>Classes follow Year → Department → Section. Students join their matching community automatically. Only staff assigned below can upload class materials.</p><form className="academic-panel" onSubmit={e => { e.preventDefault(); create.mutate(); }}><h4>Add a class</h4><label className="academic-field">Year<select aria-label="Year" value={year} onChange={e => setYear(e.target.value)}>{years.map((v, i) => <option key={v} value={i + 1}>{v}</option>)}</select></label><label className="academic-field">Department<input list="academic-departments" value={department} onChange={e => setDepartment(e.target.value)} required maxLength={80} /></label><datalist id="academic-departments">{['IT', 'EEE', 'ECE', 'CSE', 'MECH', 'CIVIL', 'AI & DS'].map(d => <option key={d}>{d}</option>)}</datalist><label className="academic-field">Section<input value={section} onChange={e => setSection(e.target.value)} required maxLength={30} placeholder="A" /></label><Error error={create.error} /><button className="primary-button" disabled={create.isPending}>Add class</button></form><Error error={query.error} />{query.isPending && <p role="status">Loading classes…</p>}{query.data?.classes.map(cls => <StaffAssignment key={cls.id} cls={cls} faculty={query.data.faculty.filter(f => cls.eligibleFacultyIds.includes(f.id))} assignments={query.data.assignments} onSaved={refresh} />)}</section>;
}
