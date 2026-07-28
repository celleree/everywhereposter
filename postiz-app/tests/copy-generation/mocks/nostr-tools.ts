export const getPublicKey = () => '';

export const finalizeEvent = <T>(event: T) => event;

export class Relay {
  static async connect() {
    return new Relay();
  }

  subscribe() {
    return undefined;
  }

  async publish() {
    return undefined;
  }

  close() {
    return undefined;
  }
}

export class SimplePool {
  async get() {
    return null;
  }
}
