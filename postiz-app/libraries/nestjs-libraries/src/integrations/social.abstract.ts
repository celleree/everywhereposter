import { timer } from '@gitroom/helpers/utils/timer';
import { Integration } from '@prisma/client';
import { ApplicationFailure } from '@temporalio/activity';
import { PublishedPostCapabilities } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export class RefreshToken extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(message, 'refresh_token', true, [
      {
        identifier,
        json,
        body,
      },
    ]);
  }
}

export class BadBody extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(message, 'bad_body', true, [
      {
        identifier,
        json,
        body,
      },
    ]);
  }
}

export class NotEnoughScopes {
  constructor(
    public message = 'Not enough scopes, when choosing a provider, please add all the scopes'
  ) {}
}

function safeStringify(obj: any) {
  const seen = new WeakSet();

  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  public handleErrors(
    body: string,
    status: number,
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return undefined;
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  protected buildPublishedCapabilities(
    integration?: Integration,
    overrides: Partial<PublishedPostCapabilities> = {}
  ): PublishedPostCapabilities {
    const name = (this as any).name || 'This platform';
    const hasUpdate = typeof (this as any).update === 'function';
    const hasDeletePublished =
      typeof (this as any).deletePublished === 'function';

    const capabilities: PublishedPostCapabilities = {
      editMode: hasUpdate ? 'metadata' : 'none',
      canDeletePublished: hasDeletePublished,
      reason: undefined,
      requiresReconnect: !!integration?.refreshNeeded,
      constraints: [],
      ...overrides,
    };

    if (!capabilities.reason) {
      if (capabilities.requiresReconnect) {
        capabilities.reason =
          'Reconnect this channel to manage published posts.';
      } else if (
        capabilities.editMode === 'none' &&
        !capabilities.canDeletePublished
      ) {
        capabilities.reason = `${name} does not support editing or deleting published posts yet.`;
      } else if (capabilities.editMode === 'none') {
        capabilities.reason = `${name} only supports deleting published posts right now.`;
      } else if (!capabilities.canDeletePublished) {
        capabilities.reason = `${name} supports editing published post metadata, but not deleting the live post yet.`;
      }
    }

    return capabilities;
  }

  public getPublishedCapabilities(
    integration?: Integration
  ): PublishedPostCapabilities {
    return this.buildPublishedCapabilities(integration);
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    let value: any;
    try {
      value = await func();
    } catch (err) {
      const handle = this.handleErrors(safeStringify(err), 200);
      value = { err: true, value: 'Unknown Error', ...(handle || {}) };
    }

    if (value && value?.err && value?.value) {
      if (value.type === 'refresh-token') {
        throw new RefreshToken(
          '',
          safeStringify({}),
          {} as any,
          value.value || ''
        );
      }
      throw new BadBody('', safeStringify({}), {} as any, value.value || '');
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false
  ): Promise<Response> {
    const request = await fetch(url, options);

    if (
      request.status === 200 ||
      request.status === 201 ||
      request.status === 204
    ) {
      return request;
    }

    if (totalRetries > 2) {
      throw new BadBody(identifier, '{}', options.body || '{}');
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    const handleError = this.handleErrors(json || '{}', request.status);

    if (
      request.status === 429 ||
      (request.status === 500 && !handleError) ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency
      );
    }

    if (handleError?.type === 'retry') {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency
      );
    }

    if (
      (request.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new RefreshToken(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new BadBody(
      identifier,
      json,
      options.body!,
      handleError?.value || ''
    );
  }

  checkScopes(required: string[], got?: string | string[]) {
    const gotArray = Array.isArray(got)
      ? got
      : typeof got === 'string'
      ? decodeURIComponent(got).split(got.indexOf(',') > -1 ? ',' : ' ')
      : [];

    const normalizedScopes = gotArray.filter((scope) => !!scope);
    const missingScopes = required.filter(
      (scope) => !normalizedScopes.includes(scope)
    );

    if (missingScopes.length) {
      throw new NotEnoughScopes(
        `Missing required permissions: ${missingScopes.join(', ')}`
      );
    }

    return true;
  }
}
