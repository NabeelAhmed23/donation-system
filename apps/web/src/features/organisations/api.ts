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
