import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';
import { FastifyReply, FastifyRequest } from 'fastify';
import { RequestContext } from '../context/request-context';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();

    const incomingHeader = req.headers['x-request-id'];
    const requestId =
      typeof incomingHeader === 'string' && incomingHeader.length > 0 ? incomingHeader : uuidv7();

    res.header('X-Request-Id', requestId);

    // Guards (JwtAuthGuard) run BEFORE interceptors, so req.user is already populated here.
    // Carry the authenticated actor into the AsyncLocalStorage store, otherwise
    // RequestContext.getUserId()/getRole() return undefined in controllers.
    const user = (req as FastifyRequest & { user?: { id: string; role: string } }).user;

    const store = {
      requestId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorId: user?.id,
      actorRole: user?.role,
    };

    return new Observable(subscriber => {
      RequestContext.run(store, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
