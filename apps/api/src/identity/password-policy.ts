import { ValidationError } from '../common/errors.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyViolation = 'TOO_SHORT' | 'TOO_LONG' | 'UNCHANGED';

const MESSAGES: Record<PasswordPolicyViolation, string> = {
  TOO_SHORT: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  TOO_LONG: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  UNCHANGED: 'New password must be different from the current password',
};

export class PasswordPolicyError extends ValidationError {
  constructor(readonly violation: PasswordPolicyViolation) {
    super('PASSWORD_POLICY', MESSAGES[violation]);
  }
}

export function checkPasswordPolicy(password: string): PasswordPolicyViolation | null {
  // Count code points, not UTF-16 units, so non-Latin passwords are measured fairly.
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

export function assertPasswordPolicy(password: string): void {
  const violation = checkPasswordPolicy(password);
  if (violation) throw new PasswordPolicyError(violation);
}
