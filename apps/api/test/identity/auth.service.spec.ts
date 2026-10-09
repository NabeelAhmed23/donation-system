import { describe, expect, it } from 'vitest';
import { AuthService, InvalidCredentialsError } from '../../src/identity/auth.service.js';
import { PasswordPolicyError } from '../../src/identity/password-policy.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const initial = { email: 'root@example.org', password: 'initial-Secret-123' };

async function installed() {
  const db = new InMemoryDatabase();
  const hasher = new FakeHasher();
  await setupPlatform({ store: db, hasher, logger: new RecordingLogger() }, () => initial);
  const changedAt = new Date('2026-10-09T10:00:00Z');
  return { db, hasher, auth: new AuthService(db, hasher, () => changedAt), changedAt };
}

async function firstLogin(auth: AuthService): Promise<string> {
  const result = await auth.login(initial.email, initial.password);
  if (!result.ok) throw new Error('expected login to succeed');
  return result.userId;
}

describe('AuthService', () => {
  it('reports that the initial super administrator must change their password at first sign-in', async () => {
    const { auth } = await installed();

    const result = await auth.login('Root@Example.org', initial.password);

    expect(result).toMatchObject({ ok: true, mustChangePassword: true });
  });

  it('clears the requirement once a new password is set', async () => {
    const { db, auth, changedAt } = await installed();
    const userId = await firstLogin(auth);

    await expect(auth.changePassword(userId, initial.password, 'brand-new-Secret-456')).resolves.toEqual({
      mustChangePassword: false,
    });

    expect(db.users.get(userId)).toMatchObject({ mustChangePassword: false, passwordChangedAt: changedAt });
    expect(await auth.login(initial.email, 'brand-new-Secret-456')).toEqual({ ok: true, userId, mustChangePassword: false });
    expect(await auth.login(initial.email, initial.password)).toEqual({ ok: false });
  });

  it('refuses to keep the bootstrap password', async () => {
    const { db, auth } = await installed();
    const userId = await firstLogin(auth);

    await expect(auth.changePassword(userId, initial.password, initial.password)).rejects.toMatchObject({
      violation: 'UNCHANGED',
    });
    expect(db.users.get(userId)?.mustChangePassword).toBe(true);
  });

  it('refuses a new password that breaks the policy', async () => {
    const { db, auth } = await installed();
    const userId = await firstLogin(auth);

    await expect(auth.changePassword(userId, initial.password, 'too-short')).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(db.users.get(userId)?.mustChangePassword).toBe(true);
  });

  it('refuses a password change with the wrong current password', async () => {
    const { db, auth } = await installed();
    const userId = await firstLogin(auth);

    await expect(auth.changePassword(userId, 'wrong-Secret-000', 'brand-new-Secret-456')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(db.users.get(userId)?.mustChangePassword).toBe(true);
  });

  it('fails generically for an unknown email and still verifies a hash', async () => {
    const { hasher, auth } = await installed();
    const before = hasher.verifyCalls;

    expect(await auth.login('nobody@example.org', initial.password)).toEqual({ ok: false });
    expect(hasher.verifyCalls).toBe(before + 1);
  });

  it('refuses sign-in for a suspended account', async () => {
    const { db, auth } = await installed();
    const userId = await firstLogin(auth);
    db.users.get(userId)!.status = 'suspended';

    expect(await auth.login(initial.email, initial.password)).toEqual({ ok: false });
  });
});
