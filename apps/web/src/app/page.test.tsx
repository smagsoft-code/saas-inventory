import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('renders the project name', () => {
    render(<HomePage />);
    expect(screen.getByText('SaaS Inventory')).toBeInTheDocument();
  });
});
