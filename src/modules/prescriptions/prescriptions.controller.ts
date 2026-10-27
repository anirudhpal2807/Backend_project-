import { Controller, Post, Get, Param, Body, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionSchema, AmendPrescriptionSchema } from './dto/prescription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Idempotent } from '../../common/idempotency/idempotency.decorator';

@ApiTags('Prescriptions')
@Controller('api/v1/prescriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Post()
  @Idempotent()
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Issue a prescription with encrypted payload (Idempotent)' })
  @ApiResponse({ status: 201, description: 'Prescription created' })
  public async createPrescription(@Body() body: unknown) {
    const parseResult = CreatePrescriptionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid prescription payload',
        parseResult.error.errors.map(e => ({
          name: e.path.join('.'),
          reason: e.message,
        })),
      );
    }

    const doctorUserId = RequestContext.getUserId();
    if (!doctorUserId) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.prescriptionsService.createPrescription(doctorUserId, parseResult.data);
  }

  @Post(':id/amend')
  @Idempotent()
  @Roles('DOCTOR')
  @ApiOperation({
    summary: 'Amend a prescription, creating a versioned record with history retained (Idempotent)',
  })
  @ApiResponse({ status: 201, description: 'Prescription amended' })
  public async amendPrescription(@Param('id') id: string, @Body() body: unknown) {
    const parseResult = AmendPrescriptionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid prescription amendment payload',
        parseResult.error.errors.map(e => ({
          name: e.path.join('.'),
          reason: e.message,
        })),
      );
    }

    const doctorUserId = RequestContext.getUserId();
    if (!doctorUserId) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.prescriptionsService.amendPrescription(id, doctorUserId, parseResult.data);
  }

  @Get(':id')
  @Roles('PATIENT', 'DOCTOR', 'ADMIN', 'AUDITOR')
  @ApiOperation({
    summary:
      'Get prescription (Patient/Doctor get decrypted items; Admin gets audited metadata only)',
  })
  @ApiResponse({ status: 200, description: 'Prescription details' })
  public async getPrescription(@Param('id') id: string) {
    const actorId = RequestContext.getUserId();
    const actorRole = RequestContext.getRole() as 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'AUDITOR';

    if (!actorId || !actorRole) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.prescriptionsService.getPrescription(id, actorId, actorRole);
  }
}
