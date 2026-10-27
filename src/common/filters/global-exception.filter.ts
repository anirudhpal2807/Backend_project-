import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppException, ProblemDetails } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode | string = ErrorCode.INTERNAL_SERVER_ERROR;
    let detail = 'An unexpected internal server error occurred. Please try again later.';
    let invalidParams = undefined;
    let retryAfterSeconds: number | undefined = undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      detail = exception.message;
      invalidParams = exception.invalidParams;
      retryAfterSeconds = exception.retryAfterSeconds;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        detail = (resObj.message as string) || exception.message;
        code = (resObj.error as string) || `HTTP_${status}`;
      } else {
        detail = String(res);
        code = `HTTP_${status}`;
      }
    } else {
      // Log unhandled exceptions internally but NEVER leak stack/SQL to the client
      const err = exception as Error;
      process.stderr.write(
        `[UnhandledException] URL: ${request.url} | Error: ${err.message}\n${err.stack}\n`,
      );
    }

    if (retryAfterSeconds) {
      response.header('Retry-After', retryAfterSeconds.toString());
    }

    const problemDetails: ProblemDetails = {
      type: `https://api.amrutam.global/errors/${String(code).toLowerCase()}`,
      title: String(code).replace(/_/g, ' '),
      status,
      detail,
      code,
      instance: request.url,
      invalidParams,
      retryAfterSeconds,
    };

    response.status(status).header('Content-Type', 'application/problem+json').send(problemDetails);
  }
}
