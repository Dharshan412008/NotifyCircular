import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest, AUTH_EXPIRED_EVENT } from '../api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiRequest', () => {
  it('keeps the structured server error on rejected requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'forbidden',
        message: 'Faculty access required.',
        details: { role: 'student' },
      },
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(apiRequest('/api/circulars')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
      details: { role: 'student' },
      message: 'Faculty access required.',
    });
  });

  it('reports network failures as ApiError instances', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(apiRequest('/api/health')).rejects.toBeInstanceOf(ApiError);
  });

  it('signals the application when an authenticated request expires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'unauthorized', message: 'Authentication required.' },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener, { once: true });

    await expect(apiRequest('/api/inbox')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
  });
});
