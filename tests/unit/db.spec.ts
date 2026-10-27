import { UnitOfWork, DatabaseTransaction } from '../../src/infra/db/unit-of-work';
import { DatabaseService } from '../../src/infra/db/database.service';
import { Kysely } from 'kysely';
import { Database } from '../../src/infra/db/database.types';

describe('UnitOfWork & DB Resilience (T-020)', () => {
  let mockDbService: Partial<DatabaseService>;
  let unitOfWork: UnitOfWork;

  beforeEach(() => {
    mockDbService = {
      db: {
        transaction: () => ({
          execute: jest.fn().mockImplementation(async cb => {
            return await cb({} as DatabaseTransaction);
          }),
        }),
      } as unknown as Kysely<Database>,
    };
    unitOfWork = new UnitOfWork(mockDbService as DatabaseService);
  });

  it('executes transaction work successfully on first attempt', async () => {
    const result = await unitOfWork.executeTransaction(async () => {
      return 'transaction_success';
    });

    expect(result).toBe('transaction_success');
  });

  it('retries when serialization error (40001) occurs and eventually succeeds', async () => {
    let callCount = 0;
    mockDbService = {
      db: {
        transaction: () => ({
          execute: jest.fn().mockImplementation(async cb => {
            callCount++;
            if (callCount === 1) {
              const err = Object.assign(new Error('serialization failure'), { code: '40001' });
              throw err;
            }
            return await cb({} as DatabaseTransaction);
          }),
        }),
      } as unknown as Kysely<Database>,
    };
    unitOfWork = new UnitOfWork(mockDbService as DatabaseService);

    const result = await unitOfWork.executeTransaction(async () => {
      return 'recovered_after_retry';
    });

    expect(result).toBe('recovered_after_retry');
    expect(callCount).toBe(2);
  });

  it('re-throws non-transient database errors immediately without retrying', async () => {
    let callCount = 0;
    mockDbService = {
      db: {
        transaction: () => ({
          execute: jest.fn().mockImplementation(async () => {
            callCount++;
            const err = Object.assign(new Error('foreign key violation'), { code: '23503' });
            throw err;
          }),
        }),
      } as unknown as Kysely<Database>,
    };
    unitOfWork = new UnitOfWork(mockDbService as DatabaseService);

    await expect(unitOfWork.executeTransaction(async () => 'ok')).rejects.toThrow(
      'foreign key violation',
    );
    expect(callCount).toBe(1);
  });
});
