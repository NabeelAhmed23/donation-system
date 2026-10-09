import { Button, TextInput } from '@mantine/core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FailureAlert, SuccessAlert } from '../../components/feedback/FeedbackAlert';
import { renderWithMantine } from '../../test/render';
import { ApiError } from '../api/problem';
import { fieldError } from './describeFailure';
import { useSave } from './useSave';

function ProfileForm({ save, onSessionExpired }: { save: (name: string) => Promise<void>; onSessionExpired?: (name: string) => void }) {
  const [name, setName] = useState('');
  const result = useSave(save, { action: 'save this profile', onSessionExpired });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void result.run(name);
      }}
    >
      <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} error={fieldError(result.failure, 'name')} />
      {result.failure && <FailureAlert failure={result.failure} fieldLabels={{ name: 'Name' }} />}
      {result.status === 'succeeded' && <SuccessAlert>Profile saved.</SuccessAlert>}
      <Button type="submit" loading={result.saving}>
        Save
      </Button>
    </form>
  );
}

async function fillAndSubmit(value: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), value);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('useSave', () => {
  it('names a validation failure and keeps the input', async () => {
    const save = vi.fn().mockRejectedValue(
      new ApiError({ status: 422, detail: 'Name is too long', errors: [{ field: 'name', message: 'At most 5 characters' }] }),
    );
    renderWithMantine(<ProfileForm save={save} />);

    await fillAndSubmit('Aisha Khan');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not save this profile: Name is too long. Nothing was changed.');
    expect(alert).toHaveTextContent('Name: At most 5 characters');
    expect(screen.getByLabelText('Name')).toHaveValue('Aisha Khan');
  });

  it('names an authorisation failure and keeps the input', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError({ status: 403 }));
    renderWithMantine(<ProfileForm save={save} />);

    await fillAndSubmit('Aisha');

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to save this profile.');
    expect(screen.getByLabelText('Name')).toHaveValue('Aisha');
  });

  it('reports success', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(<ProfileForm save={save} />);

    await fillAndSubmit('Aisha');

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith('Aisha');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hands the unsaved input to onSessionExpired on a 401', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError({ status: 401 }));
    const onSessionExpired = vi.fn();
    renderWithMantine(<ProfileForm save={save} onSessionExpired={onSessionExpired} />);

    await fillAndSubmit('Aisha');

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired');
    expect(onSessionExpired).toHaveBeenCalledWith('Aisha');
  });

  it('ignores a second submit while the first is in flight', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderWithMantine(<ProfileForm save={save} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Aisha');

    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');

    expect(save).toHaveBeenCalledTimes(1);
    resolve();
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });
});
