# CampusRelay project review walkthrough

Use separate browser profiles or sign out when changing between student, faculty and administrator accounts. Use accounts created on the same server: local accounts and Railway accounts are separate.

## Main demonstration

1. Create a student account with a register number, department, year, section and academic session. Degree/program is no longer requested. Open Settings, update the profile and save.
2. Create a separate faculty account with a different email, employee ID, department and designation. An existing student email does not become a faculty account by selecting another portal.
3. As administrator, open Groups and create the matching academic class. Assign a faculty member from the same department. One faculty member can be assigned to multiple classes.
4. As that faculty member, open Materials, choose the assigned class, create a subject, and upload a PDF, DOCX or supported image (up to 5 MB).
5. As the matching student, open Groups or Materials, open the subject and download the file. Other departments/classes cannot access it.
6. As faculty, compose a circular, choose a group, review and send. As a member student, open the circular, download it and acknowledge it when requested. Return to faculty Sent/Reports to inspect delivery and reads.
7. Request an activity group as faculty. Approve it as administrator. Create an invitation as the assigned manager, then request to join as student and approve the request as manager. Invitation links and QR codes do not immediately grant membership.
8. Demonstrate saved notices, upcoming events, campus posts, search, theme/display settings and sign out.
9. In administration, demonstrate users, staff designations, groups, reports, college settings and audit history. Multiple designations are labels; permissions still follow account role and assigned groups/classes.

## Deployment and delivery

Normal password mode works without Google or email OTP configuration. Email addresses entered in this mode are not proof of mailbox ownership. Real email delivery needs an SMTP sender. Push delivery needs a supported browser, permission and a valid subscription; browser checks do not prove delivery to every real device.

Use the public Railway origin for invitations shared to other devices. A 127.0.0.1 link opens the receiving device itself. Reload an already open app after deploying a new version; the removed update screen is not required.

## Verification

Run `npm run verify` to check types, isolated server behavior, interface tests and desktop/mobile browser workflows. Tests use isolated accounts and data and do not clear the real database. The suite covers the principal review workflows; external OAuth, SMTP and real-device push delivery require their configured services.
