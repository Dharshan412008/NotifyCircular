import type { LucideIcon } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeMode = 'system' | 'light' | 'dark';
interface ThemeState { value: 'light' | 'dark'; mode: ThemeMode; setMode: (mode: ThemeMode) => void; toggle: () => void }
export const ThemeContext = createContext<ThemeState | null>(null);
const choices: [ThemeMode, string, LucideIcon][] = [['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]];

export function ThemePreference() {
  const theme = useContext(ThemeContext);
  if (!theme?.setMode) return null;
  return (
    <fieldset className="theme-preference">
      <legend>Appearance</legend>
      <p>Choose a theme, or follow your device.</p>
      <div className="theme-options">
        {choices.map(([value, label, Icon]) => (
          <label className={`theme-option${theme.mode === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="campusrelay-appearance" value={value} checked={theme.mode === value} onChange={() => theme.setMode(value)} />
            <Icon aria-hidden="true" /><span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function PortalThemeButton() {
  const theme = useContext(ThemeContext);
  if (!theme) return null;
  return (
    <button className="icon-button portal-theme-button" type="button" role="switch" aria-label="Dark theme" aria-checked={theme.value === 'dark'} title={`Use ${theme.value === 'dark' ? 'light' : 'dark'} theme`} onClick={theme.toggle}>
      {theme.value === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
