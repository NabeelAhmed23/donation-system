import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/common/errors.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../src/platform/platform-roles.js';
import { setupPlatform } from '../../src/platform/setup-platform.js';
import { FakeHasher, InMemoryDatabase, RecordingLogger } from '../support/in-memory-database.js';

const credentials = { email: 'root@example.org', password: 'initial-Secret-123' };

function setup() {
  const db = new InMemoryDatabase();
  const logger = new RecordingLogger();
  const deps = { store: db, hasher: new FakeHasher(), logger };
  return { db, logger, deps };
}

describe('setupPlatform', () => {
  it('creates exactly one super administrator role and one account outside every organisation', async () => {
    const { db, deps } = setup();

    const result = await setupPlatform(deps, () => credentials);

    expect(result).toEqual({ roleCreated: true, accountCreated: true });
    expect(db.platformRoles.map((r) => r.key)).toEqual([SUPER_ADMIN_ROLE_KEY]);
    expect(db.users.size).toBe(1);
    const [user] = [...db.users.values()];
    expect(user).toMatchObject({ email: credentials.email, mustChangePassword: true, status: 'active' });
    expect(user.passwordHash).not.toBe(credentials.password);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([user.id]);
    // Neither the role nor the account belongs to any organisation's role list.
    expect(db.roles).toEqual([]);
    expect(db.memberships).toEqual([]);
    expect(db.membershipRoles).toEqual([]);
  });

  it('creates no second role or account when it runs again', async () => {
    const { db, deps } = setup();
    await setupPlatform(deps, () => credentials);
    const [user] = [...db.users.values()];
    const originalHash = user.passwordHash;

    const result = await setupPlatform(deps, () => ({ email: 'other@example.org', password: 'another-Secret-456' }));

    expect(result).toEqual({ roleCreated: false, accountCreated: false });
    expect(db.platformRoles).toHaveLength(1);
    expect(db.users.size).toBe(1);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([user.id]);
    expect(user.passwordHash).toBe(originalHash);
  });

  it('does not need the credentials once a super administrator exists', async () => {
    const { deps } = setup();
    await setupPlatform(deps, () => credentials);

    const result = await setupPlatform(deps, () => {
      throw new Error('credentials should not be read');
    });

    expect(result.accountCreated).toBe(false);
  });

  it('creates only one account when two setups run concurrently', async () => {
    const { db, deps } = setup();

    await Promise.all([setupPlatform(deps, () => credentials), setupPlatform(deps, () => credentials)]);

    expect(db.platformRoles).toHaveLength(1);
    expect(db.users.size).toBe(1);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toHaveLength(1);
  });

  it('refuses to promote an existing account that uses the configured email', async () => {
    const { db, deps } = setup();
    db.addOrganisationMember('org-a', credentials.email);

    await expect(setupPlatform(deps, () => credentials)).rejects.toBeInstanceOf(ConflictError);
    expect(db.holderIdsOf(SUPER_ADMIN_ROLE_KEY)).toEqual([]);
  });

  it('never logs the initial password or its hash', async () => {
    const { db, logger, deps } = setup();

    await setupPlatform(deps, () => credentials);
    await setupPlatform(deps, () => credentials);

    const [user] = [...db.users.values()];
    expect(logger.entries.length).toBeGreaterThan(0);
    expect(logger.text()).not.toContain(credentials.password);
    expect(logger.text()).not.toContain(user.passwordHash);
  });
});
