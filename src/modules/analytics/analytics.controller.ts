import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { QueryAnalyticsDto, RefreshRollupDto } from './dto/analytics.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get high-level platform KPI summary from pre-aggregated rollups' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Summary KPI metrics' })
  async getSummary(@Query() query: QueryAnalyticsDto) {
    return this.analyticsService.getSummary(query);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Get consultation booking conversion funnel' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Booking conversion funnel steps' })
  async getFunnel(@Query() query: QueryAnalyticsDto) {
    return this.analyticsService.getFunnel(query);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get daily revenue and refund metrics' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Daily revenue breakdown' })
  async getRevenue(@Query() query: QueryAnalyticsDto) {
    return this.analyticsService.getRevenue(query);
  }

  @Get('utilization')
  @ApiOperation({ summary: 'Get doctor slot utilization metrics' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Daily slot utilization breakdown' })
  async getUtilization(@Query() query: QueryAnalyticsDto) {
    return this.analyticsService.getUtilization(query);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger on-demand idempotent rollup calculation for a calendar date' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Rollup refresh result' })
  async refreshRollup(@Body() dto: RefreshRollupDto) {
    const targetDate = dto.date ?? new Date().toISOString().split('T')[0];
    return this.analyticsService.refreshDailyRollup(targetDate);
  }

  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="analytics_rollups.csv"')
  @ApiOperation({ summary: 'Export pre-aggregated analytics rollups as RFC 4180 CSV' })
  @ApiResponse({ status: HttpStatus.OK, description: 'CSV export payload' })
  async exportCsv(@Query() query: QueryAnalyticsDto) {
    return this.analyticsService.exportCsv(query);
  }
}
