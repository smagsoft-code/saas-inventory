import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { RevokeQrButton } from './revoke-qr-button';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

describe('RevokeQrButton', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('requires a confirm step, then PATCHes { status: "revoked" } and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<RevokeQrButton id="q1" />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    expect(mockedFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes/q1', {
      method: 'PATCH',
      body: { status: 'revoked' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenant_?id/i);
  });

  it('shows a safe message on 403 and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    render(<RevokeQrButton id="q1" />);
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not authorized/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
