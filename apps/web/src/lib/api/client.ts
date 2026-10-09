import { NetworkError, toApiError } from './problem';

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Synchroniser token sent on every non-GET request. */
  getCsrfToken?: () => string | undefined;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ApiClient = <T>(path: string, options?: RequestOptions) => Promise<T>;

export function createApiClient({
  baseUrl = '/api/v1',
  fetch: doFetch = (input, init) => globalThis.fetch(input, init),
  getCsrfToken,
}: ApiClientOptions = {}): ApiClient {
  return async <T>(path: string, { method = 'GET', body, headers = {}, signal }: RequestOptions = {}) => {
    const requestHeaders: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      ...headers,
    };
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (method !== 'GET') {
      const token = getCsrfToken?.();
      if (token) {
        requestHeaders['X-CSRF-Token'] = token;
      }
    }

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (cause) {
      throw new NetworkError(cause);
    }

    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };
}
