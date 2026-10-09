/** A single field-level failure from an RFC 9457 problem+json `errors` array. */
export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  status: number;
  type?: string;
  title?: string;
  detail?: string;
  code?: string;
  errors?: FieldError[];
}

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly fieldErrors: FieldError[];

  constructor(problem: ProblemDetails) {
    super(problem.title ?? `Request failed with status ${problem.status}`);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.detail = problem.detail;
    this.fieldErrors = problem.errors ?? [];
  }
}

/** The request never produced a response (offline, DNS, connection reset). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause });
    this.name = 'NetworkError';
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return new ApiError(normaliseProblem(await response.json(), response.status));
    } catch {
      // Malformed body: fall through to a status-only error.
    }
  }
  return new ApiError({ status: response.status });
}

function normaliseProblem(body: unknown, status: number): ProblemDetails {
  if (typeof body !== 'object' || body === null) {
    return { status };
  }
  const raw = body as Record<string, unknown>;
  return {
    status,
    type: str(raw.type),
    title: str(raw.title),
    detail: str(raw.detail),
    code: str(raw.code),
    errors: fieldErrors(raw.errors),
  };
}

function fieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): FieldError[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    const field = str(entry.field) ?? pointerToField(str(entry.pointer));
    const message = str(entry.message) ?? str(entry.detail);
    return field && message ? [{ field, message }] : [];
  });
}

/** "#/address/postcode" or "/address/postcode" becomes "address.postcode". */
function pointerToField(pointer: string | undefined): string | undefined {
  if (!pointer) {
    return undefined;
  }
  return pointer.replace(/^#?\//, '').split('/').join('.') || undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
