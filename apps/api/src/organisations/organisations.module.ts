import { DynamicModule, Module } from '@nestjs/common';
import { OrganisationSettingsController } from './organisation-settings.controller.js';
import { OrganisationSettingsService } from './organisation-settings.service.js';
import type { OrganisationSettingsStore } from './organisation-settings.store.js';
import { OrganisationService } from './organisation.service.js';
import type { OrganisationStore } from './organisation.store.js';
import { OrganisationsController } from './organisations.controller.js';

export interface OrganisationsModuleDeps {
  store: OrganisationStore;
  settingsStore: OrganisationSettingsStore;
}

/**
 * Platform (super administrator) organisation management, POST /platform/organisations, and each
 * organisation's own settings, GET and PATCH /organisation/settings.
 */
@Module({})
export class OrganisationsModule {
  static register(deps: OrganisationsModuleDeps): DynamicModule {
    return {
      module: OrganisationsModule,
      controllers: [OrganisationsController, OrganisationSettingsController],
      providers: [
        { provide: OrganisationService, useValue: new OrganisationService(deps.store) },
        { provide: OrganisationSettingsService, useValue: new OrganisationSettingsService(deps.settingsStore) },
      ],
    };
  }
}
