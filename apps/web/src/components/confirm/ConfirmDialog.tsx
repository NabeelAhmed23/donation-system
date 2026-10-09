import { Button, Group, Modal, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import type { FailureMessage } from '../../lib/feedback/describeFailure';
import { FailureAlert } from '../feedback/FeedbackAlert';

export interface ConfirmDialogProps {
  opened: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  dismissLabel?: string;
  tone?: 'danger' | 'default';
  pending?: boolean;
  failure?: FailureMessage;
  fieldLabels?: Record<string, string>;
  onConfirm: () => void;
  /** Dismissing must not change anything; callers only close the dialog. */
  onDismiss: () => void;
}

/**
 * Confirmation for destructive or financially significant actions. The safe option is focused
 * first, and the dialog cannot be dismissed while the request is in flight.
 */
export function ConfirmDialog({
  opened,
  title,
  children,
  confirmLabel,
  dismissLabel = 'Cancel',
  tone = 'default',
  pending = false,
  failure,
  fieldLabels,
  onConfirm,
  onDismiss,
}: ConfirmDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={pending ? () => undefined : onDismiss}
      title={title}
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
      closeButtonProps={{ 'aria-label': 'Close' }}
      centered
    >
      <Stack gap="md">
        {children}
        {failure && <FailureAlert failure={failure} fieldLabels={fieldLabels} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDismiss} disabled={pending} data-autofocus>
            {dismissLabel}
          </Button>
          <Button color={tone === 'danger' ? 'red' : undefined} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
