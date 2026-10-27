import { Injectable } from '@nestjs/common';
import { EnvConfig } from './config.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: EnvConfig) {}

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.config.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === 'test';
  }

  getAll(): Readonly<EnvConfig> {
    return Object.freeze({ ...this.config });
  }
}
