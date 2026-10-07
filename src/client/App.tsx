import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Role, SessionUser } from './contracts';
import type { ThemeMode } from './components/PortalThemeButton';
import RouteBoundary, { RouteLoading } from './components/RouteBoundary';
import { DisplayProvider } from './components/DisplayPreferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FilePenLine,
  Inbox,
  LockKeyhole,
  Moon,
  Radio,
  Sun,
} from 'lucide-react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { apiRequest, AUTH_EXPIRED_EVENT } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
const FacultyPortal = lazy(() => import('./components/FacultyPortal.jsx'));
const StudentPortal = lazy(() => import('./components/StudentPortal.jsx'));
const AdminPortal = lazy(() => import('./components/AdminPortal.jsx'));
import { ThemeContext } from './components/PortalThemeButton.jsx';

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CR';
}

function preferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('campusrelay-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return 'system';
}

function DeviceShell({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      <main className="device" aria-label="CampusRelay application">
        {!online && <div className="offline-banner">You are offline. Reconnect to refresh circulars.</div>}
        {children}
      </main>
    </>
  );
}

function Brand({ compact = false }) {
  return (
    <span className={compact ? 'mini-wordmark' : 'wordmark'}>
      <span className={`logo-mark${compact ? ' small' : ''}`} aria-hidden="true">
        <Radio />
      </span>
      CampusRelay
    </span>
  );
}

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
interface StartProps { user: SessionUser | null; theme: 'light' | 'dark'; onToggleTheme: () => void; installAvailable: boolean; onInstall: () => void }
function StartScreen({ user, theme, onToggleTheme, installAvailable, onInstall }: StartProps) {
  const navigate = useNavigate();

  return (
    <section className="screen screen-active landing-screen" aria-labelledby="landing-title">
      <header className="landing-top">
        <Brand />
        <div className="landing-actions">
          {installAvailable && (
            <button
              className="icon-button"
              type="button"
              aria-label="Install CampusRelay"
              title="Install CampusRelay"
              onClick={onInstall}
            >
              <Download aria-hidden="true" />
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Dark theme"
            title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          {user && (
            <button
              className="avatar-button"
              type="button"
              aria-label={`Open ${user.role} portal`}
              onClick={() => navigate(`/${user.role}`)}
            >
              <span className="avatar">{initials(user.name)}</span>
              <span className="online-dot" />
            </button>
          )}
        </div>
      </header>

      <div className="hero">
        <div className="eyebrow"><span className="live-dot" /> Official campus communication</div>
        <h1 id="landing-title">The right notice.<br /><span>The right people.</span></h1>
        <p>Compose official circulars and route each one through verified group membership.</p>
        <div className="hero-proof" aria-label="System status">
          <span><LockKeyhole /> Session protected</span>
          <span><CheckCircle2 /> Membership enforced</span>
        </div>
      </div>

      <div className="role-stack" aria-label="Choose a portal">
        <button className="role-card faculty-role" type="button" onClick={() => navigate('/faculty')}>
          <span className="role-icon"><FilePenLine /></span>
          <span className="role-copy"><strong>Faculty portal</strong><small>Compose and route circulars</small></span>
          <ArrowRight className="chevron" />
        </button>
        <button className="role-card" type="button" onClick={() => navigate('/student')}>
          <span className="role-icon"><Inbox /></span>
          <span className="role-copy"><strong>Student portal</strong><small>Open your assigned inbox</small></span>
          <ArrowRight className="chevron" />
        </button>
      </div>

      <div className="landing-metrics" aria-label="System guarantees">
        <div><strong>Stay informed</strong><span>Your college notices</span></div>
        <div><strong>Connect</strong><span>Campus stories</span></div>
        <div><strong>Save</strong><span>Keep useful posts</span></div>
      </div>
      <button className="inline-button admin-entry" onClick={() => navigate('/admin')}>College administration <ArrowRight /></button>
      <p className="landing-footer">Official notices, connected campus.</p>
    </section>
  );
}

function LoadingScreen() {
  return (
    <section className="screen screen-active route-loading" aria-live="polite">
      <Brand />
      <div className="loading-state">
        <span className="loading-spinner" aria-hidden="true" />
        <strong>Restoring your session</strong>
      </div>
    </section>
  );
}

export default function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(preferredTheme);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const theme = mode === 'system' ? systemTheme : mode;
  const toggleTheme = () => setMode(theme === 'dark' ? 'light' : 'dark');
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiRequest<{ user: SessionUser | null }>('/api/auth/me'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const user = session.data?.user || null;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#0D1020' : '#F7F8FC',
    );
    try {
      window.localStorage.setItem('campusrelay-theme', mode);
    } catch {
      // The selected theme still applies for the current page.
    }
  }, [theme, mode]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const change = () => setSystemTheme(media?.matches ? 'light' : 'dark');
    media?.addEventListener?.('change', change);
    return () => media?.removeEventListener?.('change', change);
  }, []);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const clearInstallPrompt = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', clearInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', clearInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const clearExpiredSession = () => {
      queryClient.clear();
      queryClient.setQueryData(['session'], { user: null });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
  }, [queryClient]);

  useEffect(() => {
    if (!session.isSuccess || user) return;
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    });
  }, [queryClient, session.isSuccess, user]);

  async function handleAuthenticated(nextUser: SessionUser) {
    queryClient.setQueryData(['session'], { user: nextUser });
    await queryClient.invalidateQueries({ queryKey: ['groups'] });
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      queryClient.clear();
      queryClient.setQueryData(['session'], { user: null });
      navigate('/', { replace: true });
    }
  }

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function portal(role: Role) {
    if (session.isPending) return <LoadingScreen />;
    if (session.isError) {
      return (
        <section className="screen screen-active route-error" role="alert">
          <Brand />
          <h2>CampusRelay could not reach the server.</h2>
          <p>{session.error.message}</p>
          <button className="primary-button" type="button" onClick={() => session.refetch()}>Try again</button>
        </section>
      );
    }
    if (!user) return <AuthScreen role={role} onAuthenticated={handleAuthenticated} />;
    if (user.role !== role) return <Navigate to={`/${user.role}`} replace />;
    if (role === 'faculty') return <FacultyPortal user={user} onLogout={handleLogout} />;
    if (role === 'admin') return <AdminPortal user={user} onLogout={handleLogout} />;
    return <StudentPortal user={user} onLogout={handleLogout} />;
  }

  return (
    <ThemeContext.Provider value={{ value: theme, mode, setMode, toggle: toggleTheme }}>
    <DisplayProvider><DeviceShell>
      <RouteBoundary><Suspense fallback={<RouteLoading />}><Routes>
        <Route
          path="/"
          element={session.isPending ? <LoadingScreen /> : (
            <StartScreen
              user={user}
              theme={theme}
              onToggleTheme={toggleTheme}
              installAvailable={Boolean(installPrompt)}
              onInstall={handleInstall}
            />
          )}
        />
        <Route path="/faculty/*" element={portal('faculty')} />
        <Route path="/student/*" element={portal('student')} />
        <Route path="/admin/*" element={portal('admin')} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense></RouteBoundary>
    </DeviceShell></DisplayProvider>
    </ThemeContext.Provider>
  );
}

export { Brand, initials };
