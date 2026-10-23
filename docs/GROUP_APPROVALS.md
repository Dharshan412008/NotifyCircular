# Groups, staff designations and invitations

## Administrator

Open **Groups** to manage the following:

- **Staff designations:** save staff ID, department, and multiple comma-separated labels such as HOD, Assistant Professor and PT. These labels do not grant administrator access. Only PT / PT Staff / Physical Education / Physical Education Teacher / Physical Director enables faculty eligibility for sports-group management.
- **Class administration:** assign teaching staff to their matching department's year and section. The same faculty member may teach several classes and create different subjects in each. Student and faculty Groups screens list subjects beneath each assigned class.
- **Group requests:** review faculty proposals, adjust their audience and managers, and approve or reject. No group or memberships are created until approval. Reviews are recorded in audit history.
- **Create group:** choose Community / class, Club, Sports, or Exam Cell / committee. Department, year and section are optional scope filters. Leaving section blank covers matching students from all sections. Sports groups require sports type and sports name and accept only PT-designated faculty managers. Other scoped groups accept faculty from the same department.
- **Manage group:** assign faculty managers, optionally give a student a club manager label, review join requests, and create/revoke invitations. A student club label does not grant announcements, invitations, member management, or approval permissions.

Faculty selection uses administrator-assigned designations, not a job title entered by the faculty member during registration or profile editing.

## Faculty

Open **Groups → Request group** to submit a proposal. Track pending, approved and rejected requests on the same screen. Only an administrator can create the approved group and assign its managers.

Assigned faculty see **Manage** on their groups. They can create an invitation link and a locally generated QR image, then review membership requests. Student accounts cannot use these management endpoints, including students with a club manager label. HOD and other labels alone also do not grant management access.

## Students

Whole College appears first, followed by the student's profile-matched year, department, section and subjects. Clubs, sports and other available groups appear below. **Request to join** records a pending request and does not immediately grant membership.

An invitation link opens `/join/<random-token>`. Sign in with a student account, then request membership. A group manager or administrator must approve it. Only then do membership-based circulars and discussions become available. The student's current profile must match the group's audience when requesting and when approval occurs. Existing memberships and automatic academic communities are preserved.

## Invitation lifecycle

The interface creates invitations valid for seven days. Managers can revoke them early. URLs use the app origin they are created on: share public Railway URLs with real users, since `127.0.0.1` links work only on the device running the local server. Tokens are stored as hashes; saved invitation history never exposes their original values. QR images are generated locally, without an external QR service.

Expired or revoked invitations, or invitations whose creator no longer manages the group, cannot be used or approved. A student with a pending request may use a new valid invitation to refresh their request. Declined requests require contacting the manager. Request and invitation history survives restarts in the existing SQLite database; keep its persistent volume attached in production.
