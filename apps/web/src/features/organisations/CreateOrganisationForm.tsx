import { Button, Stack, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { FailureAlert, SuccessAlert } from '../../components/feedback/FeedbackAlert';
import type { ApiClient } from '../../lib/api/client';
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

export interface CreateOrganisationFormProps {
  api: ApiClient;
  onCreated?: (organisation: CreatedOrganisation) => void;
}

/** Super administrators only. The server refuses everyone else, and the form reports that refusal. */
export function CreateOrganisationForm({ api, onCreated }: CreateOrganisationFormProps) {
  const [values, setValues] = useState<NewOrganisation>(EMPTY);
  const [created, setCreated] = useState<CreatedOrganisation>();
  const save = useSave((input: NewOrganisation) => createOrganisation(api, input), {
    action: 'create this organisation',
    onSuccess: (organisation) => {
      setCreated(organisation);
      onCreated?.(organisation);
    },
  });

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
        {save.failure && <FailureAlert failure={save.failure} fieldLabels={FIELD_LABELS} />}
        <Button type="submit" loading={save.saving}>
          Create organisation
        </Button>
      </Stack>
    </form>
  );
}
