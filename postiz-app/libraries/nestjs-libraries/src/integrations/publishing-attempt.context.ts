import { AsyncLocalStorage } from 'node:async_hooks';

// Scoped to one durable provider call; concurrent normal publishing is unaffected.
export const publishingAttemptContext = new AsyncLocalStorage<boolean>();
export const suppressPublishingRetry = () =>
  publishingAttemptContext.getStore() === true;
