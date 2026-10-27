import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextStore {
  requestId: string;
  traceId?: string;
  actorId?: string;
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  static run<R>(store: RequestContextStore, callback: () => R): R {
    return this.storage.run(store, callback);
  }

  static get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getRequestId(): string {
    return this.storage.getStore()?.requestId || 'system';
  }

  static getActorId(): string | undefined {
    return this.storage.getStore()?.actorId;
  }

  static getActorRole(): string | undefined {
    return this.storage.getStore()?.actorRole;
  }

  static getUserId(): string | undefined {
    return this.getActorId();
  }

  static getRole(): string | undefined {
    return this.getActorRole();
  }
}
