import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpTip } from './help-tip';

afterEach(() => cleanup());

describe('HelpTip', () => {
  it('hides the legend until the icon is pressed', () => {
    render(<HelpTip>Texto de ayuda</HelpTip>);
    const button = screen.getByRole('button', { name: 'Ayuda' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Texto de ayuda')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Texto de ayuda');
  });

  it('closes on a second press, on Escape and on a click outside', () => {
    render(
      <div>
        <HelpTip>Texto de ayuda</HelpTip>
        <p>fuera</p>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Ayuda' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByText('fuera'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('never submits a surrounding form', () => {
    let submitted = false;
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true; }}>
        <HelpTip>Texto</HelpTip>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }));
    expect(submitted).toBe(false);
  });
});
