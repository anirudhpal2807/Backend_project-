import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics scraping endpoint' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Prometheus standard exposition text format',
  })
  async getMetrics(@Res() res: FastifyReply) {
    const metrics = await this.metricsService.getMetrics();
    res
      .status(HttpStatus.OK)
      .header('Content-Type', this.metricsService.getContentType())
      .send(metrics);
  }
}
