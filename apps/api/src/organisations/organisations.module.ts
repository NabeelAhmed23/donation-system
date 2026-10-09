import { DynamicModule, Module } from '@nestjs/common';
import { OrganisationService } from './organisation.service.js';
import type { OrganisationStore } from './organisation.store.js';
import { OrganisationsController } from './organisations.controller.js';

export interface OrganisationsModuleDeps {
  store: OrganisationStore;
}

/** Platform (super administrator) organisation management: POST /platform/organisations. */
@Module({})
export class OrganisationsModule {
  static register(deps: OrganisationsModuleDeps): DynamicModule {
    return {
      module: OrganisationsModule,
      controllers: [OrganisationsController],
      providers: [{ provide: OrganisationService, useValue: new OrganisationService(deps.store) }],
    };
  }
}
