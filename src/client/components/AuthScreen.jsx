import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  LoaderCircle,
  RadioTower,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiRequest } from '../api.js';

const DEMO_ACCOUNTS = {
  admin: { email: 'admin@demo.edu', password: 'Admin123!', name: 'College administrator', description: 'Admin demo - manage your campus' },
  faculty: {
    email: 'faculty@demo.edu',
    password: 'Faculty123!',
    name: 'Dr. Meera Shah',
    description: 'Faculty demo - signs in instantly',
  },
  student: {
    email: 'asha@demo.edu',
    password: 'Student123!',
    name: 'Asha Rao',
    description: 'Student demo - signs in instantly',
  },
};

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CR';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] : ''}`.toUpperCase();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function registrationYear(value) {
  const year = positiveInteger(value);
  return year && year <= 4 ? year : null;
}

function authenticatedUser(payload) {
  const user = payload?.user;
  if (!positiveInteger(user?.id) || !['faculty', 'student', 'admin'].includes(user?.role)) {
    throw new ApiError('The server returned an invalid account.', {
      status: 500,
      code: 'invalid_user',
    });
  }
  return user;
}

async function loadPublicGroups() {
  const payload = await apiRequest('/api/groups');
  if (!Array.isArray(payload?.groups)) {
    throw new ApiError('The group directory response was invalid.', {
      status: 500,
      code: 'invalid_groups',
    });
  }

  return payload.groups
    .map((group) => ({ ...group, id: positiveInteger(group?.id) }))
    .filter((group) => (
      group.id
      && group.joinable !== false
      && ['activity', 'custom'].includes(group.kind)
    ));
}

function ErrorMessage({ id, message }) {
  if (!message) return null;
  return <p id={id} className="form-error" role="alert">{message}</p>;
}

export default function AuthScreen({ role, onAuthenticated }) {
  const navigate = useNavigate();
  const normalizedRole = ['student', 'admin'].includes(role) ? role : 'faculty';
  const isStudent = normalizedRole === 'student';
  const demoAccount = DEMO_ACCOUNTS[normalizedRole];
  const [panel, setPanel] = useState('login');
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [loginValues, setLoginValues] = useState({ email: '', password: '' });
  const isRegistering = isStudent && panel === 'register';

  const publicGroupsQuery = useQuery({
    queryKey: ['groups', 'public'],
    queryFn: loadPublicGroups,
    enabled: isRegistering,
    staleTime: 60_000,
  });

  useEffect(() => {
    setPanel('login');
    setLoginError('');
    setRegisterError('');
    setBusyAction('');
  }, [normalizedRole]);

  const copy = useMemo(() => (isStudent ? {
    badge: 'Student portal',
    title: 'Your notices, in one place',
    subtitle: 'Sign in to see only the circulars addressed to your groups.',
  } : {
    badge: normalizedRole === 'admin' ? 'Admin portal' : 'Faculty portal',
    title: 'Welcome back',
    subtitle: normalizedRole === 'admin' ? 'Manage people, groups, and campus moderation.' : 'Sign in to compose and track official circulars.',
  }), [isStudent, normalizedRole]);

  const isBusy = Boolean(busyAction);

  async function authenticate(email, password, action) {
    setLoginError('');
    setBusyAction(action);
    try {
      const payload = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(email || '').trim(),
          password: String(password || ''),
        },
      });
      await onAuthenticated?.(authenticatedUser(payload));
    } catch (error) {
      setLoginError(error?.message || 'Sign-in failed.');
    } finally {
      setBusyAction('');
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }
    await authenticate(loginValues.email, loginValues.password, 'login');
  }

  async function demoLogin() {
    const credentials = {
      email: demoAccount.email,
      password: demoAccount.password,
    };
    setLoginValues(credentials);
    await authenticate(credentials.email, credentials.password, 'demo');
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setRegisterError('');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const year = registrationYear(formData.get('year'));
    const activityGroupIds = [...new Set(
      formData.getAll('activityGroupIds').map(positiveInteger).filter(Boolean),
    )];

    if (!year) {
      setRegisterError('Choose a valid study year.');
      return;
    }

    setBusyAction('register');
    try {
      const payload = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: {
          name: String(formData.get('name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          password: String(formData.get('password') || ''),
          year,
          activityGroupIds,
        },
      });
      await onAuthenticated?.(authenticatedUser(payload));
      form.reset();
    } catch (error) {
      setRegisterError(error?.message || 'Account creation failed.');
    } finally {
      setBusyAction('');
    }
  }

  function showRegistration() {
    setLoginError('');
    setRegisterError('');
    setPanel('register');
  }

  function showLogin() {
    setRegisterError('');
    setPanel('login');
  }

  return (
    <section id="authScreen" className="screen screen-active auth-screen" aria-labelledby="authTitle">
      <header className="topbar">
        <button className="icon-button" type="button" onClick={() => navigate('/')} aria-label="Go back">
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className="mini-wordmark">
          <span className="logo-mark small"><RadioTower aria-hidden="true" /></span>
          {' '}CampusRelay
        </span>
        <span className="topbar-spacer" aria-hidden="true" />
      </header>

      <div className="auth-heading">
        <span id="authRoleBadge" className="soft-badge">{copy.badge}</span>
        <h2 id="authTitle">{isRegistering ? 'Create your account' : copy.title}</h2>
        <p id="authSubtitle">{isRegistering ? 'Join your year automatically, then choose the activities you follow.' : copy.subtitle}</p>
      </div>

      {!isRegistering ? (
        <div id="loginPanel">
          <form id="loginForm" className="form-stack" noValidate onSubmit={submitLogin} aria-busy={busyAction === 'login'}>
            <label className="field">
              <span>Email address</span>
              <input
                id="loginEmail"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@campus.edu"
                value={loginValues.email}
                onChange={(event) => setLoginValues((values) => ({ ...values, email: event.target.value }))}
                aria-describedby={loginError ? 'loginError' : undefined}
                aria-invalid={loginError ? 'true' : undefined}
                disabled={isBusy}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                id="loginPassword"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={loginValues.password}
                onChange={(event) => setLoginValues((values) => ({ ...values, password: event.target.value }))}
                aria-describedby={loginError ? 'loginError' : undefined}
                aria-invalid={loginError ? 'true' : undefined}
                disabled={isBusy}
              />
            </label>
            <ErrorMessage id="loginError" message={loginError} />
            <button id="loginButton" className={`primary-button${busyAction === 'login' ? ' is-loading' : ''}`} type="submit" disabled={isBusy}>
              <span>{busyAction === 'login' ? 'Signing in...' : 'Sign in securely'}</span>
              {busyAction === 'login'
                ? <LoaderCircle aria-hidden="true" />
                : <ChevronRight aria-hidden="true" />}
            </button>
          </form>

          <div className="divider"><span>or try the guided demo</span></div>
          <button
            id="demoLoginButton"
            className={`demo-login${busyAction === 'demo' ? ' is-loading' : ''}`}
            type="button"
            onClick={demoLogin}
            disabled={isBusy}
            aria-busy={busyAction === 'demo'}
          >
            <span id="demoAvatar" className="avatar demo-avatar">{initials(demoAccount.name)}</span>
            <span><strong id="demoName">{demoAccount.name}</strong><small id="demoDescription">{demoAccount.description}</small></span>
            {busyAction === 'demo'
              ? <LoaderCircle aria-label="Signing in" />
              : <span className="try-label">Try now</span>}
          </button>
          {isStudent && (
            <button id="showRegisterButton" className="text-button" type="button" onClick={showRegistration} disabled={isBusy}>
              New student? Create your account
            </button>
          )}
        </div>
      ) : (
        <form id="registerPanel" className="form-stack" noValidate onSubmit={submitRegistration} aria-busy={busyAction === 'register'}>
          <button id="backToLoginButton" className="text-button text-left" type="button" onClick={showLogin} disabled={isBusy}>
            <ArrowLeft aria-hidden="true" /> Back to sign in
          </button>
          <label className="field"><span>Full name</span><input name="name" autoComplete="name" required placeholder="Your full name" disabled={isBusy} aria-describedby={registerError ? 'registerError' : undefined} aria-invalid={registerError ? 'true' : undefined} /></label>
          <label className="field"><span>College email</span><input name="email" type="email" autoComplete="email" required placeholder="you@campus.edu" disabled={isBusy} aria-describedby={registerError ? 'registerError' : undefined} aria-invalid={registerError ? 'true' : undefined} /></label>
          <label className="field"><span>Create password</span><input name="password" type="password" minLength="8" autoComplete="new-password" required placeholder="At least 8 characters" disabled={isBusy} aria-describedby={registerError ? 'registerError' : undefined} aria-invalid={registerError ? 'true' : undefined} /></label>
          <label className="field">
            <span>Study year</span>
            <select name="year" required defaultValue="" disabled={isBusy} aria-describedby={registerError ? 'registerError' : undefined} aria-invalid={registerError ? 'true' : undefined}>
              <option value="">Choose your year</option>
              <option value="1">First year</option>
              <option value="2">Second year</option>
              <option value="3">Third year</option>
              <option value="4">Final year</option>
            </select>
          </label>
          <fieldset className="check-field" disabled={isBusy}>
            <legend>Activity groups <small>Optional</small></legend>
            <div id="registerActivities" className="check-grid" aria-live="polite">
              {publicGroupsQuery.isPending && <span className="skeleton-line" aria-label="Loading activity groups" />}
              {publicGroupsQuery.isError && (
                <small role="alert">
                  {publicGroupsQuery.error?.message || 'Activity groups could not be loaded.'}
                  {' '}
                  <button className="text-button" type="button" onClick={() => publicGroupsQuery.refetch()}>Try again</button>
                </small>
              )}
              {publicGroupsQuery.isSuccess && publicGroupsQuery.data.length === 0 && (
                <small>No optional activity groups are available yet.</small>
              )}
              {publicGroupsQuery.data?.map((group) => (
                <label className="check-option" key={group.id}>
                  <input name="activityGroupIds" type="checkbox" value={group.id} />
                  <span>{group.icon || 'CR'} {group.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorMessage id="registerError" message={registerError} />
          <button className={`primary-button${busyAction === 'register' ? ' is-loading' : ''}`} type="submit" disabled={isBusy}>
            <span>{busyAction === 'register' ? 'Creating account...' : 'Create student account'}</span>
            {busyAction === 'register' && <LoaderCircle aria-hidden="true" />}
          </button>
        </form>
      )}

      <div className="auth-security">
        <Check aria-hidden="true" />
        <span>Passwords are hashed. Your audience is enforced by the server, not hidden by the UI.</span>
      </div>
    </section>
  );
}
