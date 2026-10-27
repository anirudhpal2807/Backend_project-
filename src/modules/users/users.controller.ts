import { Body, Controller, Get, Param, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdminUpdateUserDto } from './dto/admin-user.dto';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FastifyRequest } from 'fastify';

@ApiTags('Users & Profiles')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile/me')
  @ApiOperation({ summary: 'Get current user profile (decrypted)' })
  @ApiResponse({ status: 200, description: 'Profile retrieved' })
  async getMyProfile(@Req() req: FastifyRequest & { user: AuthenticatedUser }) {
    return await this.usersService.getProfile(req.user.id);
  }

  @Put('profile/me')
  @ApiOperation({ summary: 'Update current user profile (field-level encrypted at rest)' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  async updateMyProfile(
    @Req() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() dto: UpdateProfileDto,
  ) {
    return await this.usersService.updateProfile(req.user.id, dto);
  }

  @Get('admin/list')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List all users (Admin only)' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  async adminListUsers() {
    return await this.usersService.adminListUsers();
  }

  @Patch('admin/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Activate/deactivate user or update role (Admin only)' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  async adminUpdateUser(@Param('id') targetUserId: string, @Body() dto: AdminUpdateUserDto) {
    return await this.usersService.adminUpdateUser(targetUserId, dto);
  }
}
