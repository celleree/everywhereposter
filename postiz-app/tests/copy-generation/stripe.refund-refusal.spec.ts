const mockRefund = jest.fn(), mockRetrieve = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ refunds: { create: mockRefund }, charges: { retrieve: mockRetrieve } })) }));
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

it('refuses legacy charge refunds before any provider or organization lookup, including wallet and foreign payments', async () => {
  const prior = process.env.BILLING_ENABLED; process.env.BILLING_ENABLED = 'true';
  const getOrgById = jest.fn();
  try {
    const service = new StripeService({} as any, { getOrgById } as any, {} as any, {} as any);
    for (const id of ['ch_wallet', 'ch_foreign', 'ch_subscription']) {
      await expect(service.refundCharges('synthetic-org', [id])).rejects.toThrow('financial reconciliation');
    }
    expect(mockRefund).not.toHaveBeenCalled(); expect(mockRetrieve).not.toHaveBeenCalled(); expect(getOrgById).not.toHaveBeenCalled();
  } finally { prior === undefined ? delete process.env.BILLING_ENABLED : process.env.BILLING_ENABLED = prior; }
});
