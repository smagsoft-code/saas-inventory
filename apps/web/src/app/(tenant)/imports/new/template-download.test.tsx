import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TemplateDownload } from './template-download';

const CATEGORIES = [{ id: 'c1', name: 'TVs' }];

describe('TemplateDownload', () => {
  afterEach(() => cleanup());

  it('offers the download as a plain link to the API path', () => {
    render(<TemplateDownload categories={[]} />);
    const link = screen.getByRole('link', { name: /descargar plantilla/i });
    expect(link).toHaveAttribute('href', '/api/v1/imports/template');
  });

  it('uses the primary button style', () => {
    render(<TemplateDownload categories={[]} />);
    expect(screen.getByRole('link', { name: /descargar plantilla/i })).toHaveClass('bg-slate-900', 'text-white');
  });

  it('adds categoryId to the link once a category is picked', () => {
    render(<TemplateDownload categories={CATEGORIES} />);
    fireEvent.change(screen.getByLabelText('Categoría de la plantilla'), { target: { value: 'c1' } });
    expect(screen.getByRole('link', { name: /descargar plantilla/i })).toHaveAttribute(
      'href',
      '/api/v1/imports/template?categoryId=c1',
    );
  });

  it('hides the category picker when there are no categories', () => {
    render(<TemplateDownload categories={[]} />);
    expect(screen.queryByLabelText('Categoría de la plantilla')).not.toBeInTheDocument();
  });
});
