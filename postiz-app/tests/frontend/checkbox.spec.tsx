import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from '../../libraries/react-shared-libraries/src/form/checkbox';

describe('Checkbox', () => {
  it('exposes disabled checkbox semantics and blocks pointer and keyboard changes', () => {
    const onChange = jest.fn();

    render(
      <Checkbox
        disableForm
        checked={false}
        disabled
        label="Keep source video"
        onChange={onChange}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Keep source video' });

    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    expect(checkbox.getAttribute('aria-disabled')).toBe('true');
    expect(checkbox.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(checkbox);
    fireEvent.keyDown(checkbox, { key: 'Enter' });
    fireEvent.keyDown(checkbox, { key: ' ' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports pointer and keyboard activation when enabled', () => {
    const onChange = jest.fn();

    render(
      <Checkbox
        disableForm
        checked={false}
        label="Use image"
        onChange={onChange}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Use image' });

    expect(checkbox.getAttribute('aria-disabled')).toBeNull();
    expect(checkbox.getAttribute('tabindex')).toBe('0');

    fireEvent.click(checkbox);
    fireEvent.keyDown(checkbox, { key: 'Enter' });
    fireEvent.keyDown(checkbox, { key: ' ' });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith({
      target: {
        name: undefined,
        value: true,
      },
    });
  });
});
