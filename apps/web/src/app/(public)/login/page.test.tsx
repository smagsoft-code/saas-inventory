import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '../../../lib/api-client';
import { apiFetch } from '../../../lib/api-client';
import LoginPage from './page';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('../../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../../lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders workspace, email, and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
  });

  it('submits tenantSlug/email/password and redirects on success', async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('acme-corp'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@acme.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { tenantSlug: 'acme', email: 'admin@acme.com', password: 'a-long-password' },
    });
  });

  it('shows the generic error message on failed login without exposing which field was wrong', async () => {
    const { ApiError } = await vi.importActual<typeof ApiClientModule>('../../../lib/api-client');
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid tenant, email, or password.', undefined));
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid tenant, email, or password.');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
