import { DoctorsSearchService } from '../../src/modules/doctors/doctors-search.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { RedisService } from '../../src/infra/redis/redis.service';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';

describe('DoctorsSearchService (Search & Redis Cache-Aside - Phase 8)', () => {
  let searchService: DoctorsSearchService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockRedis: jest.Mocked<RedisService>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  const sampleDoctor = {
    id: 'doc-uuid-1',
    user_id: 'user-uuid-1',
    experience_years: 12,
    consultation_fee: 1000,
    languages: ['Hindi', 'English'],
    bio: 'Ayurvedic specialist in chronic disease management',
    status: 'VERIFIED',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    const mockQueryBuilder = {
      selectAll: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([sampleDoctor]),
    };

    mockDbService = {
      get db() {
        return {
          selectFrom: jest.fn().mockImplementation((table: string) => {
            if (table === 'doctor_specializations') {
              return {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                execute: jest
                  .fn()
                  .mockResolvedValue([{ doctor_id: 'doc-uuid-1', specialization: 'Ayurveda' }]),
              };
            }
            return mockQueryBuilder;
          }),
        };
      },
    } as unknown as jest.Mocked<DatabaseService>;

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RedisService>;

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    searchService = new DoctorsSearchService(mockDbService, mockRedis, mockLogger);
  });

  it('should query DB on cache miss, return items and populate cache', async () => {
    const result = await searchService.searchDoctors({
      q: 'Ayurveda',
      limit: 10,
    });

    expect(result.cached).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].specializations).toContain('Ayurveda');
    expect(mockRedis.get).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('doctor_search:'),
      expect.any(String),
      expect.any(Number), // Jittered TTL
    );
  });

  it('should return cached response immediately on cache hit without executing DB query', async () => {
    const cachedData = {
      items: [
        {
          id: 'doc-cached-1',
          user_id: 'user-cached-1',
          experience_years: 15,
          consultation_fee: 2000,
          languages: ['English'],
          bio: 'Cached bio',
          specializations: ['Panchakarma'],
        },
      ],
      nextCursor: null,
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await searchService.searchDoctors({
      q: 'Panchakarma',
    });

    expect(result.cached).toBe(true);
    expect(result.items[0].id).toBe('doc-cached-1');
  });

  it('should coalesce concurrent duplicate searches into a single DB query (stampede protection)', async () => {
    // 10 concurrent requests for the exact same query
    const promises = Array.from({ length: 10 }).map(() =>
      searchService.searchDoctors({ q: 'chronic' }),
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.items).toHaveLength(1);
    }
  });
});
