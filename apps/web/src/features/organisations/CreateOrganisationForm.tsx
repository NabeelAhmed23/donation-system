import { Button, Stack, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { FailureAlert, SuccessAlert } from '../../components/feedback/FeedbackAlert';
import type { ApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/problem';
import { fieldError } from '../../lib/feedback/describeFailure';
import { useSave } from '../../lib/feedback/useSave';
import { createOrganisation, type CreatedOrganisation, type NewOrganisation } from './api';

const EMPTY: NewOrganisation = { name: '', country: '', defaultCurrency: '', timeZone: '', initialAdministratorEmail: '' };

const FIELD_LABELS: Record<keyof NewOrganisation, string> = {
  name: 'Organisation name',
  country: 'Country',
  defaultCurrency: 'Default currency',
  timeZone: 'Time zone',
  initialAdministratorEmail: 'Initial administrator email',
};

const FIELDS: { field: keyof NewOrganisation; placeholder: string }[] = [
  { field: 'name', placeholder: 'Hope Trust' },
  { field: 'country', placeholder: 'GB' },
  { field: 'defaultCurrency', placeholder: 'GBP' },
  { field: 'timeZone', placeholder: 'Europe/London' },
  { field: 'initialAdministratorEmail', placeholder: 'admin@example.org' },
];

interface Refusal {
  title: string;
  message: string;
}

// These come back as 409 but are not edit conflicts, so the generic "changed by someone else" wording
// would be wrong. Each gets its own title, and the server's explanation is shown when there is one.
const REFUSALS: Record<string, Refusal> = {
  INITIAL_ADMIN_IN_ANOTHER_ORGANISATION: {
    title: 'Administrator already belongs to an organisation',
    message: 'This person already belongs to an organisation and must be migrated instead.',
  },
  INITIAL_ADMIN_IS_PLATFORM_ACCOUNT: {
    title: 'Administrator is a platform account',
    message: 'That email belongs to a platform administrator, who cannot also belong to an organisation.',
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

export interface CreateOrganisationFormProps {
  api: ApiClient;
  onCreated?: (organisation: CreatedOrganisation) => void;
}

/** Super administrators only. The server refuses everyone else, and the form reports that refusal. */
export function CreateOrganisationForm({ api, onCreated }: CreateOrganisationFormProps) {
  const [values, setValues] = useState<NewOrganisation>(EMPTY);
  const [created, setCreated] = useState<CreatedOrganisation>();
  const [refusal, setRefusal] = useState<Refusal>();
  const save = useSave(
    async (input: NewOrganisation) => {
      setRefusal(undefined);
      try {
        return await createOrganisation(api, input);
      } catch (error) {
        setRefusal(refusalFor(error));
        throw error;
      }
    },
    {
      action: 'create this organisation',
      onSuccess: (organisation) => {
        setCreated(organisation);
        onCreated?.(organisation);
      },
    },
  );

  if (created) {
    return (
      <SuccessAlert>
        Organisation {created.name} created. {created.initialAdministrator.email} is its organisation administrator.
      </SuccessAlert>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save.run(values);
  }

  const failure = save.failure && refusal ? { ...save.failure, ...refusal } : save.failure;

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {FIELDS.map(({ field, placeholder }) => (
          <TextInput
            key={field}
            label={FIELD_LABELS[field]}
            placeholder={placeholder}
            value={values[field]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setValues((current) => ({ ...current, [field]: value }));
            }}
            error={fieldError(save.failure, field)}
            disabled={save.saving}
          />
        ))}
        {failure && <FailureAlert failure={failure} fieldLabels={FIELD_LABELS} />}
        <Button type="submit" loading={save.saving}>
          Create organisation
        </Button>
      </Stack>
    </form>
  );
}
