import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthScreen from '../components/AuthScreen.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAuth(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthScreen {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AuthScreen', () => {
  it('uses the real faculty login endpoint for the guided demo', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 1, name: 'Dr. Meera Shah', email: 'faculty@demo.edu', role: 'faculty', year: null },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderAuth({ role: 'faculty', onAuthenticated });
    await user.click(screen.getByRole('button', { name: /dr\. meera shah/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({
      role: 'faculty',
      email: 'faculty@demo.edu',
    })));
    const [, request] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
    expect(JSON.parse(request.body)).toEqual({
      email: 'faculty@demo.edu',
      password: 'Faculty123!',
    });
  });

  it('registers students with normalized year and selected activity IDs', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/groups') {
        return new Response(JSON.stringify({
          groups: [{ id: 5, name: 'Sports Group', icon: 'SP', kind: 'activity', joinable: true }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/api/auth/register') {
        return new Response(JSON.stringify({
          user: { id: 9, name: 'Neha Patel', email: 'neha@campus.edu', role: 'student', year: 2 },
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${path} ${request.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderAuth({ role: 'student', onAuthenticated });
    await user.click(screen.getByRole('button', { name: /create your account/i }));
    await screen.findByText(/sports group/i);
    await user.type(screen.getByLabelText(/full name/i), 'Neha Patel');
    await user.type(screen.getByLabelText(/college email/i), 'neha@campus.edu');
    await user.type(screen.getByLabelText(/create password/i), 'SecurePass123!');
    await user.selectOptions(screen.getByLabelText(/study year/i), '2');
    await user.click(screen.getByLabelText(/sports group/i));
    await user.click(screen.getByRole('button', { name: /create student account/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({ id: 9, year: 2 })));
    const registrationCall = fetchMock.mock.calls.find(([path]) => path === '/api/auth/register');
    expect(JSON.parse(registrationCall[1].body)).toEqual({
      name: 'Neha Patel',
      email: 'neha@campus.edu',
      password: 'SecurePass123!',
      year: 2,
      activityGroupIds: [5],
    });
  });
});
