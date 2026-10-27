import { Injectable } from '@nestjs/common';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  checks?: Record<string, { status: 'up' | 'down'; latencyMs?: number; message?: string }>;
}

@Injectable()
export class HealthService {
  private isShuttingDown = false;

  setShuttingDown(val: boolean) {
    this.isShuttingDown = val;
  }

  getLiveness(): HealthCheckResult {
    if (this.isShuttingDown) {
      return {
        status: 'down',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      };
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getReadiness(): Promise<HealthCheckResult> {
    if (this.isShuttingDown) {
      return {
        status: 'down',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        checks: {
          app: { status: 'down', message: 'Application is draining/shutting down' },
        },
      };
    }

    // Basic readiness report; full DB & Redis probes will be attached via DbModule and RedisModule
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        system: { status: 'up' },
      },
    };
  }
}
