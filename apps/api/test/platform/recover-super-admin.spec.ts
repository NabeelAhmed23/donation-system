import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/common/errors.js';
import { AuthService } from '../../src/identity/auth.service.js';
import { recoverSuperAdmin } from '../../src/platform/recover-super-admin.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const initial = { email: 'root@example.org', password: 'initial-Secret-123' };
const recovery = { email: 'root@example.org', password: 'recovery-Secret-789' };

describe('recoverSuperAdmin', () => {
  it('reactivates a locked-out super administrator and forces a new password', async () => {
    const db = new InMemoryDatabase();
    const hasher = new FakeHasher();
    const logger = new RecordingLogger();
    await setupPlatform({ store: db, hasher, logger }, () => initial);
    const auth = new AuthService(db, hasher);
    const login = await auth.login(initial.email, initial.password);
    if (!login.ok) throw new Error('expected login to succeed');
    await auth.changePassword(login.userId, initial.password, 'forgotten-Secret-456');
    db.users.get(login.userId)!.status = 'suspended';

    const result = await recoverSuperAdmin({ store: db, hasher, logger }, recovery);

    expect(result.userId).toBe(login.userId);
    expect(db.users.get(login.userId)).toMatchObject({ status: 'active', mustChangePassword: true });
    expect(await auth.login(recovery.email, recovery.password)).toEqual({
      ok: true,
      userId: login.userId,
      mustChangePassword: true,
    });
    expect(await auth.login(recovery.email, 'forgotten-Secret-456')).toEqual({ ok: false });
    expect(logger.text()).not.toContain(recovery.password);
  });

  it('refuses an email that does not belong to a super administrator', async () => {
    const db = new InMemoryDatabase();
    const hasher = new FakeHasher();
    const logger = new RecordingLogger();
    await setupPlatform({ store: db, hasher, logger }, () => initial);
    const memberId = db.addUser('member@example.org', 'original-hash');

    await expect(
      recoverSuperAdmin({ store: db, hasher, logger }, { email: 'member@example.org', password: recovery.password }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(db.users.get(memberId)?.passwordHash).toBe('original-hash');
  });

  it('refuses to run before setup', async () => {
    const db = new InMemoryDatabase();

    await expect(
      recoverSuperAdmin({ store: db, hasher: new FakeHasher(), logger: new RecordingLogger() }, recovery),
    ).rejects.toMatchObject({ code: 'PLATFORM_NOT_SET_UP' });
  });
});
