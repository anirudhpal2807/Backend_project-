import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Root')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Platform status and API discovery endpoint' })
  getRoot() {
    return {
      name: 'Amrutam Telemedicine Platform API',
      version: '1.0.0',
      status: 'online',
      message: 'Welcome to Amrutam Telemedicine Platform backend',
      documentation: 'http://localhost:3000/docs',
      health: 'http://localhost:3000/api/v1/health/ready',
      metrics: 'http://localhost:3000/api/v1/metrics',
      timestamp: new Date().toISOString(),
    };
  }
}

