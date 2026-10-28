import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { RedisService } from '../../src/infra/redis/redis.service';

describe('AnalyticsService (Unit Tests)', () => {
  let analyticsService: AnalyticsService;
  let mockDb: Record<string, jest.Mock>;
  let mockDatabaseService: Partial<DatabaseService>;
  let mockRedisService: Partial<RedisService>;
  let inMemoryCache: Map<string, string>;

  beforeEach(() => {
    inMemoryCache = new Map();

    mockDb = {
      selectFrom: jest.fn(),
      insertInto: jest.fn(),
    };

    mockDatabaseService = {
      get db() {
        return mockDb as unknown as DatabaseService['db'];
      },
    };

    mockRedisService = {
      get: jest
        .fn()
        .mockImplementation((key: string) => Promise.resolve(inMemoryCache.get(key) ?? null)),
      set: jest.fn().mockImplementation((key: string, val: string) => {
        inMemoryCache.set(key, val);
        return Promise.resolve();
      }),
    };

    analyticsService = new AnalyticsService(
      mockDatabaseService as DatabaseService,
      mockRedisService as RedisService,
    );
  });

  describe('refreshDailyRollup()', () => {
    it('should aggregate slots, consultations, and payments, and upsert daily rollup', async () => {
      // 1. mock slots query
      const mockSlotsTakeFirst = jest.fn().mockResolvedValue({ total_slots: 50, booked_slots: 35 });
      // 2. mock consultations query
      const mockConsultTakeFirst = jest.fn().mockResolvedValue({
        completed_count: 30,
        cancelled_count: 3,
        no_show_count: 2,
      });
      // 3. mock payments query
      const mockPaymentsTakeFirst = jest.fn().mockResolvedValue({
        total_revenue: 35000,
        refunded_amount: 1500,
      });

      mockDb.selectFrom.mockImplementation((table: string) => {
        if (table === 'availability_slots') {
          return {
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: mockSlotsTakeFirst,
          };
        }
        if (table === 'consultations') {
          return {
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: mockConsultTakeFirst,
          };
        }
        if (table === 'payments') {
          return {
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: mockPaymentsTakeFirst,
          };
        }
        return {};
      });

      const mockOnConflict = jest
        .fn()
        .mockReturnValue({ execute: jest.fn().mockResolvedValue([]) });
      const mockValues = jest.fn().mockReturnValue({ onConflict: mockOnConflict });
      mockDb.insertInto.mockReturnValue({ values: mockValues });

      const result = await analyticsService.refreshDailyRollup('2026-10-27');

      expect(result.date).toBe('2026-10-27');
      expect(result.total_slots).toBe(50);
      expect(result.booked_slots).toBe(35);
      expect(result.completed_consultations).toBe(30);
      expect(result.cancelled_consultations).toBe(3);
      expect(result.no_show_consultations).toBe(2);
      expect(result.total_revenue_inr).toBe(35000);
      expect(result.refunded_amount_inr).toBe(1500);
      expect(result.utilization_rate).toBe(70); // 35 / 50 = 70%

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-10-27',
          dimension: 'TOTAL',
          dimension_value: 'ALL',
          total_slots: 50,
          booked_slots: 35,
          total_revenue_inr: 35000,
        }),
      );
    });
  });

  describe('getSummary()', () => {
    it('should query pre-aggregated rollups and cache in Redis (cache-aside)', async () => {
      const sampleRollup = {
        date: '2026-10-27',
        dimension: 'TOTAL',
        dimension_value: 'ALL',
        total_slots: 100,
        booked_slots: 80,
        completed_consultations: 75,
        cancelled_consultations: 3,
        no_show_consultations: 2,
        total_revenue_inr: 80000,
        refunded_amount_inr: 2000,
        utilization_rate: 80,
      };

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([sampleRollup]),
      });

      // 1st call: Cache miss -> query DB -> populate cache
      const summary1 = await analyticsService.getSummary({
        from_date: '2026-10-27',
        to_date: '2026-10-27',
      });

      expect(summary1.total_slots).toBe(100);
      expect(summary1.booked_slots).toBe(80);
      expect(summary1.net_revenue_inr).toBe(78000);
      expect(summary1.average_utilization_rate).toBe(80);
      expect(mockRedisService.set).toHaveBeenCalled();

      // 2nd call: Cache hit -> served from Redis without querying DB again
      mockDb.selectFrom.mockClear();
      const summary2 = await analyticsService.getSummary({
        from_date: '2026-10-27',
        to_date: '2026-10-27',
      });

      expect(summary2.net_revenue_inr).toBe(78000);
      expect(mockDb.selectFrom).not.toHaveBeenCalled();
    });
  });

  describe('getFunnel()', () => {
    it('should compute booking conversion funnel steps from summary', async () => {
      const sampleRollup = {
        date: '2026-10-27',
        dimension: 'TOTAL',
        dimension_value: 'ALL',
        total_slots: 100,
        booked_slots: 50,
        completed_consultations: 40,
        cancelled_consultations: 6,
        no_show_consultations: 4,
        total_revenue_inr: 50000,
        refunded_amount_inr: 0,
        utilization_rate: 50,
      };

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([sampleRollup]),
      });

      const funnel = await analyticsService.getFunnel({
        from_date: '2026-10-27',
        to_date: '2026-10-27',
      });

      expect(funnel.steps).toHaveLength(3);
      expect(funnel.steps[0]).toEqual({
        step: 1,
        name: 'Slots Available',
        count: 100,
        conversion_rate: 100,
      });
      expect(funnel.steps[1]).toEqual({
        step: 2,
        name: 'Slots Booked',
        count: 50,
        conversion_rate: 50,
      });
      expect(funnel.steps[2]).toEqual({
        step: 3,
        name: 'Consultations Completed',
        count: 40,
        conversion_rate: 80,
      });
      expect(funnel.drop_offs.cancelled).toBe(6);
      expect(funnel.drop_offs.no_show).toBe(4);
    });
  });

  describe('exportCsv() (T-104)', () => {
    it('should export rollups as valid RFC 4180 CSV string', async () => {
      const sampleRollup = {
        date: '2026-10-27',
        dimension: 'TOTAL',
        dimension_value: 'ALL',
        total_slots: 10,
        booked_slots: 8,
        completed_consultations: 7,
        cancelled_consultations: 1,
        no_show_consultations: 0,
        total_revenue_inr: 8000,
        refunded_amount_inr: 0,
        utilization_rate: 80,
      };

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([sampleRollup]),
      });

      const csv = await analyticsService.exportCsv({
        from_date: '2026-10-27',
        to_date: '2026-10-27',
      });

      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'date,dimension,dimension_value,total_slots,booked_slots,completed_consultations,cancelled_consultations,no_show_consultations,total_revenue_inr,refunded_amount_inr,utilization_rate',
      );
      expect(lines[1]).toBe('2026-10-27,TOTAL,ALL,10,8,7,1,0,8000,0,80');
    });
  });
});
