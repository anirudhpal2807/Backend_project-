import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  getLiveness(@Res() res: FastifyReply) {
    const health = this.healthService.getLiveness();
    const statusCode = health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(statusCode).send(health);
  }

  @Get('ready')
  async getReadiness(@Res() res: FastifyReply) {
    const health = await this.healthService.getReadiness();
    const statusCode = health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(statusCode).send(health);
  }
}
