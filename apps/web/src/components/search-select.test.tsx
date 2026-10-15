import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchSelect } from './search-select';

function setup(selected: { id: string; label: string } | null) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(
    <SearchSelect<{ id: string; name: string }>
      selected={selected}
      search={async () => [{ id: '1', name: 'Uno' }]}
      getKey={(i) => i.id}
      renderOption={(i) => <span>{i.name}</span>}
      onSelect={onSelect}
      onClear={onClear}
      ariaLabel="Buscar cosa"
      listLabel="Cosas"
      placeholder="Busca"
      emptyText="Nada"
    />,
  );
  return { onSelect, onClear };
}

describe('SearchSelect', () => {
  it('shows the chosen item as a chip in the primary colour with white text, with a clear button', () => {
    const { onClear } = setup({ id: '1', label: 'Uno' });
    const chip = screen.getByText('Uno');
    expect(chip.className).toContain('bg-slate-900');
    expect(chip.className).toContain('text-white');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('searches, lists results and reports the picked one', async () => {
    const { onSelect } = setup(null);
    fireEvent.change(screen.getByLabelText('Buscar cosa'), { target: { value: 'u' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Uno' }));
    expect(onSelect).toHaveBeenCalledWith({ id: '1', name: 'Uno' });
  });
});
