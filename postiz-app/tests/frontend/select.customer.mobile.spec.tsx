import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';

const setCurrent = jest.fn();

jest.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: any) => unknown) =>
    selector({ setCurrent }),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@mantine/hooks', () => ({
  useClickOutside: () => React.useRef(null),
}));

const integrations = [
  { id: 'personal', customer: null },
  { id: 'client', customer: { id: 'customer-1', name: 'Client' } },
] as any;

it('shows the active mobile customer and lets users clear the filter', () => {
  const CustomerFilter = () => {
    const [customer, setCustomer] = useState('');
    return (
      <SelectCustomer
        integrations={integrations}
        customer={customer}
        onChange={setCustomer}
      />
    );
  };

  render(<CustomerFilter />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Select Customer: All channels' })
  );
  fireEvent.click(screen.getByText('Client'));
  expect(
    screen.getByRole('button', { name: 'Select Customer: Client' })
  ).toBeTruthy();

  fireEvent.click(
    screen.getByRole('button', { name: 'Select Customer: Client' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'All channels' }));
  expect(
    screen.getByRole('button', { name: 'Select Customer: All channels' })
  ).toBeTruthy();
  expect(setCurrent).toHaveBeenCalledWith('global');
});

it('keeps an active filter visible even when only one channel group remains', () => {
  const onChange = jest.fn();
  render(
    <SelectCustomer
      integrations={[integrations[1]]}
      customer="customer-1"
      onChange={onChange}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Select Customer: Client' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'All channels' }));
  expect(onChange).toHaveBeenCalledWith('');
});
