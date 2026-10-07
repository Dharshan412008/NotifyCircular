interface ErrorOptions { status?: number; code?: string; details?: unknown; cause?: unknown }
export type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };
export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(message: string, { status = 0, code = 'request_failed', details = null, cause }: ErrorOptions = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const AUTH_EXPIRED_EVENT = 'campusrelay:auth-expired';

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: suppliedHeaders, ...requestOptions } = options;
  const hasBody = body !== undefined;
  const headers = new Headers(suppliedHeaders);

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...requestOptions,
      credentials: 'same-origin',
      headers,
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    throw new ApiError('Could not reach the server. Check your connection and try again.', {
      code: 'network_error',
      cause,
    });
  }

  let payload: unknown = null;
  const responseText = await response.text();
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (cause) {
      throw new ApiError('The server returned an invalid response.', {
        status: response.status,
        code: 'invalid_response',
        cause,
      });
    }
  }

  if (!response.ok) {
    const envelope = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    const serverError = typeof envelope.error === 'object' && envelope.error !== null ? envelope.error as Record<string, unknown> : {};
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(
      typeof serverError?.message === 'string' && serverError.message.trim()
        ? serverError.message
        : `Request failed with status ${response.status}.`,
      {
        status: response.status,
        code: typeof serverError.code === 'string' ? serverError.code : 'request_failed',
        details: serverError?.details ?? null,
      },
    );
  }

  return payload as T;
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
