import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConflictError, ForbiddenError, NotFoundError, PreconditionRequiredError } from '../common/errors.js';
import type { SessionRequest } from '../identity/session.js';
import { OrganisationValidationError } from './new-organisation.js';
import { parseIfMatch, type OrganisationSettings } from './organisation-settings.js';
import { OrganisationSettingsService, type OrganisationActorRef } from './organisation-settings.service.js';

/** The caller's own organisation, taken from the session: no organisation ID appears in the path or body. */
@Controller('organisation/settings')
export class OrganisationSettingsController {
  constructor(@Inject(OrganisationSettingsService) private readonly settings: OrganisationSettingsService) {}

  @Get()
  async get(@Req() request: SessionRequest): Promise<OrganisationSettings> {
    const actor = organisationActor(request);
    try {
      return await this.settings.get(actor);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Send only the settings that change, with the version they were based on as If-Match, e.g. "3". */
  @Patch()
  @HttpCode(200)
  async update(
    @Req() request: SessionRequest,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<OrganisationSettings> {
    const actor = organisationActor(request);
    try {
      return await this.settings.update(actor, parseIfMatch(ifMatch), body);
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

function organisationActor(request: SessionRequest): OrganisationActorRef {
  const { userId, orgId } = request.session;
  if (!userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', detail: 'Sign in first' });
  if (!orgId) {
    throw new ForbiddenException({ code: 'ORGANISATION_REQUIRED', detail: 'This account does not belong to an organisation' });
  }
  return { userId, orgId, impersonating: request.session.impersonationSessionId !== undefined };
}

function toHttpException(error: unknown): unknown {
  if (error instanceof OrganisationValidationError) {
    return new BadRequestException({ code: error.code, detail: error.message, errors: error.fieldErrors });
  }
  if (error instanceof PreconditionRequiredError) {
    return new HttpException({ code: error.code, detail: error.message }, HttpStatus.PRECONDITION_REQUIRED);
  }
  if (error instanceof ForbiddenError) return new ForbiddenException({ code: error.code, detail: error.message });
  if (error instanceof NotFoundError) return new NotFoundException({ code: error.code, detail: error.message });
  if (error instanceof ConflictError) return new ConflictException({ code: error.code, detail: error.message });
  return error;
}
