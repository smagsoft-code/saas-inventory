import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductImageDimensions } from './product-image-dimensions';

describe('ProductImageDimensions', () => {
  it('says only the size', () => {
    render(<ProductImageDimensions />);
    expect(screen.getByText('Dimensiones: 800x800 px')).toBeInTheDocument();
  });
});
