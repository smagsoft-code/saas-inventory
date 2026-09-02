import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import { CategoryAttributesEditor } from './category-attributes-editor';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const DEFS = [
  { id: 'd1', code: 'color', name: 'Colour', dataType: 'select', appliesTo: 'variant', isRequiredDefault: false, status: 'active' },
  { id: 'd2', code: 'power', name: 'Power', dataType: 'number', appliesTo: 'product', isRequiredDefault: true, status: 'active' },
];

describe('CategoryAttributesEditor', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('read-only mode lists the assigned attributes and offers no controls', () => {
    render(
      <CategoryAttributesEditor
        categoryId="c1"
        assigned={[{ attributeDefinitionId: 'd1', code: 'color', name: 'Colour', dataType: 'select', isRequired: true, displayOrder: 0 }]}
        definitions={DEFS}
        canManage={false}
      />,
    );
    expect(screen.getByText('Colour')).toBeInTheDocument();
    expect(screen.getByText(/required/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save attributes/i })).not.toBeInTheDocument();
  });

  it('adds an attribute and PUTs the full set with derived displayOrder', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    render(
      <CategoryAttributesEditor categoryId="c1" assigned={[]} definitions={DEFS} canManage />,
    );
    expect(screen.getByRole('button', { name: /save attributes/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/add an attribute/i), { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.change(screen.getByLabelText(/add an attribute/i), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    fireEvent.click(screen.getByRole('button', { name: /save attributes/i }));
    await waitFor(() => expect(screen.getByText(/category attributes saved/i)).toBeInTheDocument());

    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories/c1/attributes', {
      method: 'PUT',
      body: {
        entries: [
          { attributeDefinitionId: 'd2', isRequired: false, displayOrder: 0 },
          { attributeDefinitionId: 'd1', isRequired: false, displayOrder: 1 },
        ],
      },
    });
  });

  it('toggles "required" and reorders, reflected in the PUT payload', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    render(
      <CategoryAttributesEditor
        categoryId="c1"
        assigned={[
          { attributeDefinitionId: 'd1', code: 'color', name: 'Colour', dataType: 'select', isRequired: false, displayOrder: 0 },
          { attributeDefinitionId: 'd2', code: 'power', name: 'Power', dataType: 'number', isRequired: false, displayOrder: 1 },
        ]}
        definitions={DEFS}
        canManage
      />,
    );
    fireEvent.click(screen.getAllByRole('checkbox', { name: /required/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /move power up/i }));
    fireEvent.click(screen.getByRole('button', { name: /save attributes/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories/c1/attributes', {
        method: 'PUT',
        body: {
          entries: [
            { attributeDefinitionId: 'd2', isRequired: false, displayOrder: 0 },
            { attributeDefinitionId: 'd1', isRequired: true, displayOrder: 1 },
          ],
        },
      }),
    );
  });
});
