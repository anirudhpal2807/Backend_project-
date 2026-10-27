import { IsEmail, IsEnum, IsNotEmpty, IsOptional, MinLength } from 'class-validator';
import { UserRole } from '../../../infra/db/database.types';

export class RegisterDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;

  @IsOptional()
  @IsEnum(['PATIENT', 'DOCTOR', 'ADMIN', 'AUDITOR'], {
    message: 'Role must be PATIENT, DOCTOR, ADMIN, or AUDITOR',
  })
  role?: UserRole;
}
