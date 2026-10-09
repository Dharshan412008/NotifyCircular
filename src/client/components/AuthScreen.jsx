import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, ShieldCheck, RadioTower } from 'lucide-react';
import { apiRequest } from '../api.js';
import PortalThemeButton from './PortalThemeButton';
const errors = {
  expired: 'Your sign-in attempt expired. Please try again.',
  cancelled: 'Google sign-in was cancelled. You can try again.',
  verification: 'Google verification could not be completed. Please try again.',
  college_email: 'Use your verified college Google account from the allowed domain.',
  role: 'Your college account is not assigned to this portal. Choose your assigned portal.',
  approval: 'Your account needs college approval. Contact your administrator.',
  account: 'This account is unavailable. Contact your college administrator.',
};
export default function AuthScreen({ role = 'student', onAuthenticated, installAvailable = false, onInstall = () => {} }) {
  const navigate = useNavigate(), location = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false), [name, setName] = useState(''), [year, setYear] = useState('1');
  const [verification, setVerification] = useState(null), [code, setCode] = useState(''), [notice, setNotice] = useState('');
  const settings = useQuery({ queryKey: ['auth-options'], queryFn: () => apiRequest('/api/auth/options'), staleTime: 60000 });
  const canRegister = role === 'student' || (role === 'faculty' && settings.data?.collegePasswordAuth === false);
  const label = role === 'faculty' ? 'Faculty' : role === 'admin' ? 'Administrator' : 'Student';
  async function signIn(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (settings.data.collegePasswordAuth === true && !/^[^\s@]+@srishakthi\.ac\.in$/i.test(email.trim())) throw new Error('Use an email address ending in @srishakthi.ac.in.');
      const result = await apiRequest(registering && canRegister ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: registering && canRegister ? { email: email.trim(), password, name, role, ...(role === 'student' ? { year: Number(year) } : {}) } : { email: email.trim(), password, role } });
      if (result.verificationRequired) { setVerification(result); setPassword(''); setCode(''); return; }
      if (result.user?.role !== role) throw new Error('This account is not assigned to the selected portal.');
      await onAuthenticated?.(result.user);
      if (location.pathname === '/') navigate('/' + role, { replace: true });
    } catch (failure) { setError(failure.message || 'Sign-in failed.'); } finally { setBusy(false); }
  }
  async function verify(event) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const result = await apiRequest('/api/auth/verification/confirm', { method: 'POST', body: { code } });
      await onAuthenticated?.(result.user);
      if (location.pathname === '/') navigate('/' + role, { replace: true });
    } catch (failure) { setError(failure.message || 'Verification failed.'); } finally { setBusy(false); }
  }
  async function resend() {
    setError(''); setNotice(''); setBusy(true);
    try { await apiRequest('/api/auth/verification/resend', { method: 'POST', body: {} }); setNotice('A new code has been sent. Check your inbox and spam folder.'); setCode(''); }
    catch (failure) { setError(failure.message || 'Could not resend the code.'); } finally { setBusy(false); }
  }
  const failure = error || errors[params.get('authError')] || settings.error?.message;
  return <section id="authScreen" className="screen screen-active auth-screen college-sign-in" aria-labelledby="authTitle">
    <header className="topbar"><span className="mini-wordmark"><span className="logo-mark small"><RadioTower /></span> CampusRelay</span><div className="portal-header-actions">{installAvailable && <button className="inline-button" onClick={onInstall}>Install CampusRelay</button>}<PortalThemeButton /></div></header>
    <div className="auth-heading"><span className="soft-badge"><GraduationCap size={16} /> Your college, connected</span><h2 id="authTitle">Sign in to CampusRelay</h2><p>{settings.data?.localAuth ? 'Choose your portal and sign in with your email and CampusRelay password.' : 'Choose your portal and continue with your college Google account.'}</p></div>
    <div className="filter-row auth-portal-picker" aria-label="Choose your portal">
      {['student', 'faculty'].map((value) => <button key={value} aria-pressed={role === value} className={role === value ? 'active' : ''} disabled={busy} onClick={() => { setError(''); setPassword(''); setRegistering(false); setVerification(null); setNotice(''); navigate('/' + value); }}>{value === 'student' ? 'Student portal' : 'Faculty portal'}</button>)}
    </div>
    <div className="settings-card college-login-card"><h3>{label} sign-in</h3>
      {settings.isPending && <p role="status">Loading sign-in options…</p>}
      {settings.isSuccess && <>
        {settings.data.domains?.length > 0 && <p className="view-intro">College accounts: {settings.data.domains.map((domain) => '@' + domain).join(', ')}</p>}
        {!settings.data.localAuth && <><button className="primary-button google-sign-in" disabled={!settings.data.googleEnabled || busy} onClick={() => window.location.assign('/api/auth/google/start?role=' + role)}>Sign in with Google</button>
        {!settings.data.googleEnabled && <p className="collection-note">College Google sign-in is awaiting administrator setup. Please contact your college administrator.</p>}</>}
        {settings.data.localAuth && verification && <form className="form-stack" onSubmit={verify}>
          <h4>Verify your college email</h4><p>Enter the six-digit code sent to {verification.email}. It expires in 10 minutes. Check your spam folder too.</p>
          <label className="field"><span>Verification code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : 'Verify email'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={resend}>Resend code</button><p className="collection-note">Wait one minute between code requests.</p>
          <button type="button" className="inline-button" disabled={busy} onClick={() => { setVerification(null); setRegistering(false); setError(''); setNotice(''); }}>Back to sign in</button>
        </form>}
        {notice && <p role="status">{notice}</p>}
        {settings.data.localAuth && !verification && <form className="form-stack local-login-form" onSubmit={signIn}>
          <p className="collection-note">{settings.data.collegePasswordAuth ? 'Use your college email and CampusRelay password.' : 'Use your Gmail or another email address and a password created for CampusRelay.'}</p>
          {registering && canRegister && <><label className="field"><span>Full name</span><input required minLength={2} maxLength={100} autoComplete="name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>{role === 'student' && <label className="field"><span>Academic year</span><select value={year} disabled={busy} onChange={(event) => setYear(event.target.value)}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>Year {value}</option>)}</select></label>}</>}
          <label className="field"><span>Email address</span><input type="email" autoComplete="username" placeholder={settings.data.collegePasswordAuth ? "yourname@srishakthi.ac.in" : "yourname@gmail.com"} required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field"><span>Password</span><input type="password" minLength={registering ? 8 : 1} maxLength={128} autoComplete={registering ? 'new-password' : 'current-password'} required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : registering && canRegister ? `Create ${role} account` : 'Sign in securely'}</button>
          {canRegister && <button type="button" className="inline-button" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); setPassword(''); }}>{registering ? 'Already have an account? Sign in' : `New ${role}? Create an account`}</button>}
        </form>}
      </>}
      {failure && <p className="form-error" role="alert">{failure}</p>}
      {settings.isError && <button className="secondary-button" onClick={() => settings.refetch()}>Retry sign-in options</button>}
    </div>
    <p className="auth-security"><ShieldCheck /><span>{settings.data?.localAuth ? (settings.data.collegePasswordAuth ? 'Verify your college mailbox with an email code before your first sign-in.' : 'Use your CampusRelay password here, never your Gmail password.') : 'Google verifies your identity. Your Google password stays with Google. Faculty permissions are assigned by your college.'}</span></p>
    {role !== 'admin' && <button className="inline-button admin-entry" onClick={() => navigate('/admin')}>College administration</button>}
  </section>;
}
