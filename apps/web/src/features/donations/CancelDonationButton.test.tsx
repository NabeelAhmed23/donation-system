import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createApiClient } from '../../lib/api/client';
import { renderWithMantine } from '../../test/render';
import type { DonationSummary } from './api';
import { CancelDonationButton } from './CancelDonationButton';

const donation: DonationSummary = { id: 'don-1', version: 3, status: 'recorded', receiptNumber: 'R-2026-000042' };
const cancelled: DonationSummary = { ...donation, status: 'cancelled', version: 4 };
const DRAFT_KEY = 'cms:draft:donation-cancel:don-1';

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function problemResponse(status: number, body: Record<string, unknown> = {}) {
  return jsonResponse(status, { status, ...body }, 'application/problem+json');
}

function renderButton(fetchMock: Mock<typeof fetch>, props: Partial<DonationSummary> = {}) {
  const api = createApiClient({ fetch: fetchMock, getCsrfToken: () => 'csrf-1' });
  const onCancelled = vi.fn();
  let counter = 0;
  const newIdempotencyKey = () => `key-${++counter}`;
  const user = userEvent.setup();
  const utils = renderWithMantine(
    <CancelDonationButton api={api} donation={{ ...donation, ...props }} onCancelled={onCancelled} newIdempotencyKey={newIdempotencyKey} />,
  );
  return { user, onCancelled, ...utils };
}

async function openDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Cancel donation' }));
  return screen.findByRole('dialog', { name: 'Cancel this donation?' });
}

function headersOf(fetchMock: Mock<typeof fetch>, call: number) {
  return fetchMock.mock.calls[call][1]?.headers as Record<string, string>;
}

describe('CancelDonationButton', () => {
  it('changes nothing when the confirmation is dismissed', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const { user, onCancelled } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent('receipt R-2026-000042 is cancelled with it');
    await user.type(within(dialog).getByLabelText('Reason'), 'Entered twice');
    await user.click(within(dialog).getByRole('button', { name: 'Keep donation' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel donation' })).toBeInTheDocument();
  });

  it('changes nothing when the dialog is closed with the close button', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const { user, onCancelled } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('cancels the donation once confirmed and reports success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(200, cancelled));
    const { user, onCancelled } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Reason'), '  Entered twice  ');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));

    expect(await screen.findByText('Donation cancelled.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/donations/don-1/cancel');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"reason":"Entered twice"}');
    expect(headersOf(fetchMock, 0)).toMatchObject({
      'Idempotency-Key': 'key-1',
      'If-Match': '"3"',
      'X-CSRF-Token': 'csrf-1',
    });
    expect(onCancelled).toHaveBeenCalledWith(cancelled);
  });

  it('names an authorisation failure, keeps the reason, and retries with a fresh key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(problemResponse(403, { title: 'Forbidden' }))
      .mockResolvedValueOnce(jsonResponse(200, cancelled));
    const { user, onCancelled } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Reason'), 'Entered twice');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have permission to cancel this donation.');
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Entered twice');
    expect(onCancelled).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));
    expect(await screen.findByText('Donation cancelled.')).toBeInTheDocument();
    expect(headersOf(fetchMock, 1)['Idempotency-Key']).toBe('key-2');
  });

  it('names a validation failure next to the field and keeps the reason', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      problemResponse(422, {
        detail: 'Reason is required for donations with an issued receipt.',
        errors: [{ pointer: '/reason', detail: 'Reason is required' }],
      }),
    );
    const { user } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Reason'), ' ');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Reason is required for donations with an issued receipt');
    expect(alert).toHaveTextContent('Reason: Reason is required');
    expect(within(dialog).getByLabelText('Reason')).toHaveValue(' ');
    expect(within(dialog).getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the confirmation when the session expired, and restores it after sign-in', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(problemResponse(401, { title: 'Unauthorized' }));
    const first = renderButton(fetchMock);

    const dialog = await openDialog(first.user);
    await first.user.type(within(dialog).getByLabelText('Reason'), 'Entered twice');
    await first.user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You were signed out before you could cancel this donation. Nothing was changed.',
    );
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Entered twice');
    expect(first.onCancelled).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({ reason: 'Entered twice' });

    first.unmount();
    renderButton(vi.fn<typeof fetch>());

    const restored = await screen.findByRole('dialog', { name: 'Cancel this donation?' });
    expect(within(restored).getByLabelText('Reason')).toHaveValue('Entered twice');
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it('reuses the idempotency key when retrying after a network failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, cancelled));
    const { user } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the server');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel donation' }));
    expect(await screen.findByText('Donation cancelled.')).toBeInTheDocument();
    expect(headersOf(fetchMock, 0)['Idempotency-Key']).toBe('key-1');
    expect(headersOf(fetchMock, 1)['Idempotency-Key']).toBe('key-1');
  });

  it('sends one request when confirm is double-clicked', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const { user } = renderButton(fetchMock);

    const dialog = await openDialog(user);
    await user.dblClick(within(dialog).getByRole('button', { name: 'Cancel donation' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(jsonResponse(200, cancelled));
    expect(await screen.findByText('Donation cancelled.')).toBeInTheDocument();
  });

  it('offers nothing for an already cancelled donation', () => {
    renderButton(vi.fn<typeof fetch>(), { status: 'cancelled' });

    expect(screen.queryByRole('button', { name: 'Cancel donation' })).not.toBeInTheDocument();
  });
});
