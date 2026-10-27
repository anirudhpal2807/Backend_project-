import { IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'refreshToken is required' })
  refreshToken!: string;
}
