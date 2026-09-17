import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { ProductImageQrPanel } from './product-image-qr-panel';

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const BASE_PROPS = {
  productId: 'p1',
  variantId: 'v1',
  apiPublicUrl: 'http://localhost:4000',
  canManageImage: true,
  canManageQr: true,
  maxPrice: 149.9,
};

describe('ProductImageQrPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows a placeholder and an upload control when there is no image yet', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText(/elegir imagen/i)).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('shows the existing image and offers to replace it', () => {
    const { container } = render(<ProductImageQrPanel {...BASE_PROPS} initialImageUrl="/api/v1/products/p1/images/img-1" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/v1/products/p1/images/img-1');
    expect(screen.getByLabelText(/reemplazar imagen/i)).toBeInTheDocument();
  });

  it('uploads a chosen image via multipart POST and swaps in the resulting URL', async () => {
    mockedFetch.mockResolvedValue({ url: '/api/v1/products/p1/images/img-2' });
    const { container } = render(<ProductImageQrPanel {...BASE_PROPS} />);

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [file] } });

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', '/api/v1/products/p1/images/img-2'));
    const [path, opts] = mockedFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/products/p1/images');
    expect((opts as { method: string; body: unknown }).method).toBe('POST');
    expect((opts as { body: unknown }).body).toBeInstanceOf(FormData);
  });

  it('rejects an unsupported file type client-side, never calling the API', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} />);
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [file] } });
    expect(screen.getByText(/solo se aceptan imágenes/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows a "Generar código QR" button when there is none yet, and the code inline (with Imprimir) after generating one', async () => {
    mockedFetch.mockResolvedValue({ code: 'ABC123' });
    render(<ProductImageQrPanel {...BASE_PROPS} />);

    expect(screen.getByRole('button', { name: /generar código qr/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generar código qr/i }));

    await waitFor(() => expect(screen.getByText('http://localhost:4000/q/ABC123')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes', {
      method: 'POST',
      body: { targetType: 'product_variant', targetId: 'v1' },
    });
  });

  it('shows the code inline (not a thumbnail) when a QR already exists, with no generate button', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} initialQrValue="http://localhost:4000/q/existing" />);
    expect(screen.getByText('http://localhost:4000/q/existing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generar código qr/i })).not.toBeInTheDocument();
  });

  it('shows Precio máximo (the variant\'s maxPrice, app-wide toFixed(2) format) next to an existing QR, so it prints too', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} initialQrValue="http://localhost:4000/q/existing" />);
    expect(screen.getByText('Precio máximo: 149.90')).toBeInTheDocument();
  });

  it('offers a "Tomar foto" camera action alongside the file picker', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /tomar foto/i })).toBeInTheDocument();
  });

  it('hides the upload control when the caller cannot manage images, and the whole QR section when it cannot manage QR', () => {
    render(<ProductImageQrPanel {...BASE_PROPS} canManageImage={false} canManageQr={false} />);
    expect(screen.queryByLabelText(/elegir imagen/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Código QR')).not.toBeInTheDocument();
  });
});
