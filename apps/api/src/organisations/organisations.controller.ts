import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConflictError, ForbiddenError } from '../common/errors.js';
import type { SessionRequest } from '../identity/session.js';
import { OrganisationValidationError } from './new-organisation.js';
import { OrganisationService, type CreatedOrganisation } from './organisation.service.js';

/** Super administrator only. The organisation is never taken from the caller's session here: it is new. */
@Controller('platform/organisations')
export class OrganisationsController {
  constructor(@Inject(OrganisationService) private readonly organisations: OrganisationService) {}

  @Post()
  @HttpCode(201)
  async create(@Req() request: SessionRequest, @Body() body: unknown): Promise<CreatedOrganisation> {
    const userId = request.session.userId;
    if (!userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', detail: 'Sign in first' });

    try {
      return await this.organisations.create(
        { userId, impersonating: request.session.impersonationSessionId !== undefined },
        body,
      );
    } catch (error) {
      if (error instanceof OrganisationValidationError) {
        throw new BadRequestException({ code: error.code, detail: error.message, errors: error.fieldErrors });
      }
      if (error instanceof ForbiddenError) throw new ForbiddenException({ code: error.code, detail: error.message });
      if (error instanceof ConflictError) throw new ConflictException({ code: error.code, detail: error.message });
      throw error;
    }
  }
}
