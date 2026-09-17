import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageFilePicker } from './image-file-picker';

describe('ImageFilePicker', () => {
  afterEach(() => cleanup());

  it('calls onPick when a file is chosen through the visible file input', () => {
    const onPick = vi.fn();
    render(<ImageFilePicker label="Elegir imagen" accept="image/png" onPick={onPick} />);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Elegir imagen'), { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
  });

  it('offers a "Tomar foto" button wired to a hidden camera-capture input', () => {
    render(<ImageFilePicker label="Elegir imagen" accept="image/png" onPick={vi.fn()} />);
    const cameraButton = screen.getByRole('button', { name: /tomar foto/i });
    expect(cameraButton).toBeInTheDocument();

    // The hidden input carries `capture` — mobile browsers open the camera app for it directly.
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(2);
    const cameraInput = inputs[1] as HTMLInputElement;
    expect(cameraInput).toHaveAttribute('capture', 'environment');
  });

  it('calls onPick when a photo is captured through the hidden camera input', () => {
    const onPick = vi.fn();
    render(<ImageFilePicker label="Elegir imagen" accept="image/png" onPick={onPick} />);
    const cameraInput = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const file = new File(['x'], 'capture.png', { type: 'image/png' });
    fireEvent.change(cameraInput, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
  });

  it('disables both inputs and the camera button when disabled', () => {
    render(<ImageFilePicker label="Elegir imagen" accept="image/png" disabled onPick={vi.fn()} />);
    expect(screen.getByLabelText('Elegir imagen')).toBeDisabled();
    expect(screen.getByRole('button', { name: /tomar foto/i })).toBeDisabled();
    expect(document.querySelectorAll('input[type="file"]')[1]).toBeDisabled();
  });
});
