import { Injectable } from '@nestjs/common';
import { Transaction } from 'kysely';
import { DatabaseService } from './database.service';
import { Database } from './database.types';

export type DatabaseTransaction = Transaction<Database>;

@Injectable()
export class UnitOfWork {
  private readonly maxRetries = 3;
  private readonly baseBackoffMs = 50;

  constructor(private readonly dbService: DatabaseService) {}

  async executeTransaction<T>(work: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        return await this.dbService.db.transaction().execute(async trx => {
          return await work(trx);
        });
      } catch (error) {
        const pgError = error as { code?: string; message?: string };
        const isDeadlockOrSerialization =
          pgError.code === '40001' || // serialization_failure
          pgError.code === '40P01'; // deadlock_detected

        if (isDeadlockOrSerialization && attempt < this.maxRetries) {
          // Exponential backoff with full jitter
          const backoff = Math.floor(Math.random() * (this.baseBackoffMs * Math.pow(2, attempt)));
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        throw error;
      }
    }
  }

  async withTransaction<T>(work: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.executeTransaction(work);
  }
}
