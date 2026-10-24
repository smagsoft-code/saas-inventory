import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { CompanyLogoForm } from './company-logo-form';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const png = (name = 'logo.png', type = 'image/png', size = 10) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('CompanyLogoForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('without a logo: shows the initials, the 256x256 dimensions and "Subir logo"', () => {
    render(<CompanyLogoForm companyName="Muebles Norte" logoVersion={undefined} canManage />);
    expect(screen.getByLabelText(/Sin logo/)).toHaveTextContent('MN');
    expect(screen.getByText('Dimensiones: 256x256 px')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir logo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar logo' })).not.toBeInTheDocument();
  });

  it('with a logo: shows it, and offers "Cambiar logo" and "Quitar logo"', () => {
    render(<CompanyLogoForm companyName="Muebles Norte" logoVersion={55} canManage />);
    expect(screen.getByRole('img', { name: 'Logo de Muebles Norte' })).toHaveAttribute('src', '/api/v1/tenant/logo?v=55');
    expect(screen.getByRole('button', { name: 'Cambiar logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar logo' })).toBeInTheDocument();
  });

  it('uploads the chosen file as multipart PUT /tenant/logo and refreshes the shell', async () => {
    mockedFetch.mockResolvedValueOnce({ logoVersion: 1 });
    render(<CompanyLogoForm companyName="Acme" logoVersion={undefined} canManage />);
    fireEvent.change(screen.getByLabelText('Elegir logo'), { target: { files: [png()] } });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const [path, options] = mockedFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/tenant/logo');
    expect(options).toMatchObject({ method: 'PUT' });
    expect((options!.body as FormData).get('file')).toBeInstanceOf(File);
    expect(await screen.findByText('Logo guardado.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses a wrong type or an oversized file before any request, in Spanish', async () => {
    render(<CompanyLogoForm companyName="Acme" logoVersion={undefined} canManage />);
    fireEvent.change(screen.getByLabelText('Elegir logo'), { target: { files: [png('x.svg', 'image/svg+xml')] } });
    expect(await screen.findByText('Elige una imagen JPEG, PNG o WEBP.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Elegir logo'), { target: { files: [png('big.png', 'image/png', 3 * 1024 * 1024)] } });
    expect(await screen.findByText('Esa imagen supera el límite de 2 MB.')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('removes the logo with DELETE and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<CompanyLogoForm companyName="Acme" logoVersion={9} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar logo' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/tenant/logo', { method: 'DELETE' }));
    expect(await screen.findByText('Logo quitado.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a server failure without refreshing', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'x', undefined));
    render(<CompanyLogoForm companyName="Acme" logoVersion={undefined} canManage />);
    fireEvent.change(screen.getByLabelText('Elegir logo'), { target: { files: [png()] } });
    expect(await screen.findByText('No tienes permiso para hacer eso.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('without permission: no buttons, only an explanation', () => {
    render(<CompanyLogoForm companyName="Acme" logoVersion={5} canManage={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('No tienes permiso para cambiar el logo.')).toBeInTheDocument();
  });
});
