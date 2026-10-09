import { DomainError } from '../common/errors.js';
import { isValidEmail, normaliseEmail } from '../identity/email.js';
import { checkPasswordPolicy } from '../identity/password-policy.js';

export interface SuperAdminCredentials {
  email: string;
  password: string;
}

export class BootstrapConfigError extends DomainError {
  constructor(message: string) {
    super('BOOTSTRAP_CONFIG', message);
  }
}

export type ReadSecretFile = (path: string) => string;

export function readSuperAdminCredentials(
  env: Record<string, string | undefined>,
  readSecretFile: ReadSecretFile,
): SuperAdminCredentials {
  const email = normaliseEmail(env.SUPER_ADMIN_EMAIL ?? '');
  if (!email) throw new BootstrapConfigError('SUPER_ADMIN_EMAIL is not set');
  if (!isValidEmail(email)) throw new BootstrapConfigError('SUPER_ADMIN_EMAIL is not a valid email address');

  const password = readPassword(env, readSecretFile);
  const violation = checkPasswordPolicy(password);
  if (violation) {
    throw new BootstrapConfigError(`The super administrator password does not meet the password policy (${violation})`);
  }
  return { email, password };
}

function readPassword(env: Record<string, string | undefined>, readSecretFile: ReadSecretFile): string {
  const file = env.SUPER_ADMIN_PASSWORD_FILE;
  if (file) return readSecretFile(file).replace(/\r?\n$/, '');
  const password = env.SUPER_ADMIN_PASSWORD;
  if (password) return password;
  throw new BootstrapConfigError('Set SUPER_ADMIN_PASSWORD_FILE (preferred) or SUPER_ADMIN_PASSWORD');
}
