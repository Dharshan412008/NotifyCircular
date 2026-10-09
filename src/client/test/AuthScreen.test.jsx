import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AuthScreen from '../components/AuthScreen.jsx';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function renderAuth(props) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AuthScreen {...props} /></MemoryRouter></QueryClientProvider>);
}
it('offers only college Google sign-in without demo credentials or a Google password field', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ localAuth: false, googleEnabled: true, domains: ['srishakthi.ac.in'] })));
  renderAuth({ role: 'student' });
  expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  expect(screen.getByText(/@srishakthi.ac.in/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.queryByText(/try now|guided demo|asha rao/i)).not.toBeInTheDocument();
});
it('passes the selected portal to explicitly enabled local login', async () => {
  const onAuthenticated = vi.fn();
  const fetchMock = vi.fn(async (path) => path === '/api/auth/options' ? json({ localAuth: true, googleEnabled: false, domains: ['srishakthi.ac.in'] }) : json({ user: { id: 1, role: 'faculty', name: 'Faculty' } }));
  vi.stubGlobal('fetch', fetchMock);
  renderAuth({ role: 'faculty', onAuthenticated });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email address'), 'faculty@srishakthi.ac.in');
  await user.type(screen.getByLabelText('Password'), 'LocalPass123!');
  await user.click(screen.getByRole('button', { name: 'Sign in securely' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([path]) => path === '/api/auth/login');
  expect(JSON.parse(call[1].body).role).toBe('faculty');
});
it('shows setup status and disables Google sign-in until configured', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ localAuth: false, googleEnabled: false, domains: ['srishakthi.ac.in'] })));
  renderAuth({ role: 'faculty' });
  expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
  expect(screen.getByText(/awaiting administrator setup/)).toBeInTheDocument();
});

it('registers a student with a college email and rejects lookalike domains', async () => {
  const fetchMock = vi.fn(async (path) => path === '/api/auth/options' ? json({ localAuth: true, collegePasswordAuth: true, domains: ['srishakthi.ac.in'] }) : json({ user: { id: 2, role: 'student' } }));
  vi.stubGlobal('fetch', fetchMock);
  const onAuthenticated = vi.fn();
  renderAuth({ role: 'student', onAuthenticated });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New student? Create an account' }));
  expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Full name'), 'College Student');
  await user.type(screen.getByLabelText('Email address'), 'student@srishakthi.ac.in.attacker.com');
  await user.type(screen.getByLabelText('Password'), 'Secure123!');
  await user.click(screen.getByRole('button', { name: 'Create student account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ending in @srishakthi.ac.in');
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/auth/register')).toBe(false);
  await user.clear(screen.getByLabelText('Email address'));
  await user.type(screen.getByLabelText('Email address'), 'student@srishakthi.ac.in');
  await user.click(screen.getByRole('button', { name: 'Create student account' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([path]) => path === '/api/auth/register');
  expect(JSON.parse(call[1].body)).toMatchObject({ name: 'College Student', year: 1 });
});

it('requires the email code before authentication and supports resend', async () => {
  const fetchMock = vi.fn(async (path) => {
    if (path === '/api/auth/options') return json({ localAuth: true, collegePasswordAuth: true, domains: ['srishakthi.ac.in'] });
    if (path === '/api/auth/login') return json({ verificationRequired: true, email: 'student@srishakthi.ac.in' });
    if (path === '/api/auth/verification/resend') return json({ verificationRequired: true });
    return json({ user: { id: 2, role: 'student' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onAuthenticated = vi.fn();
  renderAuth({ role: 'student', onAuthenticated });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email address'), 'student@srishakthi.ac.in');
  await user.type(screen.getByLabelText('Password'), 'Secure123!');
  await user.click(screen.getByRole('button', { name: 'Sign in securely' }));
  const input = await screen.findByLabelText('Verification code');
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(await screen.findByRole('status')).toHaveTextContent('A new code has been sent');
  await user.type(input, '123456');
  await user.click(screen.getByRole('button', { name: 'Verify email' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([path]) => path === '/api/auth/verification/confirm');
  expect(JSON.parse(call[1].body)).toEqual({ code: '123456' });
});
