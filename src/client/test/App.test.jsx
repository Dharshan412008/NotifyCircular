import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.jsx';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  if (!document.querySelector('meta[name="theme-color"]')) {
    const themeMeta = document.createElement('meta');
    themeMeta.name = 'theme-color';
    document.head.append(themeMeta);
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App shell preferences', () => {
  it('persists the selected color theme', async () => {
    const user = userEvent.setup();
    renderApp();
    const toggle = await screen.findByRole('switch', { name: /dark theme/i });

    await user.click(toggle);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('campusrelay-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#F7F8FC');
  });

  it('offers the captured browser installation prompt', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: /sign in to campusrelay/i });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: prompt },
      userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
    });

    act(() => window.dispatchEvent(event));
    const install = await screen.findByRole('button', { name: /install campusrelay/i });
    await user.click(install);

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('button', { name: /install campusrelay/i })).not.toBeInTheDocument());
  });
});
