import { AvailabilityService } from '../../src/modules/availability/availability.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { Kysely } from 'kysely';
import { Database } from '../../src/infra/db/database.types';

describe('Availability & Slots Management (T-051, T-053)', () => {
  function createMockDbService(mockDb: unknown): DatabaseService {
    return {
      get db() {
        return mockDb as Kysely<Database>;
      },
    } as unknown as DatabaseService;
  }

  describe('blockSlot', () => {
    it('rejects blocking a slot that is already BOOKED with 409 Conflict', async () => {
      const mockDb = {
        selectFrom: () => ({
          selectAll: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: jest.fn().mockResolvedValue({
                  id: 'slot-1',
                  status: 'BOOKED',
                }),
              }),
            }),
          }),
        }),
      };

      const availabilityService = new AvailabilityService(createMockDbService(mockDb));

      try {
        await availabilityService.blockSlot('doc-1', 'slot-1');
        fail('Expected 409 Conflict exception');
      } catch (err) {
        const appEx = err as AppException;
        expect(appEx.getStatus()).toBe(409);
        expect(appEx.code).toBe(ErrorCode.CONFLICT);
        expect(appEx.message).toContain('Cannot block a slot that has an active booking');
      }
    });

    it('rejects blocking a slot that is currently HELD with 409 Conflict', async () => {
      const mockDb = {
        selectFrom: () => ({
          selectAll: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: jest.fn().mockResolvedValue({
                  id: 'slot-1',
                  status: 'HELD',
                }),
              }),
            }),
          }),
        }),
      };

      const availabilityService = new AvailabilityService(createMockDbService(mockDb));

      try {
        await availabilityService.blockSlot('doc-1', 'slot-1');
        fail('Expected 409 Conflict exception');
      } catch (err) {
        const appEx = err as AppException;
        expect(appEx.getStatus()).toBe(409);
      }
    });

    it('allows blocking an OPEN slot', async () => {
      const mockUpdate = jest.fn().mockReturnValue({
        set: () => ({
          where: () => ({
            execute: jest.fn().mockResolvedValue({}),
          }),
        }),
      });

      const mockDb = {
        selectFrom: () => ({
          selectAll: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: jest.fn().mockResolvedValue({
                  id: 'slot-1',
                  status: 'OPEN',
                }),
              }),
            }),
          }),
        }),
        updateTable: mockUpdate,
      };

      const availabilityService = new AvailabilityService(createMockDbService(mockDb));
      const result = await availabilityService.blockSlot('doc-1', 'slot-1');
      expect(result.message).toContain('Slot blocked successfully');
    });
  });
});
