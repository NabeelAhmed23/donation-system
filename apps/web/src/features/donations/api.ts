import type { ApiClient } from '../../lib/api/client';

export interface DonationSummary {
  id: string;
  version: number;
  status: 'recorded' | 'cancelled';
  receiptNumber?: string;
}

export interface CancelDonationInput {
  reason?: string;
}

export function cancelDonation(
  api: ApiClient,
  donation: Pick<DonationSummary, 'id' | 'version'>,
  input: CancelDonationInput,
  idempotencyKey: string,
): Promise<DonationSummary> {
  return api<DonationSummary>(`/donations/${encodeURIComponent(donation.id)}/cancel`, {
    method: 'POST',
    body: input,
    headers: {
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${donation.version}"`,
    },
  });
}
