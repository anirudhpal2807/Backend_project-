import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DoctorsService } from './doctors.service';
import { OnboardDoctorDto, AdminVerifyDoctorDto } from './dto/doctor.dto';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FastifyRequest } from 'fastify';

@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post('onboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit doctor onboarding information' })
  @ApiResponse({ status: 200, description: 'Onboarding submitted' })
  async onboard(
    @Req() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() dto: OnboardDoctorDto,
  ) {
    return await this.doctorsService.onboard(req.user.id, dto);
  }

  @Patch('admin/:id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin verification of doctor (VERIFIED, REJECTED, SUSPENDED)' })
  @ApiResponse({ status: 200, description: 'Doctor verification status updated' })
  async adminVerify(@Param('id') doctorId: string, @Body() dto: AdminVerifyDoctorDto) {
    return await this.doctorsService.adminVerify(doctorId, dto);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Get public profile of a verified doctor' })
  @ApiResponse({ status: 200, description: 'Doctor public profile' })
  async getPublicProfile(@Param('id') doctorId: string) {
    return await this.doctorsService.getPublicProfile(doctorId);
  }
}
