import { ValidationError } from '../common/errors.js';
import { isValidEmail, normaliseEmail } from '../identity/email.js';

export const ORGANISATION_NAME_MAX_LENGTH = 200;

export interface NewOrganisationSettings {
  name: string;
  country: string;
  defaultCurrency: string;
  timeZone: string;
}

export interface NewOrganisation extends NewOrganisationSettings {
  initialAdministratorEmail: string;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export class OrganisationValidationError extends ValidationError {
  constructor(readonly fieldErrors: readonly FieldIssue[]) {
    super('VALIDATION', fieldErrors.map((issue) => issue.message).join('. '));
  }
}

const LABELS = {
  name: 'Name',
  country: 'Country',
  defaultCurrency: 'Default currency',
  timeZone: 'Time zone',
  initialAdministratorEmail: "Initial administrator's email",
} as const;

type Field = keyof typeof LABELS;

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** An upper-case ISO 3166-1 alpha-2 code, e.g. GB. */
export function isCountryCode(value: string): boolean {
  return COUNTRY_PATTERN.test(value);
}

/** An upper-case ISO 4217 code that the system can format and record amounts in. */
export function isSupportedCurrency(value: string): boolean {
  return CURRENCY_PATTERN.test(value) && CURRENCIES.has(value);
}

/** Every problem is reported at once, so the form can mark each missing or invalid field. */
export function parseNewOrganisation(input: unknown): NewOrganisation {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const issues: FieldIssue[] = [];
  const invalid = (field: Field, message: string) => issues.push({ field, message });

  const read = (field: Field): string | undefined => {
    const value = body[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      invalid(field, `${LABELS[field]} is required`);
      return undefined;
    }
    if (typeof value !== 'string') {
      invalid(field, `${LABELS[field]} must be text`);
      return undefined;
    }
    return value.trim();
  };

  const name = read('name');
  if (name !== undefined && [...name].length > ORGANISATION_NAME_MAX_LENGTH) {
    invalid('name', `Name must be at most ${ORGANISATION_NAME_MAX_LENGTH} characters`);
  }

  const country = read('country')?.toUpperCase();
  if (country !== undefined && !isCountryCode(country)) {
    invalid('country', 'Country must be a two-letter ISO 3166-1 code, e.g. GB');
  }

  const defaultCurrency = read('defaultCurrency')?.toUpperCase();
  if (defaultCurrency !== undefined && !isSupportedCurrency(defaultCurrency)) {
    invalid('defaultCurrency', 'Default currency must be a three-letter ISO 4217 code, e.g. GBP');
  }

  const requestedTimeZone = read('timeZone');
  const timeZone = requestedTimeZone === undefined ? undefined : canonicalTimeZone(requestedTimeZone);
  if (timeZone === null) {
    invalid('timeZone', 'Time zone must be an IANA time zone, e.g. Europe/London');
  }

  const rawEmail = read('initialAdministratorEmail');
  const initialAdministratorEmail = rawEmail === undefined ? undefined : normaliseEmail(rawEmail);
  if (initialAdministratorEmail !== undefined && !isValidEmail(initialAdministratorEmail)) {
    invalid('initialAdministratorEmail', "Initial administrator's email is not a valid email address");
  }

  if (issues.length > 0) throw new OrganisationValidationError(issues);
  return {
    name: name as string,
    country: country as string,
    defaultCurrency: defaultCurrency as string,
    timeZone: timeZone as string,
    initialAdministratorEmail: initialAdministratorEmail as string,
  };
}

/** The canonical IANA name (e.g. "utc" becomes "UTC"), or null when the zone is unknown or a bare offset. */
export function canonicalTimeZone(value: string): string | null {
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    return /^[A-Za-z]/.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
