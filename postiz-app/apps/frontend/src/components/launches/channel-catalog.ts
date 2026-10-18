// Older/missing metadata fails closed. Keep server names and connection dispatch metadata.
export function availableChannels<T extends { connectionAvailable?: boolean }>(social: T[]): T[] {
  return social.filter(provider => provider.connectionAvailable === true);
}
