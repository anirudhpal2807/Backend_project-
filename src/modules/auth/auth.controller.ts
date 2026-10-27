import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto, MfaVerifyLoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Idempotent } from '../../common/idempotency/idempotency.decorator';
import { JwtAuthGuard, AuthenticatedUser } from './guards/jwt-auth.guard';
import { FastifyRequest } from 'fastify';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent({ scope: 'auth:register' })
  @ApiOperation({ summary: 'Register a new patient or doctor account' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique UUID to prevent duplicate user registrations',
  })
  @ApiResponse({ status: 201, description: 'Account registered successfully' })
  @ApiResponse({ status: 409, description: 'Email address already exists' })
  async register(@Body() dto: RegisterDto) {
    return await this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns tokens or MFA challenge' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(@Body() dto: LoginDto) {
    return await this.authService.login(dto);
  }

  @Post('mfa/verify-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify MFA challenge with TOTP 6-digit code or backup code' })
  @ApiResponse({ status: 200, description: 'MFA verified and tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid MFA code' })
  async verifyMfaLogin(@Body() dto: MfaVerifyLoginDto) {
    const tokens = await this.authService.verifyMfaLogin(dto);
    return { tokens };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and obtain new short-lived access token' })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Invalid or reused refresh token' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return await this.authService.rotateRefreshToken(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({ status: 204, description: 'Session ended' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @Post('mfa/enroll')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Enroll current user in TOTP MFA' })
  @ApiResponse({ status: 200, description: 'Returns TOTP secret and QR code URI' })
  async enrollMfa(@Req() req: FastifyRequest & { user: AuthenticatedUser }) {
    return await this.authService.enrollMfa(req.user.id);
  }

  @Post('revoke-all-sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all active sessions and refresh tokens for current user' })
  @ApiResponse({ status: 204, description: 'All sessions revoked' })
  async revokeAllSessions(@Req() req: FastifyRequest & { user: AuthenticatedUser }) {
    await this.authService.revokeAllSessions(req.user.id);
  }
}
