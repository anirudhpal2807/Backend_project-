import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface InvalidParam {
  name: string;
  reason: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode | string;
  instance?: string;
  invalidParams?: InvalidParam[];
  retryAfterSeconds?: number;
}

export class AppException extends HttpException {
  readonly code: ErrorCode | string;
  readonly invalidParams?: InvalidParam[];
  readonly retryAfterSeconds?: number;

  constructor(
    status: HttpStatus,
    code: ErrorCode | string,
    detail: string,
    invalidParams?: InvalidParam[],
    retryAfterSeconds?: number,
  ) {
    const responseBody: ProblemDetails = {
      type: `https://api.amrutam.global/errors/${code.toLowerCase()}`,
      title: code.replace(/_/g, ' '),
      status,
      detail,
      code,
      invalidParams,
      retryAfterSeconds,
    };
    super(responseBody, status);
    this.message = detail;
    this.code = code;
    this.invalidParams = invalidParams;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
