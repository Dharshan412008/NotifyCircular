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

  it('does not approve requests when group management fails to load', async () => {
    const group = {id:5,name:'Sports Group',kind:'activity',canManage:true,department:'',category:'community'};
    let loads=0;
    const fetchMock=vi.fn(async(path,request={})=>{
      let payload={}; let status=200;
      if(path==='/api/groups')payload={groups:[group]};
      else if(path==='/api/academics')payload={classes:[],subjects:[]};
      else if(path==='/api/community/requests')payload={requests:[]};
      else if(path==='/api/community/groups/5'){
        loads++;
        if(loads===1){status=503;payload={error:{message:'Members are temporarily unavailable.'}};}
        else payload={group,facultyIds:[1],invitations:[],requests:loads===2?[{id:8,student_id:7,name:'Asha Rao',email:'asha@demo.edu'}]:[]};
      }else if(path==='/api/community/join-requests/8/review')payload={ok:true};
      else if(path==='/api/platform/notifications')payload={notifications:[],unread:0};
      else throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
    });
    vi.stubGlobal('fetch',fetchMock);
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const user=userEvent.setup();
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/faculty/groups']}><Routes><Route path="/faculty/*" element={<FacultyPortal user={{id:1,name:'Dr Meera Shah',role:'faculty'}} onLogout={vi.fn()}/>} /></Routes></MemoryRouter></QueryClientProvider>);
    await user.click(await screen.findByRole('button',{name:/^manage/i}));
    expect(await screen.findByText(/members are temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Approve Asha Rao'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([_path,req])=>req?.method==='POST')).toBe(false);
    await user.click(screen.getByRole('button',{name:'Retry group management'}));
    await user.click(await screen.findByRole('button',{name:'Approve Asha Rao'}));
    await waitFor(()=>{
      const call=fetchMock.mock.calls.find(([path])=>path==='/api/community/join-requests/8/review');
      expect(call).toBeTruthy();expect(JSON.parse(call[1].body)).toEqual({decision:'approve'});
    });
  });
});
