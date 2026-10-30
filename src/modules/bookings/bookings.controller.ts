import { Controller, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingHoldSchema, CancelBookingSchema } from './dto/booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Idempotent } from '../../common/idempotency/idempotency.decorator';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @Idempotent()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PATIENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hold an open slot for 10 minutes (Idempotent)' })
  @ApiResponse({ status: 201, description: 'Slot held successfully' })
  @ApiResponse({ status: 409, description: 'Slot already held or booked, or patient overlap' })
  public async holdSlot(@Body() body: unknown) {
    const parseResult = CreateBookingHoldSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid booking hold payload',
        parseResult.error.errors.map(e => ({
          name: e.path.join('.'),
          reason: e.message,
        })),
      );
    }

    const patientId = RequestContext.getUserId();
    if (!patientId) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.bookingsService.holdSlot(patientId, parseResult.data);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PATIENT', 'DOCTOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a booking with refund policy evaluation (Idempotent)' })
  @ApiResponse({ status: 200, description: 'Booking cancelled successfully' })
  public async cancelBooking(@Param('id') id: string, @Body() body: unknown) {
    const parseResult = CancelBookingSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid cancellation payload',
        parseResult.error.errors.map(e => ({
          name: e.path.join('.'),
          reason: e.message,
        })),
      );
    }

    const actorId = RequestContext.getUserId();
    const actorRole = RequestContext.getRole() as 'PATIENT' | 'DOCTOR' | 'ADMIN';

    if (!actorId || !actorRole) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    return this.bookingsService.cancelBooking(id, actorId, actorRole, parseResult.data);
  }
}
