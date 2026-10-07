import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FacultyPortal from '../components/FacultyPortal.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FacultyPortal', () => {
  it('keeps multiple selected groups through review and send', async () => {
    const groups = [
      { id: 1, slug: 'first-year', name: 'First Year', description: 'Year one', icon: '1Y', kind: 'year', memberCount: 18 },
      { id: 5, slug: 'sports', name: 'Sports Group', description: 'Campus teams', icon: 'SP', kind: 'activity', memberCount: 7 },
    ];
    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/groups') {
        return new Response(JSON.stringify({ groups }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/api/copilot/typeahead') {
        return new Response(JSON.stringify({ suggestedGroups: [], urgency: 'normal', summary: 'Sports briefing', detectedDate: '2026-09-14' }), { status: 200 });
      }
      if (path === '/api/circulars' && request.method === 'POST') {
        return new Response(JSON.stringify({
          circular: { id: 11 },
          delivery: { audienceCount: 25, pushCount: 0, emailFallbackCount: 25 },
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${path} ${request.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/faculty/compose']}>
          <Routes>
            <Route
              path="/faculty/*"
              element={(
                <FacultyPortal
                  user={{ id: 1, name: 'Dr. Meera Shah', email: 'faculty@demo.edu', role: 'faculty' }}
                  onLogout={vi.fn()}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText(/membership routing online/i);
    await user.type(screen.getByLabelText(/circular message/i), 'The first-year sports briefing starts Monday at 10 AM.');
    await screen.findByText('No audience suggestions');
    await user.click(screen.getByRole('button', { name: /add group/i }));
    await user.click(await screen.findByRole('checkbox', { name: /first year/i }));
    await user.click(screen.getByRole('checkbox', { name: /sports group/i }));
    await user.click(screen.getByRole('button', { name: /use 2 groups/i }));
    await user.click(screen.getByRole('button', { name: /review & send/i }));
    expect(screen.getByText(/first year, sports group/i)).toBeInTheDocument();
    expect(screen.getByText(/25 students/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^send circular/i }));

    await screen.findByText(/routed to 25 students/i);
    const sendCall = fetchMock.mock.calls.find(([path, request]) => path === '/api/circulars' && request.method === 'POST');
    expect(JSON.parse(sendCall[1].body)).toEqual({
      text: 'The first-year sports briefing starts Monday at 10 AM.',
      targetGroupIds: [1, 5],
      detectedDate: '2026-09-14',
      urgency: 'normal',
      summary: 'Sports briefing',
      requiresAcknowledgment: false,
    });
    await waitFor(() => expect(screen.getByLabelText(/circular message/i)).toHaveValue(''));
  });

  it('does not replace memberships when the member list fails to load', async () => {
    const group = {
      id: 5,
      slug: 'sports',
      name: 'Sports Group',
      description: 'Campus teams',
      icon: 'SP',
      kind: 'activity',
      memberCount: 1,
    };
    let memberLoadCount = 0;
    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/groups') {
        return new Response(JSON.stringify({ groups: [group] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path === '/api/students') {
        return new Response(JSON.stringify({
          students: [{ id: 7, name: 'Asha Rao', email: 'asha@demo.edu', year: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/api/groups/5/members' && request.method !== 'PUT') {
        memberLoadCount += 1;
        if (memberLoadCount === 1) {
          return new Response(JSON.stringify({
            error: { code: 'unavailable', message: 'Members are temporarily unavailable.' },
          }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          group,
          memberIds: [7],
          students: [{ id: 7, name: 'Asha Rao', email: 'asha@demo.edu', year: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/api/groups/5/members' && request.method === 'PUT') {
        return new Response(JSON.stringify({ group, memberIds: [7], students: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${path} ${request.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/faculty/groups']}>
          <Routes>
            <Route
              path="/faculty/*"
              element={(
                <FacultyPortal
                  user={{ id: 1, name: 'Dr. Meera Shah', email: 'faculty@demo.edu', role: 'faculty' }}
                  onLogout={vi.fn()}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /manage/i }));
    expect(await screen.findByText(/members are temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save 0 members/i })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([path, request]) => (
      path === '/api/groups/5/members' && request.method === 'PUT'
    ))).toBe(false);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('checkbox', { name: /asha rao/i })).toBeChecked();
    const saveButton = screen.getByRole('button', { name: /save 1 member/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(([path, request]) => (
        path === '/api/groups/5/members' && request.method === 'PUT'
      ));
      expect(JSON.parse(updateCall[1].body)).toEqual({ studentIds: [7] });
    });
  });
});
