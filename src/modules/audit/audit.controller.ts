import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './dto/audit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/context/request-context';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Roles('ADMIN', 'AUDITOR')
  @ApiOperation({
    summary: 'Query immutable audit logs with keyset pagination (Auditor/Admin only)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated audit trail entries',
  })
  async listLogs(@Query() query: QueryAuditLogsDto) {
    return this.auditService.listLogs(query);
  }

  @Post('verify-chain')
  @Roles('ADMIN', 'AUDITOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify cryptographic hash chain integrity of audit logs',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cryptographic hash-chain integrity verification result',
  })
  async verifyChain(@Query('from_date') fromDate?: string, @Query('to_date') toDate?: string) {
    return this.auditService.verifyChain({
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }

  @Get('export')
  @Roles('ADMIN', 'AUDITOR')
  @ApiOperation({
    summary: 'Export audit logs with SHA-256 integrity checksum',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs export payload with verification checksum',
  })
  async exportLogs(@Query() query: QueryAuditLogsDto) {
    return this.auditService.exportLogs(query);
  }

  @Post('anonymize/:userId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute user GDPR/HIPAA anonymization/erasure request (Admin only)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User profile anonymized with immutable audit trail recorded',
  })
  async anonymizeUser(@Param('userId') userId: string) {
    const actorId = RequestContext.getActorId() ?? 'system';
    return this.auditService.anonymizeUser(userId, actorId);
  }
}
