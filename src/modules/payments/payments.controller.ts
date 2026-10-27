import { Controller, Post, Body, Headers, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentSchema, PaymentWebhookPayloadSchema } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Idempotent } from '../../common/idempotency/idempotency.decorator';

@ApiTags('Payments')
@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  @Idempotent()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PATIENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a payment intent for held consultation (Idempotent)' })
  @ApiResponse({ status: 201, description: 'Payment intent created' })
  public async createPaymentIntent(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parseResult = CreatePaymentIntentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid payment intent payload',
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

    return this.paymentsService.createPaymentIntent(patientId, parseResult.data, idempotencyKey);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provider payment webhook with HMAC verification and replay deduplication',
  })
  @ApiResponse({ status: 200, description: 'Webhook acknowledged' })
  public async handleWebhook(@Body() body: unknown, @Headers('x-signature') signature: string) {
    if (!signature) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SIGNATURE_VERIFICATION_FAILED,
        'Missing x-signature header',
      );
    }

    const parseResult = PaymentWebhookPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Invalid webhook payload schema',
        parseResult.error.errors.map(e => ({
          name: e.path.join('.'),
          reason: e.message,
        })),
      );
    }

    const rawPayload = JSON.stringify(body);
    return this.paymentsService.handleWebhook(rawPayload, signature, parseResult.data);
  }
}
