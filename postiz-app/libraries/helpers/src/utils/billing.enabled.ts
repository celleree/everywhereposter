export const isBillingEnabled = () =>
  process.env.BILLING_ENABLED?.trim().toLowerCase() === 'true';
