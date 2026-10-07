'use strict';
const { assert } = require('./errors');
const { cleanString, cleanBoolean, cleanInteger, cleanIdArray, requireObject, slugify } = require('./validation');
const { getGroup } = require('./repository');

function groupOptions(db) {
  const students = db.prepare(`SELECT u.id,u.name,u.email,u.year,coalesce(p.department,'') department,coalesce(p.section,'') section
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.role='student' AND u.disabled=0 ORDER BY u.name,u.id`).all();
  const memberships = db.prepare('SELECT student_id,group_id FROM student_group_memberships').all();
  const groupsByStudent = new Map();
  for (const row of memberships) { if (!groupsByStudent.has(row.student_id)) groupsByStudent.set(row.student_id, []); groupsByStudent.get(row.student_id).push(row.group_id); }
  return { students: students.map((student) => ({ ...student, groupIds: groupsByStudent.get(student.id) || [] })),
    groups: db.prepare("SELECT id,name FROM groups WHERE kind != 'role' ORDER BY name").all() };
}

function createGroup(db, user, input) {
  const body = requireObject(input);
  const name = cleanString(body.name, 'name', { min: 2, max: user.role === 'admin' ? 100 : 80 });
  const description = cleanString(body.description ?? '', 'description', { max: user.role === 'admin' ? 500 : 240 });
  const icon = cleanString(body.icon ?? 'CR', 'icon', { min: 1, max: 16 });
  const kind = body.kind ?? 'custom';
  assert(['custom', 'activity'].includes(kind), 400, 'validation_error', 'Choose a community or activity group.');
  const joinable = cleanBoolean(body.joinable, 'joinable', user.role === 'admin' || kind === 'activity');
  const year = body.year === undefined || body.year === null || body.year === '' ? null : cleanInteger(body.year, 'year', { min: 1, max: 4 });
  const department = cleanString(body.department ?? '', 'department', { max: 80 });
  const section = cleanString(body.section ?? '', 'section', { max: 30 });
  const parentGroupId = body.parentGroupId === undefined || body.parentGroupId === null || body.parentGroupId === '' ? null : cleanInteger(body.parentGroupId, 'parentGroupId', { min: 1 });
  const autoAddMatches = cleanBoolean(body.autoAddMatches, 'autoAddMatches', true);
  const ids = cleanIdArray(body.memberStudentIds ?? [], 'memberStudentIds', { max: 500 });
  const slug = slugify(name);
  const id = db.transaction(() => {
    assert(!db.prepare('SELECT 1 FROM groups WHERE slug=? OR name=?').get(slug, name), 409, 'group_exists', 'A group with this name already exists.');
    if (parentGroupId) assert(db.prepare("SELECT 1 FROM groups WHERE id=? AND kind!='role'").get(parentGroupId), 400, 'validation_error', 'Choose an available student parent group.');
    const student = db.prepare("SELECT 1 FROM users WHERE id=? AND role='student' AND disabled=0");
    assert(ids.every((id) => student.get(id)), 400, 'validation_error', 'Choose enabled student accounts.');
    const selected = new Set(ids);
    // No filters means manual selection only, never an implicit whole-college group.
    if (autoAddMatches && (year || department || section || parentGroupId)) {
      const matching = db.prepare(`SELECT u.id FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE u.role='student' AND u.disabled=0 AND (@year IS NULL OR u.year=@year)
        AND (@department='' OR lower(trim(coalesce(p.department,'')))=lower(@department))
        AND (@section='' OR lower(trim(coalesce(p.section,'')))=lower(@section))
        AND (@parentGroupId IS NULL OR EXISTS(SELECT 1 FROM student_group_memberships m WHERE m.student_id=u.id AND m.group_id=@parentGroupId))`).all({ year, department, section, parentGroupId });
      for (const row of matching) selected.add(row.id);
    }
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO groups(slug,name,description,icon,kind,joinable,year,department,section,parent_group_id,creator_faculty_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, name, description, icon, kind, +joinable, year, department, section, parentGroupId, user.id, now);
    const groupId = Number(result.lastInsertRowid);
    const add = db.prepare("INSERT INTO student_group_memberships(student_id,group_id,source,joined_at) VALUES(?,?,'faculty',?)");
    for (const memberId of selected) add.run(memberId, groupId, now);
    require('./admin').audit(db, { actorId: user.id, action: 'group.created', resource: 'group', resourceId: groupId, metadata: { members: selected.size } });
    return groupId;
  })();
  return getGroup(db, id);
}
module.exports = { createGroup, groupOptions };
