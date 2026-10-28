import { IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryAnalyticsDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)', example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from_date?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)', example: '2026-10-28' })
  @IsOptional()
  @IsDateString()
  to_date?: string;

  @ApiPropertyOptional({
    description: 'Dimension type (e.g. TOTAL, SPECIALIZATION)',
    default: 'TOTAL',
  })
  @IsOptional()
  @IsString()
  dimension?: string = 'TOTAL';

  @ApiPropertyOptional({ description: 'Dimension value (e.g. ALL, Ayurveda)', default: 'ALL' })
  @IsOptional()
  @IsString()
  dimension_value?: string = 'ALL';
}

export class RefreshRollupDto {
  @ApiPropertyOptional({ description: 'Date to refresh (YYYY-MM-DD)', example: '2026-10-27' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export interface AnalyticsSummary {
  from_date: string;
  to_date: string;
  total_slots: number;
  booked_slots: number;
  completed_consultations: number;
  cancelled_consultations: number;
  no_show_consultations: number;
  total_revenue_inr: number;
  refunded_amount_inr: number;
  net_revenue_inr: number;
  average_utilization_rate: number;
}
