import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DispositionGuide } from './disposition-guide';

describe('DispositionGuide', () => {
  it('explains the four dispositions and what they do to Inventario and Ventas', () => {
    render(<DispositionGuide />);
    for (const name of ['Reingreso a stock', 'Cuarentena', 'Dañado', 'Descarte']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText(/Ventas\s+puede volver a venderla/)).toBeInTheDocument();
    expect(screen.getByText(/no\s+da de baja las unidades/)).toBeInTheDocument();
    expect(screen.getByText(/Ninguna opción devuelve dinero/)).toBeInTheDocument();
  });
});
