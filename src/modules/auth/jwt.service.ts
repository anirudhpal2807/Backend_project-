import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../../infra/config/config.service';

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
    return jwt.verify(token, this.secret) as JwtPayload;
  }
}
