import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { SearchDoctorQueryDto } from './dto/search-doctor.dto';
import { encodeCursor, decodeCursor } from '../../common/pagination/cursor-pagination';
import { sql } from 'kysely';
import * as crypto from 'crypto';

export interface DoctorSearchResult {
  id: string;
  user_id: string;
  experience_years: number;
  consultation_fee: number;
  languages: string[];
  bio: string | null;
  specializations: string[];
}

@Injectable()
export class DoctorsSearchService {
  // Single-flight in-memory promise map for stampede protection
  private readonly inFlightSearches = new Map<
    string,
    Promise<{ items: DoctorSearchResult[]; nextCursor: string | null }>
  >();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Searches verified doctors with filters, availability window, and Redis cache-aside.
   */
  public async searchDoctors(dto: SearchDoctorQueryDto): Promise<{
    items: DoctorSearchResult[];
    nextCursor: string | null;
    cached: boolean;
  }> {
    const cacheKey = this.generateCacheKey(dto);

    // 1. Check Redis Cache
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return { ...parsed, cached: true };
      }
    } catch (err) {
      this.logger.warn(`Redis search cache read failed: ${(err as Error).message}`);
    }

    // 2. Single-flight stampede protection
    let flight = this.inFlightSearches.get(cacheKey);
    if (!flight) {
      flight = this.executeDatabaseSearch(dto).finally(() => {
        this.inFlightSearches.delete(cacheKey);
      });
      this.inFlightSearches.set(cacheKey, flight);
    }

    const result = await flight;

    // 3. Write to Redis with jittered TTL (60s + 0-15s random)
    const jitteredTtlSeconds = 60 + Math.floor(Math.random() * 15);
    try {
      await this.redisService.set(cacheKey, JSON.stringify(result), jitteredTtlSeconds);
    } catch (err) {
      this.logger.warn(`Redis search cache write failed: ${(err as Error).message}`);
    }

    return { ...result, cached: false };
  }

  private async executeDatabaseSearch(dto: SearchDoctorQueryDto): Promise<{
    items: DoctorSearchResult[];
    nextCursor: string | null;
  }> {
    const limit = dto.limit || 20;

    let query = this.dbService.db
      .selectFrom('doctors')
      .selectAll('doctors')
      .where('doctors.status', '=', 'VERIFIED');

    // Experience filter
    if (dto.min_experience !== undefined) {
      query = query.where('doctors.experience_years', '>=', dto.min_experience);
    }

    // Fee range filter
    if (dto.min_fee !== undefined) {
      query = query.where('doctors.consultation_fee', '>=', dto.min_fee);
    }
    if (dto.max_fee !== undefined) {
      query = query.where('doctors.consultation_fee', '<=', dto.max_fee);
    }

    // Language filter
    if (dto.language) {
      query = query.where(sql<boolean>`${dto.language} = ANY(doctors.languages)`);
    }

    // Specialization filter
    if (dto.specialization) {
      query = query.where(
        sql<boolean>`EXISTS (
          SELECT 1 FROM doctor_specializations ds 
          WHERE ds.doctor_id = doctors.id AND ds.specialization ILIKE ${'%' + dto.specialization + '%'}
        )`,
      );
    }

    // Text / Bio / Specialization search
    if (dto.q) {
      const searchTerm = `%${dto.q}%`;
      query = query.where(
        sql<boolean>`(
          doctors.bio ILIKE ${searchTerm} OR 
          EXISTS (
            SELECT 1 FROM doctor_specializations ds 
            WHERE ds.doctor_id = doctors.id AND ds.specialization ILIKE ${searchTerm}
          )
        )`,
      );
    }

    // Availability Window Filter (T-081)
    if (dto.available_from && dto.available_to) {
      const fromDate = new Date(dto.available_from);
      const toDate = new Date(dto.available_to);
      query = query.where(
        sql<boolean>`EXISTS (
          SELECT 1 FROM availability_slots av 
          WHERE av.doctor_id = doctors.id 
            AND av.status = 'OPEN' 
            AND av.start_at >= ${fromDate} 
            AND av.start_at <= ${toDate}
        )`,
      );
    }

    // Keyset cursor pagination
    if (dto.cursor) {
      const decoded = decodeCursor<{ id: string }>(dto.cursor);
      if (decoded?.id) {
        query = query.where('doctors.id', '>', decoded.id);
      }
    }

    query = query.orderBy('doctors.id', 'asc').limit(limit + 1);

    const doctors = await query.execute();
    const hasNext = doctors.length > limit;
    const itemsToReturn = hasNext ? doctors.slice(0, limit) : doctors;

    // Fetch specializations for returned doctors
    const doctorIds = itemsToReturn.map(d => d.id);
    let specializationsMap = new Map<string, string[]>();

    if (doctorIds.length > 0) {
      const specs = await this.dbService.db
        .selectFrom('doctor_specializations')
        .select(['doctor_id', 'specialization'])
        .where('doctor_id', 'in', doctorIds)
        .execute();

      specializationsMap = specs.reduce((acc, curr) => {
        const list = acc.get(curr.doctor_id) || [];
        list.push(curr.specialization);
        acc.set(curr.doctor_id, list);
        return acc;
      }, new Map<string, string[]>());
    }

    const items: DoctorSearchResult[] = itemsToReturn.map(d => ({
      id: d.id,
      user_id: d.user_id,
      experience_years: d.experience_years,
      consultation_fee: Number(d.consultation_fee),
      languages: d.languages,
      bio: d.bio,
      specializations: specializationsMap.get(d.id) || [],
    }));

    const nextCursor =
      hasNext && itemsToReturn.length > 0
        ? encodeCursor({
            id: itemsToReturn[itemsToReturn.length - 1].id,
            createdAt: itemsToReturn[itemsToReturn.length - 1].created_at,
          })
        : null;

    return { items, nextCursor };
  }

  private generateCacheKey(dto: SearchDoctorQueryDto): string {
    const raw = JSON.stringify(dto);
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
    return `doctor_search:${hash}`;
  }
}
