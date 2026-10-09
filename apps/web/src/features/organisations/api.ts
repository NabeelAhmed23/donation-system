import type { ApiClient } from '../../lib/api/client';

export interface NewOrganisation {
  name: string;
  country: string;
  defaultCurrency: string;
  timeZone: string;
  initialAdministratorEmail: string;
}

export interface CreatedOrganisation {
  id: string;
  name: string;
  country: string;
  defaultCurrency: string;
  timeZone: string;
  initialAdministrator: {
    userId: string;
    email: string;
    status: 'invited' | 'active' | 'suspended' | 'deactivated';
  };
}

export function createOrganisation(api: ApiClient, input: NewOrganisation): Promise<CreatedOrganisation> {
  return api<CreatedOrganisation>('/platform/organisations', { method: 'POST', body: input });
}

export interface OrganisationProfile {
  name: string;
  description: string | null;
  country: string;
  defaultCurrency: string;
  timeZone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export interface OrganisationSettings extends OrganisationProfile {
  id: string;
  version: number;
}

/** Only the fields being changed; an empty string clears an optional detail. */
export type OrganisationSettingsChanges = Partial<Record<keyof OrganisationProfile, string>>;

export function getOrganisationSettings(api: ApiClient): Promise<OrganisationSettings> {
  return api<OrganisationSettings>('/organisation/settings');
}

export function updateOrganisationSettings(
  api: ApiClient,
  version: number,
  changes: OrganisationSettingsChanges,
): Promise<OrganisationSettings> {
  return api<OrganisationSettings>('/organisation/settings', {
    method: 'PATCH',
    body: changes,
    headers: { 'If-Match': `"${version}"` },
  });
}
