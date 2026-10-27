import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { TokenService } from '../jwt.service';
import { AppException } from '../../../common/errors/app-exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { RequestContext } from '../../../common/context/request-context';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Missing or malformed Bearer authorization token.',
      );
    }

    const token = authHeader.substring(7);

    try {
      const payload = this.tokenService.verifyToken(token);
      const user: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      request.user = user;

      // Update RequestContext store with actor information
      const store = RequestContext.get();
      if (store) {
        store.actorId = user.id;
        store.actorRole = user.role;
      }

      return true;
    } catch {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.TOKEN_EXPIRED,
        'Access token is invalid or expired.',
      );
    }
  }
}
