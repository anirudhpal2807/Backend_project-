import { IsNotEmpty, Length } from 'class-validator';

export class MfaEnrollVerifyDto {
  @IsNotEmpty({ message: 'code is required' })
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  code!: string;
}
