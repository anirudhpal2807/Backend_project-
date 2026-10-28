import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database.types';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private dbInstance!: Kysely<Database>;

  constructor(private readonly configService: AppConfigService) {}

  onModuleInit() {
    const dbUrl = this.configService.get('DATABASE_URL');
    const sslFlag = this.configService.get('DB_SSL');
    const isNeon = dbUrl?.includes('neon.tech') || dbUrl?.includes('sslmode=require');
    const useSsl = sslFlag || isNeon ? { rejectUnauthorized: false } : undefined;

    this.pool = dbUrl
      ? new Pool({
          connectionString: dbUrl,
          min: this.configService.get('DB_POOL_MIN'),
          max: this.configService.get('DB_POOL_MAX'),
          statement_timeout: this.configService.get('DB_STATEMENT_TIMEOUT_MS'),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
          ssl: useSsl,
        })
      : new Pool({
          host: this.configService.get('DB_HOST'),
          port: this.configService.get('DB_PORT'),
          database: this.configService.get('DB_NAME'),
          user: this.configService.get('DB_USER'),
          password: this.configService.get('DB_PASSWORD'),
          min: this.configService.get('DB_POOL_MIN'),
          max: this.configService.get('DB_POOL_MAX'),
          statement_timeout: this.configService.get('DB_STATEMENT_TIMEOUT_MS'),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
          ssl: useSsl,
        });

    const dialect = new PostgresDialect({
      pool: this.pool,
    });

    this.dbInstance = new Kysely<Database>({
      dialect,
    });
  }

  get db(): Kysely<Database> {
    return this.dbInstance;
  }

  get rawPool(): Pool {
    return this.pool;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async onModuleDestroy() {
    if (this.dbInstance) {
      await this.dbInstance.destroy();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
