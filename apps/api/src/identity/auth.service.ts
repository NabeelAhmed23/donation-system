import { randomBytes } from 'node:crypto';
import { DomainError } from '../common/errors.js';
import { normaliseEmail } from './email.js';
import type { IdentityStore } from './identity.store.js';
import type { PasswordHasher } from './password-hasher.js';
import { assertPasswordPolicy, PasswordPolicyError } from './password-policy.js';

export type LoginResult = { ok: true; userId: string; mustChangePassword: boolean } | { ok: false };

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid credentials');
  }
}

export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly store: IdentityStore,
    private readonly hasher: PasswordHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Every failure looks the same to the caller. Unknown emails, and invited users who have no password
   * yet, still pay for a hash verification.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.store.findUserByEmail(normaliseEmail(email));
    if (!user || user.passwordHash === null) {
      await this.hasher.verify(await this.getDummyHash(), password);
      return { ok: false };
    }
    const valid = await this.hasher.verify(user.passwordHash, password);
    if (!valid || user.status !== 'active') return { ok: false };
    return { ok: true, userId: user.id, mustChangePassword: user.mustChangePassword };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ mustChangePassword: false }> {
    const user = await this.store.findUserById(userId);
    if (
      !user ||
      user.status !== 'active' ||
      user.passwordHash === null ||
      !(await this.hasher.verify(user.passwordHash, currentPassword))
    ) {
      throw new InvalidCredentialsError();
    }
    // Also stops the initial super administrator from "changing" to the bootstrap password.
    if (newPassword === currentPassword) throw new PasswordPolicyError('UNCHANGED');
    assertPasswordPolicy(newPassword);

    const passwordHash = await this.hasher.hash(newPassword);
    await this.store.updatePassword(user.id, { passwordHash, mustChangePassword: false, passwordChangedAt: this.clock() });
    return { mustChangePassword: false };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }
}
