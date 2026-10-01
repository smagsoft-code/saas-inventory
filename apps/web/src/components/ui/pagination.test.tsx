import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const href = (p: number) => `/x?page=${p}`;

describe('Pagination', () => {
  afterEach(() => cleanup());

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} pageSize={20} total={5} totalPages={1} buildHref={href} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no rows', () => {
    const { container } = render(
      <Pagination page={1} pageSize={20} total={0} totalPages={0} buildHref={href} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range and links only where a page exists', () => {
    render(<Pagination page={2} pageSize={20} total={45} totalPages={3} buildHref={href} />);
    expect(screen.getByText(/21/)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.getByText(/45/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /anterior/i })).toHaveAttribute('href', '/x?page=1');
    expect(screen.getByRole('link', { name: /siguiente/i })).toHaveAttribute('href', '/x?page=3');
  });

  it('disables Previous on the first page and Next on the last', () => {
    render(<Pagination page={1} pageSize={20} total={45} totalPages={3} buildHref={href} />);
    expect(screen.queryByRole('link', { name: /anterior/i })).not.toBeInTheDocument();
    expect(screen.getByText('Anterior')).toHaveAttribute('aria-disabled');
  });
});
