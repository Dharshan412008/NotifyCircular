import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CircularExtras } from '../components/PlatformTools.jsx';
import CreateGroupDialog from '../components/CreateGroupDialog';

describe('WhatsApp and Discord Sharing in CircularExtras', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.restoreAllMocks();
  });

  const sampleCircular = {
    id: 42,
    title: 'Semester End Examination Schedule',
    summary: 'Exams begin next week for computing students.',
    priority: 'urgent',
    category: 'Exams',
    text: 'All students must collect their hall tickets from the office.',
    detectedDate: '2026-10-20',
    createdAt: '2026-10-09T10:00:00Z',
    location: 'Exam Hall 3',
    saved: false,
    attachments: [],
  };

  it('renders WhatsApp share and Discord copy buttons', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CircularExtras circular={sampleCircular} user={{ role: 'student' }} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: /whatsapp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy for discord/i })).toBeInTheDocument();
  });

  it('opens WhatsApp with pre-formatted message on click', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <CircularExtras circular={sampleCircular} user={{ role: 'student' }} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: /whatsapp/i }));
    expect(openSpy).toHaveBeenCalledOnce();
    const calledUrl = openSpy.mock.calls[0][0];
    expect(calledUrl).toContain('https://api.whatsapp.com/send?text=');
    expect(calledUrl).toContain(encodeURIComponent('Semester End Examination Schedule'));
  });

  it('copies Discord-formatted markdown to clipboard and shows feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CircularExtras circular={sampleCircular} user={{ role: 'student' }} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy for discord/i }));
    expect(writeTextMock).toHaveBeenCalledOnce();
    const copiedText = writeTextMock.mock.calls[0][0];
    expect(copiedText).toContain('**📢 Semester End Examination Schedule**');
    expect(copiedText).toContain('Exam Hall 3');
    expect(await screen.findByText(/copied for discord/i)).toBeInTheDocument();
  });
});

describe('Default Permissions in CreateGroupDialog', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('defaults joining permission ("Students can join this group") to checked/allowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ students: [], groups: [] }),
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <CreateGroupDialog role="faculty" onClose={() => {}} />
      </QueryClientProvider>,
    );

    const joinableCheckbox = screen.getByLabelText(/students can join this group/i);
    expect(joinableCheckbox).toBeChecked();
  });
});
