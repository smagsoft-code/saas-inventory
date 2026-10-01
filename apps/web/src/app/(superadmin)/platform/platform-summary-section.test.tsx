import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformSummaryError, PlatformSummarySection } from './platform-summary-section';
import type { PlatformSummary } from '../../../lib/types/platform-summary';

function baseSummary(overrides: Partial<PlatformSummary> = {}): PlatformSummary {
  return {
    generatedAt: '2026-09-08T12:00:00.000Z',
    totalCount: 12,
    byStatus: { active: 9, suspended: 2, archived: 1 },
    demoCount: 3,
    period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T12:00:00.000Z', newInPeriod: 4 },
    ...overrides,
  };
}

describe('PlatformSummarySection', () => {
  it('renders the four count tiles from the endpoint values', () => {
    render(<PlatformSummarySection summary={baseSummary()} newWindowLabel="desde 2026-09-01 (UTC)" />);
    expect(screen.getByText('Empresas')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Activas')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('2 suspendidas · 1 archivadas')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // newInPeriod
    expect(screen.getByText('desde 2026-09-01 (UTC)')).toBeInTheDocument();
  });

  it('shows a dash for the "new" tile when the endpoint returned no period', () => {
    render(<PlatformSummarySection summary={baseSummary({ period: null })} newWindowLabel="desde 2026-09-01 (UTC)" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('never renders any individual tenant identifier', () => {
    const { container } = render(<PlatformSummarySection summary={baseSummary()} newWindowLabel="x" />);
    expect(container.textContent).not.toMatch(/slug|acme|tenant-/i);
  });
});

describe('PlatformSummaryError', () => {
  it('shows a plain message, no stack', () => {
    render(<PlatformSummaryError message="Something went wrong on our end." />);
    expect(screen.getByText('No se pudieron cargar las métricas de la plataforma')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our end.')).toBeInTheDocument();
  });
});
