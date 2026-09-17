import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QrThumbnailModal } from './qr-thumbnail-modal';

describe('QrThumbnailModal', () => {
  afterEach(() => cleanup());

  it('renders a thumbnail button and no dialog until clicked', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget — SKU-1" />);
    expect(screen.getByRole('button', { name: /ver código qr de widget/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog with the full value, a print action, and closes on the explicit close button', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget — SKU-1" />);
    fireEvent.click(screen.getByRole('button', { name: /ver código qr de widget/i }));

    const dialog = screen.getByRole('dialog', { name: /código qr — widget/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('http://localhost:4000/q/abc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows Precio máximo inside the printable dialog when a price is given, and omits it when not', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget — SKU-1" maxPrice={79.5} />);
    fireEvent.click(screen.getByRole('button', { name: /ver código qr de widget/i }));
    expect(screen.getByText('Precio máximo: 79.50')).toBeInTheDocument();
  });

  it('renders no price line when maxPrice is not provided', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget — SKU-1" />);
    fireEvent.click(screen.getByRole('button', { name: /ver código qr de widget/i }));
    expect(screen.queryByText(/precio máximo/i)).not.toBeInTheDocument();
  });

  it('opens immediately when defaultOpen is set (the /qr/new post-generate view)', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget — SKU-1" defaultOpen />);
    expect(screen.getByRole('dialog', { name: /código qr — widget/i })).toBeInTheDocument();
  });

  it('closes on Escape and on a backdrop click', () => {
    render(<QrThumbnailModal value="http://localhost:4000/q/abc" label="Widget" />);

    fireEvent.click(screen.getByRole('button', { name: /ver código qr/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver código qr/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cerrar el código qr/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
