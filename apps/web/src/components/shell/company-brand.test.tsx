import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanyBrand } from './company-brand';

describe('CompanyBrand', () => {
  it('without a logo: the two initials in the badge and the company name (never "SaaS Inventory")', () => {
    render(<CompanyBrand name="Muebles Norte" />);
    expect(screen.getByText('MN')).toBeInTheDocument();
    expect(screen.getByText('Muebles Norte')).toBeInTheDocument();
    expect(screen.queryByText(/SaaS Inventory/)).not.toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('a single-word name takes its first two letters', () => {
    render(<CompanyBrand name="Acme" />);
    expect(screen.getByText('AC')).toBeInTheDocument();
  });

  it('with a logo: the image replaces the initials, versioned so a new upload is a new URL', () => {
    const { container } = render(<CompanyBrand name="Muebles Norte" logoVersion={1700} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/v1/tenant/logo?v=1700');
    expect(screen.queryByText('MN')).not.toBeInTheDocument();
  });

  it('a logo that fails to load falls back to the initials', () => {
    const { container } = render(<CompanyBrand name="Muebles Norte" logoVersion={1} />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('MN')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the badge width and shrinks/wraps a long name instead of widening it', () => {
    render(<CompanyBrand name="Distribuidora de Muebles y Electrodomésticos del Norte S.A." />);
    const name = screen.getByText(/Distribuidora de Muebles/);
    expect(name).toHaveClass('text-xs');
    expect(name).toHaveStyle({ WebkitLineClamp: '2' });
    expect(name).toHaveAttribute('title', 'Distribuidora de Muebles y Electrodomésticos del Norte S.A.');
    expect(screen.getByText('DD').className).toContain('w-7');
  });

  it('a short name keeps the regular size', () => {
    render(<CompanyBrand name="Acme Corp" />);
    expect(screen.getByText('Acme Corp')).toHaveClass('text-sm');
  });
});
