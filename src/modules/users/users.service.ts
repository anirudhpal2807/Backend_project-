import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdminUpdateUserDto } from './dto/admin-user.dto';

export interface DecryptedProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
  gender: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly cryptoService: CryptoService,
  ) {}

  async getProfile(userId: string): Promise<DecryptedProfile> {
    const profile = await this.dbService.db
      .selectFrom('profiles')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!profile) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Profile not found for this user.',
      );
    }

    const firstName = profile.first_name_encrypted
      ? await this.cryptoService.decryptField(profile.first_name_encrypted)
      : '';
    const lastName = profile.last_name_encrypted
      ? await this.cryptoService.decryptField(profile.last_name_encrypted)
      : '';
    const phone = profile.phone_encrypted
      ? await this.cryptoService.decryptField(profile.phone_encrypted)
      : '';
    const dob = profile.dob_encrypted
      ? await this.cryptoService.decryptField(profile.dob_encrypted)
      : '';

    return {
      id: profile.id,
      userId: profile.user_id,
      firstName,
      lastName,
      phone,
      dob,
      gender: profile.gender,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<{ message: string }> {
    const updateValues: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (dto.firstName !== undefined) {
      updateValues.first_name_encrypted = await this.cryptoService.encryptField(dto.firstName);
    }
    if (dto.lastName !== undefined) {
      updateValues.last_name_encrypted = await this.cryptoService.encryptField(dto.lastName);
    }
    if (dto.phone !== undefined) {
      updateValues.phone_encrypted = await this.cryptoService.encryptField(dto.phone);
    }
    if (dto.dob !== undefined) {
      updateValues.dob_encrypted = await this.cryptoService.encryptField(dto.dob);
    }
    if (dto.gender !== undefined) {
      updateValues.gender = dto.gender;
    }

    await this.dbService.db
      .updateTable('profiles')
      .set(updateValues)
      .where('user_id', '=', userId)
      .execute();

    return { message: 'Profile updated successfully.' };
  }

  async adminListUsers(limit = 20) {
    return await this.dbService.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .select(['users.id', 'users.email', 'users.is_active', 'users.created_at', 'user_roles.role'])
      .orderBy('users.created_at', 'desc')
      .limit(limit)
      .execute();
  }

  async adminUpdateUser(targetUserId: string, dto: AdminUpdateUserDto) {
    await this.dbService.db.transaction().execute(async trx => {
      if (dto.isActive !== undefined) {
        await trx
          .updateTable('users')
          .set({ is_active: dto.isActive, updated_at: new Date() })
          .where('id', '=', targetUserId)
          .execute();
      }

      if (dto.role !== undefined) {
        await trx
          .updateTable('user_roles')
          .set({ role: dto.role })
          .where('user_id', '=', targetUserId)
          .execute();
      }
    });

    return { message: 'User updated by admin successfully.' };
  }
}
