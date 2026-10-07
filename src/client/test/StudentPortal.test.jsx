import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import StudentPortal from '../components/StudentPortal.jsx';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(window.navigator, 'serviceWorker');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalServiceWorker) {
    Object.defineProperty(window.navigator, 'serviceWorker', originalServiceWorker);
  } else {
    delete window.navigator.serviceWorker;
  }
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderStudent(path, fetchMock) {
  vi.stubGlobal('fetch', (url, options) => String(url).includes('/api/platform/notifications') ? Promise.resolve(jsonResponse({ notifications: [], unread: 0 })) : fetchMock(url, options));
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/student/*"
            element={(
              <StudentPortal
                user={{ id: 7, name: 'Asha Rao', email: 'asha@demo.edu', role: 'student', year: 1 }}
                onLogout={vi.fn()}
              />
            )}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { client, user };
}

function circular(overrides = {}) {
  return {
    id: 12,
    text: 'Attendance is mandatory for the laboratory briefing on 15 September 2026.',
    createdAt: '2026-08-30T08:00:00.000Z',
    detectedDate: '2026-09-15',
    detectedDateText: '15 September 2026',
    urgency: 'urgent',
    summary: 'Mandatory laboratory briefing',
    requiresAcknowledgment: true,
    readAt: null,
    acknowledgedAt: null,
    faculty: { id: 1, name: 'Dr. Meera Shah', email: 'faculty@demo.edu' },
    targets: [{ id: 1, name: 'First Year', slug: 'first-year' }],
    ...overrides,
  };
}

describe('StudentPortal Tier 2 controls', () => {
  it('combines URL group, date and status filters, sorts results, and resets every control', async () => {
    const currentDate = new Date().toISOString();
    const fetchMock = vi.fn(async () => jsonResponse({ circulars: [
      circular({ id: 101, summary: 'Recent urgent', createdAt: currentDate }),
      circular({ id: 102, summary: 'Recent ordinary', createdAt: currentDate, urgency: 'normal' }),
      circular({ id: 103, summary: 'Another audience', createdAt: currentDate, targets: [{ id: 2, name: 'Sports' }] }),
      circular({ id: 104, summary: 'Old urgent', createdAt: '2020-01-01T00:00:00Z' }),
    ] }));
    const { user } = renderStudent('/student?group=1&days=7&sort=priority', fetchMock);
    await screen.findByText('Showing 2 of 4 notices');
    expect(screen.queryByRole('button', { name: /Another audience/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Old urgent/ })).not.toBeInTheDocument();
    expect(document.querySelector('.inbox-list .circular-summary')).toHaveTextContent('Recent urgent');
    await user.click(screen.getByRole('button', { name: 'Urgent', exact: true }));
    expect(screen.getByText('Showing 1 of 4 notices')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByText('Showing 4 of 4 notices')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Audience group' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Received' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Sort notices' })).toHaveValue('newest');
  });

  it('lists upcoming dates in order, includes today, and loads events beyond the first inbox page', async () => {
    const dateKey = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const firstPage = Array.from({ length: 100 }, (_, index) => circular({ id: index + 100, detectedDate: null }));
    firstPage[0] = circular({ id: 50, summary: 'Tomorrow workshop', detectedDate: dateKey(1) });
    firstPage[1] = circular({ id: 51, summary: 'Yesterday workshop', detectedDate: dateKey(-1) });
    const fetchMock = vi.fn(async (path) => {
      if (path === '/api/inbox') return jsonResponse({ circulars: firstPage });
      if (path === '/api/inbox?offset=100') return jsonResponse({ circulars: [circular({ id: 52, summary: 'Today workshop', detectedDate: dateKey(0) })] });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderStudent('/student/events', fetchMock);

    await screen.findByRole('heading', { name: 'Today workshop' });
    expect(screen.getByRole('button', { name: 'Events', exact: true })).toHaveAttribute('aria-current', 'page');
    const events = screen.getAllByRole('article');
    expect(events).toHaveLength(2);
    expect(within(events[0]).getByRole('heading', { name: 'Today workshop' })).toBeInTheDocument();
    expect(within(events[0]).getByText('Today', { exact: true })).toBeInTheDocument();
    expect(within(events[1]).getByRole('heading', { name: 'Tomorrow workshop' })).toBeInTheDocument();
    expect(screen.queryByText('Yesterday workshop')).not.toBeInTheDocument();
    expect(within(events[0]).getByRole('link', { name: 'Calendar file' })).toHaveAttribute('href', '/api/circulars/52/calendar.ics');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks all notices read while preserving required acknowledgments and pending feedback', async () => {
    let finishRead;
    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/inbox') return jsonResponse({ circulars: [circular(), circular({ id: 13, requiresAcknowledgment: false })] });
      if (path === '/api/inbox/read-all' && request.method === 'POST') return new Promise((resolve) => { finishRead = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });
    const { user, client } = renderStudent('/student', fetchMock);
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(screen.getByRole('button', { name: 'Marking as read...' })).toBeDisabled();
    finishRead(jsonResponse({ updatedCount: 2, circularIds: [12, 13], readAt: '2026-09-10T10:00:00.000Z' }));
    await screen.findByText(/2 notices marked as read/);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(client.getQueryData(['inbox', 7]).every((notice) => notice.readAt && !notice.acknowledgedAt)).toBe(true);
    expect(screen.getByText('1 notice needs your acknowledgment')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/ack'))).toBe(false);
  });

  it('keeps notices unread and enables retry if marking all fails', async () => {
    const fetchMock = vi.fn(async (path) => path === '/api/inbox'
      ? jsonResponse({ circulars: [circular()] })
      : jsonResponse({ error: { message: 'Could not update notices.' } }, 503));
    const { user, client } = renderStudent('/student', fetchMock);
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update notices.');
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeEnabled();
    expect(client.getQueryData(['inbox', 7])[0].readAt).toBeNull();
  });

  it('presents digest, urgency, and required acknowledgment state in the inbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      circulars: [
        circular(),
        circular({
          id: 13,
          summary: 'Library hours update',
          text: 'For your information, library hours change next week.',
          urgency: 'fyi',
          requiresAcknowledgment: false,
          detectedDate: null,
          detectedDateText: null,
          readAt: '2026-08-30T09:00:00.000Z',
        }),
      ],
    }));

    renderStudent('/student', fetchMock);

    const urgentCard = await screen.findByRole('button', { name: /mandatory laboratory briefing/i });
    expect(within(urgentCard).getByText('Urgent')).toHaveClass('urgency-pill', 'urgent');
    expect(within(urgentCard).getByText('Acknowledgment required')).toHaveClass('ack-pill');
    expect(within(urgentCard).getByText('Mandatory laboratory briefing')).toHaveClass('circular-summary');
    expect(screen.getByText('FYI')).toHaveClass('urgency-pill', 'fyi');
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole('button', { name: 'Needs action', exact: true }));
    expect(screen.queryByRole('button', { name: /library hours update/i })).not.toBeInTheDocument();
    await interaction.type(screen.getByRole('searchbox', { name: 'Search notices' }), 'does not exist');
    expect(screen.getByText('No matching notices')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('button', { name: /library hours update/i })).toBeInTheDocument();
  });

  it('acknowledges a required circular and offers calendar export only for its detected date', async () => {
    const notice = circular({ readAt: '2026-08-30T08:05:00.000Z' });
    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/circulars/12' && !request.method) {
        return jsonResponse({ circular: notice });
      }
      if (path === '/api/circulars/12/ack' && request.method === 'POST') {
        return jsonResponse({
          status: {
            readAt: notice.readAt,
            acknowledgedAt: '2026-08-30T08:10:00.000Z',
          },
        });
      }
      throw new Error(`Unexpected request: ${path} ${request.method || 'GET'}`);
    });
    const { user } = renderStudent('/student/circulars/12', fetchMock);

    await screen.findByRole('heading', { name: 'Mandatory laboratory briefing' });
    expect(screen.getByText('Urgent')).toHaveClass('urgency-pill', 'urgent');
    expect(screen.getByText('15 September 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add to calendar/i })).toHaveAttribute(
      'href',
      '/api/circulars/12/calendar.ics',
    );

    await user.click(screen.getByRole('button', { name: /^acknowledge$/i }));

    await screen.findByText('Acknowledged');
    expect(screen.queryByRole('button', { name: /^acknowledge$/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/circulars/12/ack', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('registers, stores, and removes a browser push subscription', async () => {
    const serializedSubscription = {
      endpoint: 'https://push.example.test/subscriptions/asha',
      expirationTime: null,
      keys: { p256dh: 'example-p256dh', auth: 'example-auth' },
    };
    const subscription = {
      endpoint: serializedSubscription.endpoint,
      toJSON: vi.fn(() => serializedSubscription),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    };
    const registration = { active: {}, pushManager };
    const serviceWorker = {
      getRegistration: vi.fn().mockResolvedValue(null),
      register: vi.fn().mockResolvedValue(registration),
    };
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    const notification = {
      permission: 'default',
      requestPermission: vi.fn(async () => {
        notification.permission = 'granted';
        return 'granted';
      }),
    };
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('PushManager', class PushManager {});

    const fetchMock = vi.fn(async (path, request = {}) => {
      if (path === '/api/push/key') return jsonResponse({ publicKey: 'AQIDBAUGBwgJCgsMDQ4PEA' });
      if (path === '/api/push/subscribe' && request.method === 'POST') return jsonResponse({ ok: true }, 201);
      if (path === '/api/push/subscribe' && request.method === 'DELETE') return jsonResponse({ ok: true, removed: true });
      throw new Error(`Unexpected request: ${path} ${request.method || 'GET'}`);
    });
    const { user } = renderStudent('/student/account', fetchMock);

    await user.click(await screen.findByRole('button', { name: /enable notifications/i }));
    await screen.findByRole('button', { name: /disable notifications/i });

    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    }));
    const subscribeRequest = fetchMock.mock.calls.find(
      ([path, request]) => path === '/api/push/subscribe' && request.method === 'POST',
    );
    expect(JSON.parse(subscribeRequest[1].body)).toEqual({ subscription: serializedSubscription });

    await user.click(screen.getByRole('button', { name: /disable notifications/i }));
    await screen.findByRole('button', { name: /enable notifications/i });
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    const unsubscribeRequest = fetchMock.mock.calls.find(
      ([path, request]) => path === '/api/push/subscribe' && request.method === 'DELETE',
    );
    expect(JSON.parse(unsubscribeRequest[1].body)).toEqual({ endpoint: subscription.endpoint });
  });

  it('shows a retryable error when notification worker registration fails', async () => {
    const serviceWorker = {
      getRegistration: vi.fn().mockResolvedValue(null),
      register: vi.fn().mockRejectedValue(new Error('Notification worker could not be installed.')),
    };
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn(),
    });
    vi.stubGlobal('PushManager', class PushManager {});
    const fetchMock = vi.fn();
    const { user } = renderStudent('/student/account', fetchMock);

    await user.click(await screen.findByRole('button', { name: /enable notifications/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Notification worker could not be installed.');
    expect(screen.getByRole('button', { name: /retry notifications/i })).toBeEnabled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/push/subscribe'))).toBe(false);
  });
});
