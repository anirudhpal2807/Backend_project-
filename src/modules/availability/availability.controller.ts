import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityRuleDto } from './dto/availability.dto';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FastifyRequest } from 'fastify';

@ApiTags('Doctor Availability & Slots')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Post('rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create recurring weekly availability rule' })
  @ApiResponse({ status: 201, description: 'Rule created and 30-day slots materialized' })
  async createRule(
    @Req() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() dto: CreateAvailabilityRuleDto,
  ) {
    // In production, maps req.user.id to doctor_id
    return await this.availabilityService.createRule(req.user.id, dto);
  }

  @Get('doctors/:doctorId/slots')
  @ApiOperation({ summary: 'List public open availability slots for a doctor' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({ status: 200, description: 'List of OPEN slots' })
  async listDoctorSlots(
    @Param('doctorId') doctorId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this.availabilityService.listSlots(doctorId, startDate, endDate);
  }

  @Post('slots/:slotId/block')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Doctor blocks an unbooked slot' })
  @ApiResponse({ status: 200, description: 'Slot marked BLOCKED' })
  @ApiResponse({ status: 409, description: 'Conflict - slot has active booking' })
  async blockSlot(
    @Req() req: FastifyRequest & { user: AuthenticatedUser },
    @Param('slotId') slotId: string,
  ) {
    return await this.availabilityService.blockSlot(req.user.id, slotId);
  }

  @Post('slots/:slotId/unblock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Doctor unblocks a previously blocked slot' })
  @ApiResponse({ status: 200, description: 'Slot reopened to OPEN' })
  async unblockSlot(
    @Req() req: FastifyRequest & { user: AuthenticatedUser },
    @Param('slotId') slotId: string,
  ) {
    return await this.availabilityService.unblockSlot(req.user.id, slotId);
  }
}
