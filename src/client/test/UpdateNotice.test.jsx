import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import UpdateNotice from '../components/UpdateNotice';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('offers an optional reload when the deployed build changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ buildId: 'new-build' }))));
  const reload = vi.fn();
  render(<UpdateNotice enabled buildId="old-build" onReload={reload} />);
  expect(await screen.findByRole('status')).toHaveTextContent('Save any unfinished work');
  expect(reload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Reload app' }));
  expect(reload).toHaveBeenCalledOnce();
});
it('can dismiss an update without reloading or disturbing current work', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ buildId: 'new-build' }))));
  const reload = vi.fn();
  render(<UpdateNotice enabled buildId="old-build" onReload={reload} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});
it('stays quiet for matching builds and unavailable release metadata', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ buildId: 'same-build' })));
  vi.stubGlobal('fetch', fetchMock);
  render(<UpdateNotice enabled buildId="same-build" />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
