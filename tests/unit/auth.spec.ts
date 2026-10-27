import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { TokenService } from '../../src/modules/auth/jwt.service';
import { AppConfigService } from '../../src/infra/config/config.service';

describe('Authentication & RBAC (T-041, T-043, T-048)', () => {
  describe('RolesGuard', () => {
    let reflector: Reflector;
    let rolesGuard: RolesGuard;

    beforeEach(() => {
      reflector = new Reflector();
      rolesGuard = new RolesGuard(reflector);
    });

    function createMockContext(userRole?: string) {
      return {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            user: userRole ? { id: 'usr-1', email: 'test@example.com', role: userRole } : undefined,
          }),
        }),
      } as unknown as ExecutionContext;
    }

    it('allows access when no roles are specified on endpoint', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext('PATIENT');

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('allows access when user role matches required role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR', 'ADMIN']);
      const context = createMockContext('DOCTOR');

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('rejects with 403 FORBIDDEN when user role does not match required role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockContext('PATIENT');

      try {
        rolesGuard.canActivate(context);
        fail('Expected 403 Forbidden exception');
      } catch (err) {
        const appEx = err as AppException;
        expect(appEx.getStatus()).toBe(403);
        expect(appEx.code).toBe(ErrorCode.FORBIDDEN);
      }
    });

    it('rejects with 401 UNAUTHORIZED when unauthenticated request reaches protected endpoint', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PATIENT']);
      const context = createMockContext(undefined);

      try {
        rolesGuard.canActivate(context);
        fail('Expected 401 Unauthorized exception');
      } catch (err) {
        const appEx = err as AppException;
        expect(appEx.getStatus()).toBe(401);
        expect(appEx.code).toBe(ErrorCode.UNAUTHORIZED);
      }
    });
  });

  describe('TokenService', () => {
    let tokenService: TokenService;

    beforeEach(() => {
      const mockConfig = {
        get: () => 'dev-jwt-secret-at-least-32-chars-long-example',
      } as unknown as AppConfigService;
      tokenService = new TokenService(mockConfig);
    });

    it('generates valid short-lived access token and verifies payload', () => {
      const token = tokenService.signAccessToken({
        sub: 'user-123',
        email: 'doctor@amrutam.global',
        role: 'DOCTOR',
      });

      const payload = tokenService.verifyToken(token);
      expect(payload.sub).toBe('user-123');
      expect(payload.email).toBe('doctor@amrutam.global');
      expect(payload.role).toBe('DOCTOR');
    });
  });
});
