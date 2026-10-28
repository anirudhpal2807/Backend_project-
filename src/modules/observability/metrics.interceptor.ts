import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest();
    const res = httpCtx.getResponse();

    const method = req.method;
    const route =
      req.routeOptions?.url || req.raw?.url?.split('?')[0] || req.url?.split('?')[0] || 'unknown';

    // Exclude /metrics and /health from request duration histograms to avoid skewing
    if (route.includes('/metrics') || route.includes('/health')) {
      return next.handle();
    }

    const startTimer = process.hrtime();

    return next.handle().pipe(
      tap({
        next: () => {
          const diff = process.hrtime(startTimer);
          const durationSeconds = diff[0] + diff[1] / 1e9;
          const statusCode = String(res.statusCode || 200);

          this.metricsService.httpRequestsTotal.inc({ method, route, status_code: statusCode });
          this.metricsService.httpRequestDuration.observe(
            { method, route, status_code: statusCode },
            durationSeconds,
          );
        },
        error: error => {
          const diff = process.hrtime(startTimer);
          const durationSeconds = diff[0] + diff[1] / 1e9;
          const statusCode = String(error?.status || 500);

          this.metricsService.httpRequestsTotal.inc({ method, route, status_code: statusCode });
          this.metricsService.httpRequestDuration.observe(
            { method, route, status_code: statusCode },
            durationSeconds,
          );
        },
      }),
    );
  }
}
