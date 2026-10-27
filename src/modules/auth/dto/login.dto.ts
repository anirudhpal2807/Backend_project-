import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}

export class MfaVerifyLoginDto {
  @IsNotEmpty({ message: 'mfaToken is required' })
  mfaToken!: string;

  @IsNotEmpty({ message: 'code is required' })
  code!: string;
}
