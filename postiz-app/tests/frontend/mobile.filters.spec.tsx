import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Filters } from '@gitroom/frontend/components/launches/filters';

let mockCalendar: any;
jest.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  useCalendar: () => mockCalendar,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/frontend/components/launches/select.customer', () => ({
  SelectCustomer: ({ onChange }: any) => (
    <button onClick={() => onChange('customer-2')}>Choose customer</button>
  ),
}));

beforeEach(() => {
  mockCalendar = {
    isMobile: true,
    mobileTab: 'scheduled',
    setMobileTab: jest.fn(),
    mobileMonth: '2026-09-01',
    moveMobileMonth: jest.fn(),
    setMobileCustomer: jest.fn(),
    customer: null,
    integrations: [],
    mobilePage: 0,
    mobileTotalPages: 2,
    setMobilePage: jest.fn(),
    display: 'month',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    setFilters: jest.fn(),
  };
});

it('shows only mobile tabs, customer and scheduled pagination controls', () => {
  render(<Filters />);
  expect(screen.getByRole('button', { name: 'Scheduled' })).toBeTruthy();
  expect(screen.getByText('One-time scheduled posts.')).toBeTruthy();
  expect(screen.queryByText('Day')).toBeNull();
  expect(screen.queryByText('Week')).toBeNull();
  expect(screen.queryByText('Month')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All posts' }));
  expect(mockCalendar.setMobileTab).toHaveBeenCalledWith('all');
  fireEvent.click(screen.getByRole('button', { name: 'Choose customer' }));
  expect(mockCalendar.setMobileCustomer).toHaveBeenCalledWith('customer-2');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(mockCalendar.setMobilePage).toHaveBeenCalledWith(1);
  expect(mockCalendar.setFilters).not.toHaveBeenCalled();
});

it('shows simple month browsing only on the All posts tab', () => {
  mockCalendar.mobileTab = 'all';
  render(<Filters />);
  expect(screen.getByText('September 2026')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(mockCalendar.moveMobileMonth).toHaveBeenCalledWith(-1);
  expect(screen.queryByText('One-time scheduled posts.')).toBeNull();
});
