import { useEffect, useState } from 'react';

export default function UpdateNotice({ buildId = import.meta.env.VITE_APP_BUILD_ID, enabled = import.meta.env.PROD, onReload = () => window.location.reload() }) {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!enabled || !buildId) return;
    let stopped = false;
    let pending;
    async function check() {
      if (document.visibilityState === 'hidden' || pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) return;
        const info = await response.json();
        if (!stopped && typeof info.buildId === 'string' && info.buildId && info.buildId !== buildId) setAvailable(true);
      } catch { /* Offline or a deployment in progress: try again later. */ }
      finally { clearTimeout(timeout); pending = null; }
    }
    check();
    const timer = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      stopped = true; clearInterval(timer); pending?.abort();
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [buildId, enabled]);
  if (!available || dismissed) return null;
  return <aside className="release-notice" role="status" aria-label="App update available">
    <div><strong>A CampusRelay update is available</strong><p>Save any unfinished work, then reload to get the latest features.</p></div>
    <button className="primary-button" onClick={onReload}>Reload app</button>
    <button className="inline-button" onClick={() => setDismissed(true)}>Later</button>
  </aside>;
}
