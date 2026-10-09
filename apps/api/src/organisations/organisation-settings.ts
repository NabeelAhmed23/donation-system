import { isValidEmail, normaliseEmail } from '../identity/email.js';
import {
  canonicalTimeZone,
  isCountryCode,
  isSupportedCurrency,
  ORGANISATION_NAME_MAX_LENGTH,
  OrganisationValidationError,
  type FieldIssue,
  type NewOrganisationSettings,
} from './new-organisation.js';

/** Optional details about the organisation; null when not given. */
export interface OrganisationDetails {
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export interface OrganisationProfile extends NewOrganisationSettings, OrganisationDetails {}

export interface OrganisationSettings extends OrganisationProfile {
  id: string;
  /** Increases by one on every change; a change must name the version it was based on. */
  version: number;
}

export type OrganisationSettingsChanges = Partial<OrganisationProfile>;

export const ORGANISATION_PROFILE_FIELDS: readonly (keyof OrganisationProfile)[] = [
  'name',
  'description',
  'country',
  'defaultCurrency',
  'timeZone',
  'contactEmail',
  'contactPhone',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
];

const DETAIL_MAX_LENGTHS: Record<keyof OrganisationDetails, number> = {
  description: 2000,
  contactEmail: 254,
  contactPhone: 32,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 20,
};

const DETAIL_FIELDS = Object.keys(DETAIL_MAX_LENGTHS) as (keyof OrganisationDetails)[];

const LABELS: Record<keyof OrganisationProfile, string> = {
  name: 'Name',
  description: 'Description',
  country: 'Country',
  defaultCurrency: 'Default currency',
  timeZone: 'Time zone',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  city: 'City',
  region: 'Region',
  postalCode: 'Postal code',
};

const PHONE_PATTERN = /^\+?[0-9(][0-9 ().-]*[0-9]$/;

function isPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '').length;
  return PHONE_PATTERN.test(value) && digits >= 6 && digits <= 15;
}

/**
 * Reads a partial change: only the fields present are changed. Required settings cannot be cleared;
 * optional details are cleared with null or an empty string. Every problem is reported at once.
 */
export function parseOrganisationSettingsChanges(input: unknown): OrganisationSettingsChanges {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new OrganisationValidationError([{ field: 'body', message: 'Send the settings to change as a JSON object' }]);
  }
  const body = input as Record<string, unknown>;
  const issues: FieldIssue[] = [];
  const invalid = (field: string, message: string) => issues.push({ field, message });
  const changes: OrganisationSettingsChanges = {};
  const present = (field: string) => Object.hasOwn(body, field) && body[field] !== undefined;

  for (const field of Object.keys(body)) {
    if (!ORGANISATION_PROFILE_FIELDS.includes(field as keyof OrganisationProfile)) {
      invalid(field, `${field} is not an organisation setting that can be changed here`);
    }
  }

  const readRequired = (field: keyof NewOrganisationSettings): string | undefined => {
    if (!present(field)) return undefined;
    const value = body[field];
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      invalid(field, `${LABELS[field]} is required`);
      return undefined;
    }
    if (typeof value !== 'string') {
      invalid(field, `${LABELS[field]} must be text`);
      return undefined;
    }
    return value.trim();
  };

  const name = readRequired('name');
  if (name !== undefined) {
    if ([...name].length > ORGANISATION_NAME_MAX_LENGTH) {
      invalid('name', `Name must be at most ${ORGANISATION_NAME_MAX_LENGTH} characters`);
    } else {
      changes.name = name;
    }
  }

  const country = readRequired('country')?.toUpperCase();
  if (country !== undefined) {
    if (isCountryCode(country)) changes.country = country;
    else invalid('country', 'Country must be a two-letter ISO 3166-1 code, e.g. GB');
  }

  const defaultCurrency = readRequired('defaultCurrency')?.toUpperCase();
  if (defaultCurrency !== undefined) {
    if (isSupportedCurrency(defaultCurrency)) changes.defaultCurrency = defaultCurrency;
    else invalid('defaultCurrency', 'Default currency must be a supported three-letter ISO 4217 code, e.g. GBP');
  }

  const requestedTimeZone = readRequired('timeZone');
  if (requestedTimeZone !== undefined) {
    const timeZone = canonicalTimeZone(requestedTimeZone);
    if (timeZone !== null) changes.timeZone = timeZone;
    else invalid('timeZone', 'Time zone must be an IANA time zone, e.g. Europe/London');
  }

  for (const field of DETAIL_FIELDS) {
    if (!present(field)) continue;
    const value = body[field];
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      changes[field] = null;
      continue;
    }
    if (typeof value !== 'string') {
      invalid(field, `${LABELS[field]} must be text`);
      continue;
    }
    const trimmed = value.trim();
    if ([...trimmed].length > DETAIL_MAX_LENGTHS[field]) {
      invalid(field, `${LABELS[field]} must be at most ${DETAIL_MAX_LENGTHS[field]} characters`);
      continue;
    }
    if (field === 'contactEmail') {
      const email = normaliseEmail(trimmed);
      if (isValidEmail(email)) changes.contactEmail = email;
      else invalid(field, 'Contact email is not a valid email address');
      continue;
    }
    if (field === 'contactPhone' && !isPhoneNumber(trimmed)) {
      invalid(field, 'Contact phone must be a phone number, e.g. +44 20 7946 0000');
      continue;
    }
    changes[field] = trimmed;
  }

  if (issues.length > 0) throw new OrganisationValidationError(issues);
  return changes;
}

const IF_MATCH_PATTERN = /^"(\d{1,9})"$|^(\d{1,9})$/;

/** The version named by an If-Match header (`"3"` or `3`), or undefined when it names none. */
export function parseIfMatch(header: string | undefined): number | undefined {
  const match = header?.trim().match(IF_MATCH_PATTERN);
  if (!match) return undefined;
  return Number(match[1] ?? match[2]);
}
