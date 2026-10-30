import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ConsultationsService } from './consultations.service';
import { UpdateClinicalNotesSchema, CompleteConsultationSchema } from './dto/consultation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Idempotent } from '../../common/idempotency/idempotency.decorator';

@ApiTags('Consultations')
@Controller('consultations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post(':id/start')
  @Idempotent()
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Start a consultation and provision video session (Idempotent)' })
  @ApiResponse({ status: 200, description: 'Consultation started' })
  public async startConsultation(@Param('id') id: string) {
    const doctorUserId = RequestContext.getUserId();
    if (!doctorUserId) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.consultationsService.startConsultation(id, doctorUserId);
  }

  @Patch(':id/notes')
  @Roles('DOCTOR')
  @ApiOperation({
    summary: 'Update clinical notes with optimistic locking and AES-256-GCM encryption',
  })
  @ApiResponse({ status: 200, description: 'Clinical notes saved' })
  public async updateClinicalNotes(@Param('id') id: string, @Body() body: unknown) {
    const parseResult = UpdateClinicalNotesSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid clinical notes payload',
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

    return this.consultationsService.updateClinicalNotes(id, doctorUserId, parseResult.data);
  }

  @Post(':id/complete')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Complete a consultation and tear down video session (Idempotent)' })
  @ApiResponse({ status: 200, description: 'Consultation completed' })
  public async completeConsultation(@Param('id') id: string, @Body() body: unknown) {
    const parseResult = CompleteConsultationSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid consultation completion payload',
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

    return this.consultationsService.completeConsultation(id, doctorUserId, parseResult.data);
  }

  @Get(':id')
  @Roles('PATIENT', 'DOCTOR', 'ADMIN', 'AUDITOR')
  @ApiOperation({ summary: 'Get consultation details with role-based clinical notes access' })
  @ApiResponse({ status: 200, description: 'Consultation details' })
  public async getConsultation(@Param('id') id: string) {
    const actorId = RequestContext.getUserId();
    const actorRole = RequestContext.getRole() as 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'AUDITOR';

    if (!actorId || !actorRole) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.consultationsService.getConsultation(id, actorId, actorRole);
  }
}
