import { Injectable, HttpStatus } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../../infra/config/config.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly keyId = 'v1';

  constructor(private readonly configService: AppConfigService) {
    this.secret = this.configService.get('JWT_SECRET');
  }

  signAccessToken(payload: { sub: string; email: string; role: string }): string {
    return jwt.sign(payload, this.secret, {
      expiresIn: '15m',
      algorithm: 'HS256',
      keyid: this.keyId,
    });
  }

  signMfaToken(payload: { sub: string; email: string; role: string }): string {
    return jwt.sign({ ...payload, isMfaPending: true }, this.secret, {
      expiresIn: '5m',
      algorithm: 'HS256',
      keyid: this.keyId,
    });
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.secret) as JwtPayload;
    } catch {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'MFA session or token is invalid or has expired (5 minute TTL). Please login again to get a fresh challenge.',
      );
    }
  }
}
