import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/problem';
import { renderWithMantine } from '../../test/render';
import { CreateOrganisationForm } from './CreateOrganisationForm';

const hopeTrust = {
  name: 'Hope Trust',
  country: 'GB',
  defaultCurrency: 'GBP',
  timeZone: 'Europe/London',
  initialAdministratorEmail: 'admin@hopetrust.example',
};

const LABELS = {
  name: 'Organisation name',
  country: 'Country',
  defaultCurrency: 'Default currency',
  timeZone: 'Time zone',
  initialAdministratorEmail: 'Initial administrator email',
} as const;

async function fill(values: Partial<typeof hopeTrust>) {
  const user = userEvent.setup();
  for (const [field, value] of Object.entries(values)) {
    await user.type(screen.getByLabelText(LABELS[field as keyof typeof LABELS]), value);
  }
  await user.click(screen.getByRole('button', { name: 'Create organisation' }));
}

describe('CreateOrganisationForm', () => {
  it('creates the organisation and confirms who its administrator is', async () => {
    const request = vi.fn().mockResolvedValue({
      id: 'org-1',
      ...hopeTrust,
      initialAdministrator: { userId: 'user-1', email: hopeTrust.initialAdministratorEmail, status: 'invited' },
    });
    const onCreated = vi.fn();
    renderWithMantine(<CreateOrganisationForm api={request as unknown as ApiClient} onCreated={onCreated} />);

    await fill(hopeTrust);

    expect(await screen.findByText(/Organisation Hope Trust created/)).toHaveTextContent(
      'admin@hopetrust.example is its organisation administrator',
    );
    expect(request).toHaveBeenCalledWith('/platform/organisations', { method: 'POST', body: hopeTrust });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'org-1' }));
  });

  it('names each missing field and keeps what was entered', async () => {
    const request = vi.fn().mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION',
        detail: 'Name is required. Time zone is required',
        errors: [
          { field: 'name', message: 'Name is required' },
          { field: 'timeZone', message: 'Time zone is required' },
        ],
      }),
    );
    renderWithMantine(<CreateOrganisationForm api={request as unknown as ApiClient} />);

    await fill({ country: 'GB', defaultCurrency: 'GBP', initialAdministratorEmail: 'admin@hopetrust.example' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Organisation name: Name is required');
    expect(alert).toHaveTextContent('Time zone: Time zone is required');
    expect(screen.getByLabelText('Country')).toHaveValue('GB');
    expect(screen.getByLabelText('Initial administrator email')).toHaveValue('admin@hopetrust.example');
  });

  it('reports that someone without the super administrator role may not create organisations', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError({ status: 403, code: 'PLATFORM_ACCESS_REFUSED' }));
    renderWithMantine(<CreateOrganisationForm api={request as unknown as ApiClient} />);

    await fill(hopeTrust);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to create this organisation.');
    expect(screen.getByLabelText('Organisation name')).toHaveValue('Hope Trust');
  });

  it('reports that the administrator belongs to another organisation', async () => {
    const request = vi.fn().mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'INITIAL_ADMIN_IN_ANOTHER_ORGANISATION',
        detail: 'This person already belongs to an organisation and must be migrated',
      }),
    );
    renderWithMantine(<CreateOrganisationForm api={request as unknown as ApiClient} />);

    await fill(hopeTrust);

    expect(await screen.findByRole('alert')).toHaveTextContent('Changed by someone else');
  });
});
