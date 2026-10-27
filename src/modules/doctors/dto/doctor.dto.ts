import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DoctorStatus } from '../../../infra/db/database.types';

export class OnboardDoctorDto {
  @IsNotEmpty({ message: 'licenseNumber is required' })
  @IsString()
  licenseNumber!: string;

  @IsNumber()
  @Min(0)
  experienceYears!: number;

  @IsNumber()
  @Min(0)
  consultationFee!: number;

  @IsArray()
  @IsString({ each: true })
  languages!: string[];

  @IsArray()
  @IsString({ each: true })
  specializations!: string[];

  @IsOptional()
  @IsString()
  bio?: string;
}

export class AdminVerifyDoctorDto {
  @IsEnum(['VERIFIED', 'REJECTED', 'SUSPENDED'], {
    message: 'Status must be VERIFIED, REJECTED, or SUSPENDED',
  })
  status!: DoctorStatus;
}
