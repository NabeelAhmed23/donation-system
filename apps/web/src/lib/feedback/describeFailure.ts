import { ApiError, NetworkError, type FieldError } from '../api/problem';

export type FailureKind =
  | 'validation'
  | 'permission'
  | 'session-expired'
  | 'conflict'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'unknown';

export interface FailureMessage {
  kind: FailureKind;
  title: string;
  message: string;
  fieldErrors: FieldError[];
}

const NOTHING_CHANGED = 'Nothing was changed.';

/**
 * Turns any error thrown by a save into a message that names its cause.
 *
 * `action` completes sentences such as "You do not have permission to …", e.g. "cancel this
 * donation" or "save these changes".
 */
export function describeFailure(error: unknown, action: string): FailureMessage {
  if (error instanceof NetworkError) {
    return failure(
      'network',
      'Could not reach the server',
      `We lost contact with the server while trying to ${action}, so we cannot confirm whether it worked. Check your connection and try again.`,
    );
  }
  if (!(error instanceof ApiError)) {
    return unknownFailure(action);
  }

  const { status } = error;
  if (status === 400 || status === 422) {
    const cause = error.detail ? trimSentence(error.detail) : 'some values were not accepted';
    return failure(
      'validation',
      'Some details need correcting',
      `We could not ${action}: ${cause}. ${NOTHING_CHANGED}`,
      error.fieldErrors,
    );
  }
  if (status === 401) {
    return failure(
      'session-expired',
      'Your session has expired',
      `You were signed out before you could ${action}. ${NOTHING_CHANGED} Sign in again and retry; what you entered has been kept.`,
    );
  }
  if (status === 403 && error.code === 'PERMISSIONS_CHANGED') {
    return failure(
      'permission',
      'Your permissions have changed',
      `Your permissions changed while you were working, so you can no longer ${action}. ${NOTHING_CHANGED}`,
    );
  }
  if (status === 403) {
    return failure(
      'permission',
      "You don't have permission",
      `You do not have permission to ${action}. ${NOTHING_CHANGED} Ask an organisation administrator if you need this access.`,
    );
  }
  if (status === 404) {
    return failure(
      'not-found',
      'Record not found',
      `We could not ${action} because the record no longer exists or you cannot access it. ${NOTHING_CHANGED}`,
    );
  }
  if (status === 409 || status === 412) {
    return failure(
      'conflict',
      'Changed by someone else',
      `We could not ${action} because the record was changed after you opened it. ${NOTHING_CHANGED} Reload to see the latest version, then try again.`,
    );
  }
  if (status === 429) {
    return failure(
      'rate-limited',
      'Too many requests',
      `We could not ${action} because too many requests were made. ${NOTHING_CHANGED} Wait a moment, then try again.`,
    );
  }
  // 5xx and anything unexpected: never surface server detail, it may describe internals.
  return unknownFailure(action);
}

export function fieldError(failure: FailureMessage | undefined, field: string): string | undefined {
  return failure?.fieldErrors.find((entry) => entry.field === field)?.message;
}

function unknownFailure(action: string): FailureMessage {
  return failure(
    'unknown',
    'Something went wrong',
    `We could not ${action} because of a problem on our side. Try again in a moment; if it keeps happening, contact support.`,
  );
}

function failure(kind: FailureKind, title: string, message: string, fieldErrors: FieldError[] = []): FailureMessage {
  return { kind, title, message, fieldErrors };
}

function trimSentence(text: string): string {
  return text.trim().replace(/[.\s]+$/, '');
}
