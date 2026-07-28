expect.extend({
  toBeDisabled(received: HTMLInputElement | HTMLButtonElement) {
    const pass = Boolean(received?.disabled);
    return {
      pass,
      message: () =>
        pass
          ? 'Expected element not to be disabled.'
          : 'Expected element to be disabled.',
    };
  },
});
