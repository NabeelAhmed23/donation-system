import { Button, Text, Textarea } from '@mantine/core';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm/ConfirmDialog';
import { SuccessAlert } from '../../components/feedback/FeedbackAlert';
import type { ApiClient } from '../../lib/api/client';
import { fieldError } from '../../lib/feedback/describeFailure';
import { useSave } from '../../lib/feedback/useSave';
import { clearDraft, readDraft, stashDraft } from '../../lib/session/drafts';
import { cancelDonation, type CancelDonationInput, type DonationSummary } from './api';

interface CancelDraft {
  reason: string;
}

export interface CancelDonationButtonProps {
  api: ApiClient;
  donation: DonationSummary;
  onCancelled?: (donation: DonationSummary) => void;
  newIdempotencyKey?: () => string;
}

const defaultIdempotencyKey = () => crypto.randomUUID();

// Failures where the server definitely did not apply the request; a retry gets a fresh key so it
// is not answered with a replay of the failed attempt. Network and unknown failures keep the key,
// so a retry can never cancel twice.
const DEFINITE_FAILURES = new Set(['validation', 'permission', 'session-expired', 'conflict', 'not-found', 'rate-limited']);

export function CancelDonationButton({
  api,
  donation,
  onCancelled,
  newIdempotencyKey = defaultIdempotencyKey,
}: CancelDonationButtonProps) {
  const draftKey = `donation-cancel:${donation.id}`;
  const [restored] = useState(() => readDraft<CancelDraft>(draftKey));
  const [opened, setOpened] = useState(restored !== undefined);
  const [reason, setReason] = useState(restored?.reason ?? '');
  const [idempotencyKey, setIdempotencyKey] = useState(() => (restored ? newIdempotencyKey() : undefined));

  const save = useSave((key: string, input: CancelDonationInput) => cancelDonation(api, donation, input, key), {
    action: 'cancel this donation',
    onSuccess: (updated) => {
      setOpened(false);
      onCancelled?.(updated);
    },
    onSessionExpired: () => stashDraft(draftKey, { reason } satisfies CancelDraft),
  });

  useEffect(() => {
    clearDraft(draftKey);
  }, [draftKey]);

  function open() {
    save.reset();
    setIdempotencyKey(newIdempotencyKey());
    setOpened(true);
  }

  function dismiss() {
    if (save.saving) {
      return;
    }
    setOpened(false);
    setReason('');
    save.reset();
  }

  async function confirm() {
    const key = idempotencyKey ?? newIdempotencyKey();
    const trimmed = reason.trim();
    const outcome = await save.run(key, trimmed ? { reason: trimmed } : {});
    if (outcome && !outcome.ok && DEFINITE_FAILURES.has(outcome.failure.kind)) {
      setIdempotencyKey(newIdempotencyKey());
    }
  }

  if (save.status === 'succeeded') {
    return <SuccessAlert>Donation cancelled.</SuccessAlert>;
  }
  if (donation.status === 'cancelled') {
    return null;
  }

  return (
    <>
      <Button color="red" variant="light" onClick={open}>
        Cancel donation
      </Button>
      <ConfirmDialog
        opened={opened}
        title="Cancel this donation?"
        confirmLabel="Cancel donation"
        dismissLabel="Keep donation"
        tone="danger"
        pending={save.saving}
        failure={save.failure}
        fieldLabels={{ reason: 'Reason' }}
        onConfirm={() => void confirm()}
        onDismiss={dismiss}
      >
        <Text size="sm">
          The donation stays in the history, marked as cancelled
          {donation.receiptNumber ? `, and receipt ${donation.receiptNumber} is cancelled with it` : ''}.
        </Text>
        <Textarea
          label="Reason"
          description="Recorded in the audit log"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          disabled={save.saving}
          error={fieldError(save.failure, 'reason')}
          rows={3}
          maxLength={500}
        />
      </ConfirmDialog>
    </>
  );
}
