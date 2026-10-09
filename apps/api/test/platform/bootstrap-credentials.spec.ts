import { describe, expect, it } from 'vitest';
import { BootstrapConfigError, readSuperAdminCredentials } from '../../src/platform/bootstrap-credentials.js';

const noFiles = (): string => {
  throw new Error('no file expected');
};

describe('readSuperAdminCredentials', () => {
  it('reads and normalises the email and password from the environment', () => {
    const credentials = readSuperAdminCredentials(
      { SUPER_ADMIN_EMAIL: '  Root@Example.ORG ', SUPER_ADMIN_PASSWORD: 'initial-Secret-123' },
      noFiles,
    );

    expect(credentials).toEqual({ email: 'root@example.org', password: 'initial-Secret-123' });
  });

  it('prefers the secret file and strips its trailing newline', () => {
    const credentials = readSuperAdminCredentials(
      {
        SUPER_ADMIN_EMAIL: 'root@example.org',
        SUPER_ADMIN_PASSWORD_FILE: '/run/secrets/super_admin_password',
        SUPER_ADMIN_PASSWORD: 'ignored-Secret-000',
      },
      (path) => (path === '/run/secrets/super_admin_password' ? 'from-file-Secret-1\n' : ''),
    );

    expect(credentials.password).toBe('from-file-Secret-1');
  });

  it('requires an email', () => {
    expect(() => readSuperAdminCredentials({ SUPER_ADMIN_PASSWORD: 'initial-Secret-123' }, noFiles)).toThrow(
      BootstrapConfigError,
    );
  });

  it('rejects an invalid email', () => {
    expect(() =>
      readSuperAdminCredentials({ SUPER_ADMIN_EMAIL: 'not-an-email', SUPER_ADMIN_PASSWORD: 'initial-Secret-123' }, noFiles),
    ).toThrow(BootstrapConfigError);
  });

  it('requires a password', () => {
    expect(() => readSuperAdminCredentials({ SUPER_ADMIN_EMAIL: 'root@example.org' }, noFiles)).toThrow(
      BootstrapConfigError,
    );
  });

  it('rejects a password that breaks the policy without echoing it', () => {
    const weak = 'short-pw';
    let message = '';
    try {
      readSuperAdminCredentials({ SUPER_ADMIN_EMAIL: 'root@example.org', SUPER_ADMIN_PASSWORD: weak }, noFiles);
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapConfigError);
      message = (error as Error).message;
    }

    expect(message).toContain('TOO_SHORT');
    expect(message).not.toContain(weak);
  });
});
