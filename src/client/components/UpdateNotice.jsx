import { useEffect, useRef, useState } from 'react';

export default function UpdateNotice({ buildId = import.meta.env.VITE_APP_BUILD_ID, enabled = import.meta.env.PROD, onReload = () => window.location.reload() }) {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
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
  useEffect(() => {
    if (available && !dismissed && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [available, dismissed]);
  async function update() {
    setUpdating(true); setError('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('The update server is temporarily unavailable. Please try again.');
      const info = await response.json();
      if (!info.buildId) throw new Error('The update is not ready yet. Please try again shortly.');
      await onReload();
    } catch {
      setUpdating(false);
      setError('Could not load the update. Check your connection and try again.');
    } finally { clearTimeout(timeout); }
  }
  if (!available || dismissed) return null;
  return <dialog ref={dialog} className="release-dialog" aria-labelledby="release-title" onCancel={(event) => { if (updating) event.preventDefault(); else setDismissed(true); }}>
    <div className="release-content" aria-busy={updating}>
      <div className="release-brand"><img src="/icon.svg" alt="" /><span>CampusRelay</span></div>
      {updating ? <>
        <div className="release-loader" aria-hidden="true" />
        <h2 id="release-title">Updating CampusRelay</h2>
        <p role="status">Loading the latest version. Please keep this window open.</p>
        <progress aria-label="Loading the app update" />
      </> : <>
        <span className="soft-badge">A newer version is ready</span>
        <h2 id="release-title">Update available</h2>
        <p>Get the latest CampusRelay improvements on this device.</p>
        <div className="release-app"><img src="/icon.svg" alt="" /><div><strong>CampusRelay</strong><small>College circulars & campus conversations</small></div></div>
        <details className="release-details"><summary>What’s new</summary><ul><li>Complete student and faculty profiles</li><li>Faculty demo and mobile improvements</li><li>App update notifications</li></ul></details>
        <p className="release-save-note">Save any unfinished work before updating. The app will reload.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="release-actions"><button className="secondary-button" onClick={() => setDismissed(true)}>Later</button><button className="primary-button" onClick={update}>{error ? 'Retry update' : 'Update'}</button></div>
      </>}
    </div>
  </dialog>;
}
