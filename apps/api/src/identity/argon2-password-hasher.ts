import * as argon2 from 'argon2';
import type { PasswordHasher } from './password-hasher.js';

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
