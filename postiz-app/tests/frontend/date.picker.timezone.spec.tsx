import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { DatePicker } from '../../apps/frontend/src/components/launches/helpers/date.picker';
dayjs.extend(utc);
jest.mock('@mantine/dates', () => ({ Calendar: () => null, TimeInput: () => null }));
jest.mock('@mantine/hooks', () => ({ useClickOutside: () => ({ current: null }) }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
jest.mock('@gitroom/react/form/button', () => ({ Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button> }));
jest.mock('@gitroom/frontend/components/ui/icons', () => ({ CalendarIcon: () => null }));

it.each([-420, -480, 330])('shows the actual selected date offset (%s minutes) without changing the scheduled instant', offset => {
  const date = dayjs.utc('2026-10-22T19:00:00Z').utcOffset(offset);
  const onChange = jest.fn();
  render(<DatePicker date={date} onChange={onChange} />);
  fireEvent.click(screen.getByText('UTC' + date.format('Z')));
  expect(screen.getByText('Time zone: UTC' + date.format('Z'))).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
