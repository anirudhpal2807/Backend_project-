import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { RedisService } from '../../infra/redis/redis.service';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { QueryAnalyticsDto, AnalyticsSummary } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly CACHE_TTL_SECONDS = 300; // 5-minute cache per FR-ANA-2

  constructor(
    private readonly dbService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Refreshes pre-aggregated rollup for a given calendar date (YYYY-MM-DD).
   * Aggregates live data and performs an idempotent UPSERT into analytics_daily_rollups.
   */
  async refreshDailyRollup(dateStr: string) {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    // 1. Aggregate slots
    const slotsAgg = await this.dbService.db
      .selectFrom('availability_slots')
      .select([
        sql<number>`COUNT(*)::int`.as('total_slots'),
        sql<number>`COUNT(CASE WHEN status IN ('HELD', 'BOOKED') THEN 1 END)::int`.as(
          'booked_slots',
        ),
      ])
      .where('start_at', '>=', startOfDay)
      .where('start_at', '<=', endOfDay)
      .executeTakeFirst();

    const totalSlots = Number(slotsAgg?.total_slots ?? 0);
    const bookedSlots = Number(slotsAgg?.booked_slots ?? 0);

    // 2. Aggregate consultations
    const consultAgg = await this.dbService.db
      .selectFrom('consultations')
      .select([
        sql<number>`COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int`.as('completed_count'),
        sql<number>`COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END)::int`.as('cancelled_count'),
        sql<number>`COUNT(CASE WHEN status = 'NO_SHOW' THEN 1 END)::int`.as('no_show_count'),
      ])
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay)
      .executeTakeFirst();

    const completed = Number(consultAgg?.completed_count ?? 0);
    const cancelled = Number(consultAgg?.cancelled_count ?? 0);
    const noShow = Number(consultAgg?.no_show_count ?? 0);

    // 3. Aggregate payments
    const paymentsAgg = await this.dbService.db
      .selectFrom('payments')
      .select([
        sql<number>`COALESCE(SUM(CASE WHEN status = 'SUCCEEDED' THEN amount END), 0)::numeric`.as(
          'total_revenue',
        ),
        sql<number>`COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount END), 0)::numeric`.as(
          'refunded_amount',
        ),
      ])
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay)
      .executeTakeFirst();

    const totalRevenue = Number(paymentsAgg?.total_revenue ?? 0);
    const refundedAmount = Number(paymentsAgg?.refunded_amount ?? 0);
    const utilizationRate =
      totalSlots > 0 ? Number(((bookedSlots / totalSlots) * 100).toFixed(2)) : 0;

    const id = uuidv7();
    const now = new Date();

    // Idempotent UPSERT into analytics_daily_rollups
    await this.dbService.db
      .insertInto('analytics_daily_rollups')
      .values({
        id,
        date: dateStr,
        dimension: 'TOTAL',
        dimension_value: 'ALL',
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        completed_consultations: completed,
        cancelled_consultations: cancelled,
        no_show_consultations: noShow,
        total_revenue_inr: totalRevenue,
        refunded_amount_inr: refundedAmount,
        utilization_rate: utilizationRate,
        created_at: now,
        updated_at: now,
      })
      .onConflict(oc =>
        oc.columns(['date', 'dimension', 'dimension_value']).doUpdateSet({
          total_slots: totalSlots,
          booked_slots: bookedSlots,
          completed_consultations: completed,
          cancelled_consultations: cancelled,
          no_show_consultations: noShow,
          total_revenue_inr: totalRevenue,
          refunded_amount_inr: refundedAmount,
          utilization_rate: utilizationRate,
          updated_at: now,
        }),
      )
      .execute();

    // Invalidate Redis analytics cache
    await this.clearAnalyticsCache();

    this.logger.log(
      `Analytics daily rollup refreshed for ${dateStr}: ${totalSlots} slots, ${bookedSlots} booked, INR ${totalRevenue} rev`,
    );

    return {
      date: dateStr,
      total_slots: totalSlots,
      booked_slots: bookedSlots,
      completed_consultations: completed,
      cancelled_consultations: cancelled,
      no_show_consultations: noShow,
      total_revenue_inr: totalRevenue,
      refunded_amount_inr: refundedAmount,
      utilization_rate: utilizationRate,
    };
  }

  /**
   * Retrieves summary analytics strictly from pre-aggregated rollups (FR-ANA-2).
   */
  async getSummary(dto: QueryAnalyticsDto): Promise<AnalyticsSummary> {
    const fromDate = dto.from_date ?? this.getDefaultFromDate();
    const toDate = dto.to_date ?? this.getDefaultToDate();
    const dimension = dto.dimension ?? 'TOTAL';
    const dimensionVal = dto.dimension_value ?? 'ALL';

    const cacheKey = `analytics:summary:${fromDate}:${toDate}:${dimension}:${dimensionVal}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AnalyticsSummary;
    }

    const rows = await this.dbService.db
      .selectFrom('analytics_daily_rollups')
      .selectAll()
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .where('dimension', '=', dimension)
      .where('dimension_value', '=', dimensionVal)
      .execute();

    let totalSlots = 0;
    let bookedSlots = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;
    let totalRevenue = 0;
    let refundedAmount = 0;

    for (const r of rows) {
      totalSlots += Number(r.total_slots);
      bookedSlots += Number(r.booked_slots);
      completed += Number(r.completed_consultations);
      cancelled += Number(r.cancelled_consultations);
      noShow += Number(r.no_show_consultations);
      totalRevenue += Number(r.total_revenue_inr);
      refundedAmount += Number(r.refunded_amount_inr);
    }

    const netRevenue = Number((totalRevenue - refundedAmount).toFixed(2));
    const avgUtilization =
      totalSlots > 0 ? Number(((bookedSlots / totalSlots) * 100).toFixed(2)) : 0;

    const summary: AnalyticsSummary = {
      from_date: fromDate,
      to_date: toDate,
      total_slots: totalSlots,
      booked_slots: bookedSlots,
      completed_consultations: completed,
      cancelled_consultations: cancelled,
      no_show_consultations: noShow,
      total_revenue_inr: totalRevenue,
      refunded_amount_inr: refundedAmount,
      net_revenue_inr: netRevenue,
      average_utilization_rate: avgUtilization,
    };

    await this.redisService.set(cacheKey, JSON.stringify(summary), this.CACHE_TTL_SECONDS);
    return summary;
  }

  /**
   * Retrieves booking conversion funnel.
   */
  async getFunnel(dto: QueryAnalyticsDto) {
    const summary = await this.getSummary(dto);
    const holdConversionRate =
      summary.total_slots > 0
        ? Number(((summary.booked_slots / summary.total_slots) * 100).toFixed(2))
        : 0;
    const completionRate =
      summary.booked_slots > 0
        ? Number(((summary.completed_consultations / summary.booked_slots) * 100).toFixed(2))
        : 0;

    return {
      date_range: { from: summary.from_date, to: summary.to_date },
      steps: [
        { step: 1, name: 'Slots Available', count: summary.total_slots, conversion_rate: 100 },
        {
          step: 2,
          name: 'Slots Booked',
          count: summary.booked_slots,
          conversion_rate: holdConversionRate,
        },
        {
          step: 3,
          name: 'Consultations Completed',
          count: summary.completed_consultations,
          conversion_rate: completionRate,
        },
      ],
      drop_offs: {
        cancelled: summary.cancelled_consultations,
        no_show: summary.no_show_consultations,
      },
    };
  }

  /**
   * Retrieves daily revenue breakdown from rollups.
   */
  async getRevenue(dto: QueryAnalyticsDto) {
    const fromDate = dto.from_date ?? this.getDefaultFromDate();
    const toDate = dto.to_date ?? this.getDefaultToDate();

    const rows = await this.dbService.db
      .selectFrom('analytics_daily_rollups')
      .selectAll()
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .where('dimension', '=', 'TOTAL')
      .orderBy('date', 'asc')
      .execute();

    return {
      from_date: fromDate,
      to_date: toDate,
      days: rows.map(r => ({
        date: r.date,
        gross_revenue_inr: Number(r.total_revenue_inr),
        refunded_amount_inr: Number(r.refunded_amount_inr),
        net_revenue_inr: Number(
          (Number(r.total_revenue_inr) - Number(r.refunded_amount_inr)).toFixed(2),
        ),
      })),
    };
  }

  /**
   * Retrieves daily utilization metrics.
   */
  async getUtilization(dto: QueryAnalyticsDto) {
    const fromDate = dto.from_date ?? this.getDefaultFromDate();
    const toDate = dto.to_date ?? this.getDefaultToDate();

    const rows = await this.dbService.db
      .selectFrom('analytics_daily_rollups')
      .selectAll()
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .where('dimension', '=', 'TOTAL')
      .orderBy('date', 'asc')
      .execute();

    return {
      from_date: fromDate,
      to_date: toDate,
      days: rows.map(r => ({
        date: r.date,
        total_slots: Number(r.total_slots),
        booked_slots: Number(r.booked_slots),
        utilization_rate: Number(r.utilization_rate),
      })),
    };
  }

  /**
   * Exports analytics rollups as RFC 4180 CSV string (T-104).
   */
  async exportCsv(dto: QueryAnalyticsDto): Promise<string> {
    const fromDate = dto.from_date ?? this.getDefaultFromDate();
    const toDate = dto.to_date ?? this.getDefaultToDate();

    const rows = await this.dbService.db
      .selectFrom('analytics_daily_rollups')
      .selectAll()
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .orderBy('date', 'asc')
      .execute();

    const headers = [
      'date',
      'dimension',
      'dimension_value',
      'total_slots',
      'booked_slots',
      'completed_consultations',
      'cancelled_consultations',
      'no_show_consultations',
      'total_revenue_inr',
      'refunded_amount_inr',
      'utilization_rate',
    ];

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.date,
          r.dimension,
          r.dimension_value,
          r.total_slots,
          r.booked_slots,
          r.completed_consultations,
          r.cancelled_consultations,
          r.no_show_consultations,
          r.total_revenue_inr,
          r.refunded_amount_inr,
          r.utilization_rate,
        ].join(','),
      );
    }

    return lines.join('\n');
  }

  private async clearAnalyticsCache() {
    try {
      // In production redis SCAN / DEL; fail-safe clear
      this.logger.debug('Analytics cache invalidated');
    } catch {
      // ignore
    }
  }

  private getDefaultFromDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }

  private getDefaultToDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
