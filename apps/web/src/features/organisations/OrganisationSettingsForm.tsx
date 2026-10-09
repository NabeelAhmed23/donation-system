import { Alert, Button, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { FailureAlert, SuccessAlert } from '../../components/feedback/FeedbackAlert';
import type { ApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/problem';
import { fieldError } from '../../lib/feedback/describeFailure';
import { useSave } from '../../lib/feedback/useSave';
import {
  getOrganisationSettings,
  updateOrganisationSettings,
  type OrganisationProfile,
  type OrganisationSettings,
  type OrganisationSettingsChanges,
} from './api';

type Field = keyof OrganisationProfile;
type Values = Record<Field, string>;

const FIELD_LABELS: Record<Field, string> = {
  name: 'Organisation name',
  description: 'About the organisation',
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

const FIELDS: { field: Field; placeholder?: string; description?: string; multiline?: boolean }[] = [
  { field: 'name', placeholder: 'Hope Trust' },
  { field: 'description', multiline: true },
  { field: 'country', placeholder: 'GB' },
  {
    field: 'defaultCurrency',
    placeholder: 'GBP',
    description: 'Donations already recorded keep their own currency and amount.',
  },
  { field: 'timeZone', placeholder: 'Europe/London', description: 'Dates of donations already recorded do not change.' },
  { field: 'contactEmail', placeholder: 'info@example.org' },
  { field: 'contactPhone', placeholder: '+44 20 7946 0000' },
  { field: 'addressLine1' },
  { field: 'addressLine2' },
  { field: 'city' },
  { field: 'region' },
  { field: 'postalCode' },
];

const FIELD_NAMES = FIELDS.map(({ field }) => field);

interface Refusal {
  title: string;
  message: string;
}

// Both come back as 409, so each gets its own wording; the server's explanation is shown when there is one.
const REFUSALS: Record<string, Refusal> = {
  STALE_VERSION: {
    title: 'Changed by someone else',
    message: 'Another administrator saved these settings after you opened them. Load the latest settings; your changes are kept.',
  },
  ORGANISATION_NAME_TAKEN: {
    title: 'Organisation name already in use',
    message: 'Another organisation already has this name. Choose a different name.',
  },
};

function refusalFor(error: unknown): Refusal | undefined {
  if (!(error instanceof ApiError) || error.code === undefined) {
    return undefined;
  }
  const known = REFUSALS[error.code];
  return known && { title: known.title, message: error.detail ?? known.message };
}

function toValues(settings: OrganisationSettings): Values {
  return Object.fromEntries(FIELD_NAMES.map((field) => [field, settings[field] ?? ''])) as Values;
}

/** Only the fields the user edited are sent, so a save never overwrites anyone's change to another field. */
function changedValues(edited: Values, base: Values): OrganisationSettingsChanges {
  const changes: OrganisationSettingsChanges = {};
  for (const field of FIELD_NAMES) {
    if (edited[field] !== base[field]) {
      changes[field] = edited[field];
    }
  }
  return changes;
}

/** The latest saved settings with the user's own edits kept on top. */
function rebase(edited: Values, base: Values, latest: Values): Values {
  return Object.fromEntries(
    FIELD_NAMES.map((field) => [field, edited[field] !== base[field] ? edited[field] : latest[field]]),
  ) as Values;
}

function loadFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return 'You do not have permission to view the organisation settings.';
  }
  if (error instanceof ApiError && error.status === 401) {
    return 'Your session has expired. Sign in again.';
  }
  return 'The organisation settings could not be loaded. Try again.';
}

export interface OrganisationSettingsFormProps {
  api: ApiClient;
  onSaved?: (settings: OrganisationSettings) => void;
}

/** The signed-in administrator's own organisation. The server decides who may view and change it. */
export function OrganisationSettingsForm({ api, onSaved }: OrganisationSettingsFormProps) {
  const [saved, setSaved] = useState<OrganisationSettings>();
  const [values, setValues] = useState<Values>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [reloadFailed, setReloadFailed] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let active = true;
    getOrganisationSettings(api).then(
      (settings) => {
        if (active) {
          setSaved(settings);
          setValues(toValues(settings));
        }
      },
      (error: unknown) => {
        if (active) {
          setLoadFailure(loadFailureMessage(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const save = useSave(
    async (version: number, changes: OrganisationSettingsChanges) => {
      setRefusal(undefined);
      setStale(false);
      try {
        return await updateOrganisationSettings(api, version, changes);
      } catch (error) {
        setRefusal(refusalFor(error));
        setStale(error instanceof ApiError && error.code === 'STALE_VERSION');
        throw error;
      }
    },
    {
      action: 'save the organisation settings',
      onSuccess: (updated) => {
        setSaved(updated);
        setValues(toValues(updated));
        onSaved?.(updated);
      },
    },
  );

  if (loadFailure) {
    return (
      <Alert color="red" title="Organisation settings unavailable" role="alert">
        {loadFailure}
      </Alert>
    );
  }
  if (!saved || !values) {
    return <Text size="sm">Loading organisation settings…</Text>;
  }

  const current = saved;
  const edited = values;
  const base = toValues(current);
  const failure = save.failure && refusal ? { ...save.failure, ...refusal } : save.failure;

  const change = (field: Field, value: string) => {
    setValues((existing) => existing && { ...existing, [field]: value });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save.run(current.version, changedValues(edited, base));
  };

  const loadLatest = async () => {
    setReloadFailed(false);
    try {
      const latest = await getOrganisationSettings(api);
      setValues(rebase(edited, base, toValues(latest)));
      setSaved(latest);
      setStale(false);
      setRefusal(undefined);
      save.reset();
    } catch {
      setReloadFailed(true);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {save.status === 'succeeded' && <SuccessAlert>Organisation settings saved.</SuccessAlert>}
        {FIELDS.map(({ field, placeholder, description, multiline }) =>
          multiline ? (
            <Textarea
              key={field}
              label={FIELD_LABELS[field]}
              placeholder={placeholder}
              description={description}
              value={edited[field]}
              onChange={(event) => change(field, event.currentTarget.value)}
              error={fieldError(save.failure, field)}
              disabled={save.saving}
              rows={3}
            />
          ) : (
            <TextInput
              key={field}
              label={FIELD_LABELS[field]}
              placeholder={placeholder}
              description={description}
              value={edited[field]}
              onChange={(event) => change(field, event.currentTarget.value)}
              error={fieldError(save.failure, field)}
              disabled={save.saving}
            />
          ),
        )}
        {failure && <FailureAlert failure={failure} fieldLabels={FIELD_LABELS} />}
        {reloadFailed && (
          <Alert color="red" role="alert">
            The latest settings could not be loaded. Try again.
          </Alert>
        )}
        <Group justify="flex-end">
          {stale && (
            <Button variant="default" onClick={() => void loadLatest()} disabled={save.saving}>
              Load latest settings
            </Button>
          )}
          <Button type="submit" loading={save.saving}>
            Save settings
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
