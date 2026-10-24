import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button variants', () => {
  it('info is blue', () => {
    render(<Button variant="info">Revisar</Button>);
    expect(screen.getByRole('button', { name: 'Revisar' })).toHaveClass('bg-blue-600', 'text-white');
  });

  it('success is the same green as the cart subtotal pill', () => {
    render(<Button variant="success">Revisar archivo</Button>);
    expect(screen.getByRole('button', { name: 'Revisar archivo' })).toHaveClass('bg-green-600', 'text-white');
  });
});
