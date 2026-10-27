import { HealthService } from '../../src/modules/health/health.service';
import { HealthController } from '../../src/modules/health/health.controller';
import { HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

describe('Health Checks (T-015)', () => {
  let healthService: HealthService;
  let healthController: HealthController;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    healthService = new HealthService();
    healthController = new HealthController(healthService);

    mockReply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('Liveness probe', () => {
    it('returns status ok and 200 when service is healthy', () => {
      healthController.getLiveness(mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
        }),
      );
    });

    it('returns status down and 503 when service is shutting down', () => {
      healthService.setShuttingDown(true);
      healthController.getLiveness(mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'down',
        }),
      );
    });
  });

  describe('Readiness probe', () => {
    it('returns status ok and 200 during normal operation', async () => {
      await healthController.getReadiness(mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          checks: expect.objectContaining({
            system: { status: 'up' },
          }),
        }),
      );
    });

    it('returns status down and 503 when draining during shutdown', async () => {
      healthService.setShuttingDown(true);
      await healthController.getReadiness(mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'down',
        }),
      );
    });
  });
});
