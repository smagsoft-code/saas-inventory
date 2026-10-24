import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionPicker } from './permission-picker';

const catalog = [
  { code: 'core.tenant.update', module: 'core', description: 'Actualizar los datos editables del tenant actual (nombre)' },
  { code: 'sales.orders.view', module: 'sales', description: 'Listar y ver las ordenes de venta del tenant actual' },
  { code: 'new.thing.do', module: 'sales', description: 'Hacer algo nuevo' },
];

describe('PermissionPicker', () => {
  it('shows plain labels, never the technical description or the code', () => {
    render(<PermissionPicker catalog={catalog} selected={new Set()} onToggle={vi.fn()} />);
    expect(screen.getByLabelText('Editar los datos de la empresa')).toBeInTheDocument();
    expect(screen.getByLabelText('Ver el historial de ventas')).toBeInTheDocument();
    expect(screen.queryByText(/tenant/i)).not.toBeInTheDocument();
    expect(screen.queryByText('core.tenant.update')).not.toBeInTheDocument();
  });

  it('titles the groups in Spanish and falls back to the API text for an untranslated permission', () => {
    render(<PermissionPicker catalog={catalog} selected={new Set()} onToggle={vi.fn()} />);
    expect(screen.getByText('Usuarios, roles y empresa')).toBeInTheDocument();
    expect(screen.getByText('Ventas')).toBeInTheDocument();
    expect(screen.getByLabelText('Hacer algo nuevo')).toBeInTheDocument();
  });

  it('each permission has a help icon that summarises what it allows', () => {
    render(<PermissionPicker catalog={catalog} selected={new Set()} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda sobre: Editar los datos de la empresa' }));
    expect(screen.getByText('Cambiar el nombre de la empresa y subir o quitar su logo.')).toBeInTheDocument();
  });

  it('toggles by the real code, and stays readable (help works) while disabled', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<PermissionPicker catalog={catalog} selected={new Set(['sales.orders.view'])} onToggle={onToggle} />);
    expect(screen.getByLabelText('Ver el historial de ventas')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Editar los datos de la empresa'));
    expect(onToggle).toHaveBeenCalledWith('core.tenant.update');

    rerender(<PermissionPicker catalog={catalog} selected={new Set()} onToggle={onToggle} disabled />);
    expect(screen.getByLabelText('Editar los datos de la empresa')).toBeDisabled();
    const help = screen.getByRole('button', { name: 'Ayuda sobre: Editar los datos de la empresa' });
    expect(help).not.toBeDisabled();
  });
});
