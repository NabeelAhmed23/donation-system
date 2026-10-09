import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/problem';
import { describeFailure, fieldError } from './describeFailure';

const action = 'cancel this donation';

describe('describeFailure', () => {
  it('names validation failures, with the server detail and field errors', () => {
    const failure = describeFailure(
      new ApiError({
        status: 422,
        detail: 'Reason is required.',
        errors: [{ field: 'reason', message: 'Required' }],
      }),
      action,
    );

    expect(failure.kind).toBe('validation');
    expect(failure.message).toBe('We could not cancel this donation: Reason is required. Nothing was changed.');
    expect(fieldError(failure, 'reason')).toBe('Required');
    expect(fieldError(failure, 'amount')).toBeUndefined();
  });

  it('gives a generic validation cause when the server sends no detail', () => {
    const failure = describeFailure(new ApiError({ status: 400 }), action);

    expect(failure.kind).toBe('validation');
    expect(failure.message).toContain('some values were not accepted');
  });

  it('names authorisation failures', () => {
    const failure = describeFailure(new ApiError({ status: 403 }), action);

    expect(failure.kind).toBe('permission');
    expect(failure.message).toContain('You do not have permission to cancel this donation.');
    expect(failure.message).toContain('Nothing was changed.');
  });

  it('tells the user when their permissions changed mid-session', () => {
    const failure = describeFailure(new ApiError({ status: 403, code: 'PERMISSIONS_CHANGED' }), action);

    expect(failure.kind).toBe('permission');
    expect(failure.title).toBe('Your permissions have changed');
  });

  it('explains an expired session and that nothing changed', () => {
    const failure = describeFailure(new ApiError({ status: 401 }), action);

    expect(failure.kind).toBe('session-expired');
    expect(failure.message).toContain('signed out before you could cancel this donation');
    expect(failure.message).toContain('Nothing was changed.');
  });

  it.each([
    [404, 'not-found'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'rate-limited'],
  ] as const)('maps %i to %s', (status, kind) => {
    expect(describeFailure(new ApiError({ status }), action).kind).toBe(kind);
  });

  it('does not claim nothing changed when the network dropped', () => {
    const failure = describeFailure(new NetworkError(new TypeError('Failed to fetch')), action);

    expect(failure.kind).toBe('network');
    expect(failure.message).toContain('cannot confirm whether it worked');
    expect(failure.message).not.toContain('Nothing was changed');
  });

  it('never surfaces server detail for 5xx errors', () => {
    const failure = describeFailure(new ApiError({ status: 500, detail: 'relation "donations" does not exist' }), action);

    expect(failure.kind).toBe('unknown');
    expect(failure.message).not.toContain('relation');
  });

  it('treats non-API errors as unknown', () => {
    expect(describeFailure(new Error('boom'), action).kind).toBe('unknown');
  });
});
