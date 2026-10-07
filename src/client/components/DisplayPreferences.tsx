import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

type Preferences = { accent: 'aurora' | 'ocean' | 'rose'; density: 'comfortable' | 'compact'; motion: 'system' | 'reduced' };
const defaults: Preferences = { accent: 'aurora', density: 'comfortable', motion: 'system' };
const storageKey = 'campusrelay-display';
const Context = createContext<{ preferences: Preferences; update: (value: Partial<Preferences>) => void } | null>(null);

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
    return {
      accent: ['ocean', 'rose'].includes(value.accent) ? value.accent : 'aurora',
      density: value.density === 'compact' ? 'compact' : 'comfortable',
      motion: value.motion === 'reduced' ? 'reduced' : 'system',
    };
  } catch { return defaults; }
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = preferences.accent;
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.motion = preferences.motion;
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Apply even if storage is unavailable. */ }
  }, [preferences]);
  return <Context.Provider value={{ preferences, update: (value) => setPreferences((current) => ({ ...current, ...value })) }}>{children}</Context.Provider>;
}

export default function DisplayPreferences() {
  const context = useContext(Context);
  if (!context) return null;
  const { preferences, update } = context;
  return <fieldset className="display-preferences">
    <legend>Personalize your workspace</legend>
    <p>These choices apply to this browser and are saved automatically.</p>
    <div className="discovery-controls">
      <label className="field"><span>Accent color</span><select value={preferences.accent} onChange={(event) => update({ accent: event.target.value as Preferences['accent'] })}><option value="aurora">Aurora violet</option><option value="ocean">Ocean teal</option><option value="rose">Rose berry</option></select></label>
      <label className="field"><span>Card spacing</span><select value={preferences.density} onChange={(event) => update({ density: event.target.value as Preferences['density'] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      <label className="field"><span>Motion effects</span><select value={preferences.motion} onChange={(event) => update({ motion: event.target.value as Preferences['motion'] })}><option value="system">Follow device</option><option value="reduced">Reduce motion</option></select></label>
    </div>
    <button className="inline-button" type="button" onClick={() => update(defaults)}>Reset display preferences</button>
  </fieldset>;
}
