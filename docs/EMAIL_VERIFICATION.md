# Optional college email verification

Normal login now accepts Gmail or any valid email with a CampusRelay password and requires no OTP or sender setup. This guide is only for optional `AUTH_MODE=college`.

CampusRelay uses college email and a CampusRelay password, with an email code before the first successful sign-in. No college Google Cloud access is needed. The exact domain must be `srishakthi.ac.in`; verification proves access to that mailbox, not current college enrollment.

## Set up a sender

Obtain SMTP credentials from an email provider or an account authorized to send application emails. The sender does not have to be a college mailbox. Use the provider's SMTP host, port, security setting, and approved sender address. Do not share passwords in chat or source control.

Stop the previous local server with Ctrl+C, then configure the same PowerShell terminal used to start the app:

```powershell
cd D:\NotifyCircular
$env:AUTH_MODE = "college"
$env:APP_URL = "http://127.0.0.1:5173"
$env:SMTP_HOST = "YOUR_SMTP_HOST"
$env:SMTP_PORT = "587"
$env:SMTP_SECURE = "false"
$env:SMTP_USER = "YOUR_SMTP_USERNAME"
$env:SMTP_PASS = "YOUR_SMTP_PASSWORD"
$env:MAIL_FROM = "CampusRelay <YOUR_APPROVED_SENDER_EMAIL>"
npm.cmd run dev
```

These are placeholders; use your provider's actual settings. Port 587 uses required STARTTLS. If the provider specifies port 465, use `SMTP_PORT=465` and `SMTP_SECURE=true`. This project does not automatically load `.env` files. Verification messages use SMTP directly; circular notification sending remains controlled separately by `ALLOW_OUTBOUND_NOTIFICATIONS`.

## Verify and sign in

1. Open http://127.0.0.1:5173 and select your portal.
2. New students choose **New student? Create an account**. Existing users enter their email and CampusRelay password.
3. Enter the six-digit code received in the college inbox. Check spam if needed.
4. The code expires after 10 minutes. After five incorrect attempts, request a new code. Wait at least one minute between sends.
5. After verification, future logins use the same email and password.

Faculty and administrator accounts must be provisioned beforehand. Their first password sign-in also requires email verification. Existing unverified sessions cannot access protected routes or live updates. Verification codes are one-use, hashed in the database, bound to the requesting browser session, and never returned through an API or logged. Restarting the server invalidates outstanding codes; request a new one.

Missing sender settings block verification. Failed SMTP delivery never grants access; if registration created the account before delivery failed, use **Sign in** with the same password to retry sending. Tests use a private mock sender and isolated accounts, not real college inboxes. `AUTH_MODE=local` is only for isolated tests and bypasses verification.
