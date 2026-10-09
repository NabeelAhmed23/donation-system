import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ValidationError } from '../common/errors.js';
import { AuthService, InvalidCredentialsError } from './auth.service.js';
import { AllowWhilePasswordChangeRequired } from './password-change-required.guard.js';
import { establishSession, type SessionRequest } from './session.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Re-login is harmless while a change is pending: the flag is re-read from the account. */
  @Post('login')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  async login(@Req() request: SessionRequest, @Body() body: unknown): Promise<{ mustChangePassword: boolean }> {
    const result = await this.auth.login(requireString(body, 'email'), requireString(body, 'password'));
    if (!result.ok) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', detail: 'Invalid credentials' });

    await establishSession(request, { userId: result.userId, mustChangePassword: result.mustChangePassword });
    return { mustChangePassword: result.mustChangePassword };
  }

  @Post('password/change')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  async changePassword(@Req() request: SessionRequest, @Body() body: unknown): Promise<{ mustChangePassword: false }> {
    const userId = request.session.userId;
    if (!userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', detail: 'Sign in first' });
    const currentPassword = requireString(body, 'currentPassword');
    const newPassword = requireString(body, 'newPassword');

    try {
      await this.auth.changePassword(userId, currentPassword, newPassword);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) throw new ForbiddenException({ code: error.code, detail: error.message });
      if (error instanceof ValidationError) throw new BadRequestException({ code: error.code, detail: error.message });
      throw error;
    }

    await establishSession(request, { userId, mustChangePassword: false });
    return { mustChangePassword: false };
  }

  @Post('logout')
  @HttpCode(204)
  @AllowWhilePasswordChangeRequired()
  async logout(@Req() request: SessionRequest): Promise<void> {
    await request.session.destroy();
  }
}

function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  if (typeof value !== 'string') throw new BadRequestException({ code: 'VALIDATION', detail: `${field} is required` });
  return value;
}
