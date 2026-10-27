import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../../infra/db/database.types';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(['PATIENT', 'DOCTOR', 'ADMIN', 'AUDITOR'])
  role?: UserRole;
}
