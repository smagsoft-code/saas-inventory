import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './modal';

describe('Modal', () => {
  afterEach(() => cleanup());

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Carrito">
        content
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a labelled dialog with its children and footer when open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Carrito" footer={<button type="button">Continuar</button>}>
        <p>Línea 1</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Carrito' })).toBeInTheDocument();
    expect(screen.getByText('Línea 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Carrito">
        content
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click and on the header close button', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Carrito">
        content
      </Modal>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open and restores it on close', () => {
    const { rerender } = render(
      <Modal open onClose={vi.fn()} title="Carrito">
        content
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Modal open={false} onClose={vi.fn()} title="Carrito">
        content
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});
