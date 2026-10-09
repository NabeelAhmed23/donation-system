import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/problem';
import { renderWithMantine } from '../../test/render';
import type { OrganisationSettings } from './api';
import { OrganisationSettingsForm } from './OrganisationSettingsForm';

interface Init {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

const current: OrganisationSettings = {
  id: 'org-1',
  version: 3,
  name: 'Hope Trust',
  description: null,
  country: 'GB',
  defaultCurrency: 'GBP',
  timeZone: 'Europe/London',
  contactEmail: 'info@hopetrust.example',
  contactPhone: '+44 20 7946 0000',
  addressLine1: '1 High Street',
  addressLine2: null,
  city: 'London',
  region: null,
  postalCode: 'N1 1AA',
};

function renderForm(handle: (path: string, init?: Init) => Promise<unknown>) {
  const request = vi.fn(handle);
  renderWithMantine(<OrganisationSettingsForm api={request as unknown as ApiClient} />);
  return request;
}

async function changePhone(value: string) {
  const user = userEvent.setup();
  const phone = await screen.findByLabelText('Contact phone');
  await user.clear(phone);
  await user.type(phone, value);
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  return user;
}

describe('OrganisationSettingsForm', () => {
  it('saves a changed contact phone number, sending only that field and the loaded version', async () => {
    const request = renderForm(async (_path, init) =>
      init?.method === 'PATCH' ? { ...current, ...(init.body as object), version: 4 } : current,
    );

    await changePhone('+44 20 7946 0999');

    expect(await screen.findByText('Organisation settings saved.')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/organisation/settings', {
      method: 'PATCH',
      body: { contactPhone: '+44 20 7946 0999' },
      headers: { 'If-Match': '"3"' },
    });
    expect(screen.getByLabelText('Contact phone')).toHaveValue('+44 20 7946 0999');
  });

  it('reports that the user may not change the settings and keeps what they entered', async () => {
    renderForm(async (_path, init) => {
      if (init?.method === 'PATCH') throw new ApiError({ status: 403, code: 'PERMISSION_DENIED' });
      return current;
    });

    await changePhone('+44 20 7946 0999');

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.queryByText('Organisation settings saved.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contact phone')).toHaveValue('+44 20 7946 0999');
  });

  it('warns when someone else saved first, then saves on top of the latest settings keeping the edit', async () => {
    const latest = { ...current, version: 4, city: 'Manchester' };
    let patches = 0;
    let gets = 0;
    const request = renderForm(async (_path, init) => {
      if (init?.method === 'PATCH') {
        patches += 1;
        if (patches === 1) {
          throw new ApiError({ status: 409, code: 'STALE_VERSION' });
        }
        return { ...latest, ...(init.body as object), version: 5 };
      }
      gets += 1;
      return gets === 1 ? current : latest;
    });

    const user = await changePhone('+44 20 7946 0999');

    expect(await screen.findByRole('alert')).toHaveTextContent('Changed by someone else');
    await user.click(screen.getByRole('button', { name: 'Load latest settings' }));

    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Manchester'));
    expect(screen.getByLabelText('Contact phone')).toHaveValue('+44 20 7946 0999');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Organisation settings saved.')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith('/organisation/settings', {
      method: 'PATCH',
      body: { contactPhone: '+44 20 7946 0999' },
      headers: { 'If-Match': '"4"' },
    });
  });

  it('says the organisation name is already in use', async () => {
    renderForm(async (_path, init) => {
      if (init?.method === 'PATCH') {
        throw new ApiError({
          status: 409,
          code: 'ORGANISATION_NAME_TAKEN',
          detail: "An organisation called 'Light Foundation' already exists",
        });
      }
      return current;
    });
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Organisation name');
    await user.clear(name);
    await user.type(name, 'Light Foundation');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Organisation name already in use');
    expect(alert).not.toHaveTextContent('Changed by someone else');
    expect(screen.queryByRole('button', { name: 'Load latest settings' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organisation name')).toHaveValue('Light Foundation');
  });

  it('says when the user may not view the settings', async () => {
    renderForm(async () => {
      throw new ApiError({ status: 403, code: 'PERMISSION_DENIED' });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to view the organisation settings.',
    );
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });
});
