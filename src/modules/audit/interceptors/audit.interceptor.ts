import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AUDIT_METADATA_KEY, AuditOptions } from '../decorators/audited.decorator';
import { RequestContext } from '../../../common/context/request-context';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions>(AUDIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!auditOptions) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const ctx = RequestContext.get();
    const actorId = ctx?.actorId ?? req.user?.id ?? null;
    const actorRole = ctx?.actorRole ?? req.user?.role ?? 'ANONYMOUS';

    return next.handle().pipe(
      tap(async responseBody => {
        try {
          const resourceId = auditOptions.getResourceId
            ? auditOptions.getResourceId(req, responseBody)
            : (req.params?.id ?? (responseBody as { id?: string })?.id ?? 'global');

          await this.auditService.record({
            actorId,
            actorRole,
            action: auditOptions.action,
            resourceType: auditOptions.resourceType,
            resourceId: String(resourceId),
            outcome: 'SUCCESS',
            metadata: {
              method: req.method,
              url: req.url,
            },
            ipAddress: ctx?.ipAddress ?? req.ip,
            userAgent: ctx?.userAgent ?? req.headers?.['user-agent'],
            requestId: ctx?.requestId,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`AuditInterceptor record failure: ${msg}`);
        }
      }),
      catchError(async (error: unknown) => {
        try {
          const errObj = error as { code?: string; message?: string };
          const resourceId = req.params?.id ?? 'error';
          await this.auditService.record({
            actorId,
            actorRole,
            action: auditOptions.action,
            resourceType: auditOptions.resourceType,
            resourceId: String(resourceId),
            outcome: 'FAILURE',
            metadata: {
              error_code: errObj?.code,
              error_message: errObj?.message,
              method: req.method,
              url: req.url,
            },
            ipAddress: ctx?.ipAddress ?? req.ip,
            userAgent: ctx?.userAgent ?? req.headers?.['user-agent'],
            requestId: ctx?.requestId,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`AuditInterceptor error record failure: ${msg}`);
        }
        throw error;
      }),
    );
  }
}
