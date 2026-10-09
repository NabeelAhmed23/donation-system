import { Alert, List, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { FailureMessage } from '../../lib/feedback/describeFailure';

export interface FailureAlertProps {
  failure: FailureMessage;
  /** Human labels for server field names, e.g. { reason: 'Reason' }. */
  fieldLabels?: Record<string, string>;
}

export function FailureAlert({ failure, fieldLabels }: FailureAlertProps) {
  return (
    <Alert color="red" title={failure.title} role="alert">
      <Text size="sm">{failure.message}</Text>
      {failure.fieldErrors.length > 0 && (
        <List size="sm" mt="xs">
          {failure.fieldErrors.map((entry) => (
            <List.Item key={`${entry.field}:${entry.message}`}>
              {fieldLabels?.[entry.field] ?? entry.field}: {entry.message}
            </List.Item>
          ))}
        </List>
      )}
    </Alert>
  );
}

export function SuccessAlert({ children }: { children: ReactNode }) {
  return (
    <Alert color="green" role="status">
      {children}
    </Alert>
  );
}
