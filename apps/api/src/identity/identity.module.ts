import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { IdentityStore } from './identity.store.js';
import type { PasswordHasher } from './password-hasher.js';
import { PasswordChangeRequiredGuard } from './password-change-required.guard.js';

export interface IdentityModuleDeps {
  store: IdentityStore;
  hasher: PasswordHasher;
}

/**
 * Auth routes plus the global guard that holds an authenticated session to password change and logout
 * until its mustChangePassword flag is cleared. Import it after the module that registers SessionGuard,
 * so the session is resolved before this guard reads it.
 */
@Module({})
export class IdentityModule {
  static register(deps: IdentityModuleDeps): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: new AuthService(deps.store, deps.hasher) },
        { provide: APP_GUARD, useClass: PasswordChangeRequiredGuard },
      ],
    };
  }
}
