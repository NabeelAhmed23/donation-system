import { describe, expect, it, vi, type Mock } from 'vitest';
import { createApiClient } from './client';
import { ApiError, NetworkError } from './problem';

function response(status: number, body: unknown, contentType = 'application/json') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('createApiClient', () => {
  function setup() {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>();
    const api = createApiClient({ fetch: fetchMock, getCsrfToken: () => 'csrf-1' });
    return { fetchMock, api };
  }

  it('sends JSON with the CSRF token on writes', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));

    await api('/things', { method: 'POST', body: { a: 1 }, headers: { 'Idempotency-Key': 'k1' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/things');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
      'Idempotency-Key': 'k1',
    });
  });

  it('does not send the CSRF token on reads', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(response(200, []));

    await api('/things');

    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('parses problem+json into an ApiError with field errors', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      response(
        422,
        {
          title: 'Validation failed',
          detail: 'Amount must be greater than zero.',
          code: 'VALIDATION',
          errors: [
            { pointer: '/amount', detail: 'Must be greater than zero' },
            { field: 'currency', message: 'Unknown currency' },
            { message: 'no field, dropped' },
          ],
        },
        'application/problem+json',
      ),
    );

    const error = await api('/donations', { method: 'POST', body: {} }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('VALIDATION');
    expect(apiError.detail).toBe('Amount must be greater than zero.');
    expect(apiError.fieldErrors).toEqual([
      { field: 'amount', message: 'Must be greater than zero' },
      { field: 'currency', message: 'Unknown currency' },
    ]);
  });

  it('falls back to a status-only ApiError when the body is not JSON', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));

    const error = (await api('/things').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.fieldErrors).toEqual([]);
  });

  it('wraps transport failures in a NetworkError', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api('/things')).rejects.toBeInstanceOf(NetworkError);
  });

  it('returns undefined for 204 responses', async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api('/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
