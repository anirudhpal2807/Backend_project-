import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { OnboardDoctorDto, AdminVerifyDoctorDto } from './dto/doctor.dto';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class DoctorsService {
  constructor(private readonly dbService: DatabaseService) {}

  async onboard(userId: string, dto: OnboardDoctorDto) {
    const existing = await this.dbService.db
      .selectFrom('doctors')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

    const doctorId = existing?.id || uuidv7();

    await this.dbService.db.transaction().execute(async trx => {
      if (existing) {
        await trx
          .updateTable('doctors')
          .set({
            license_number: dto.licenseNumber,
            experience_years: dto.experienceYears,
            consultation_fee: dto.consultationFee,
            languages: dto.languages,
            bio: dto.bio || null,
            updated_at: new Date(),
          })
          .where('id', '=', doctorId)
          .execute();
      } else {
        await trx
          .insertInto('doctors')
          .values({
            id: doctorId,
            user_id: userId,
            license_number: dto.licenseNumber,
            experience_years: dto.experienceYears,
            consultation_fee: dto.consultationFee,
            status: 'PENDING',
            languages: dto.languages,
            bio: dto.bio || null,
          })
          .execute();
      }

      // Re-insert specializations
      await trx.deleteFrom('doctor_specializations').where('doctor_id', '=', doctorId).execute();

      for (const spec of dto.specializations) {
        await trx
          .insertInto('doctor_specializations')
          .values({
            id: uuidv7(),
            doctor_id: doctorId,
            specialization: spec,
          })
          .execute();
      }
    });

    return {
      message: 'Doctor onboarding submitted. Pending admin verification.',
      doctorId,
    };
  }

  async adminVerify(doctorId: string, dto: AdminVerifyDoctorDto) {
    const doctor = await this.dbService.db
      .selectFrom('doctors')
      .selectAll()
      .where('id', '=', doctorId)
      .executeTakeFirst();

    if (!doctor) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor not found.');
    }

    await this.dbService.db
      .updateTable('doctors')
      .set({
        status: dto.status,
        updated_at: new Date(),
      })
      .where('id', '=', doctorId)
      .execute();

    return {
      message: `Doctor status updated to ${dto.status}.`,
      doctorId,
      status: dto.status,
    };
  }

  async getPublicProfile(doctorId: string) {
    const doctor = await this.dbService.db
      .selectFrom('doctors')
      .innerJoin('users', 'users.id', 'doctors.user_id')
      .select([
        'doctors.id',
        'doctors.experience_years',
        'doctors.consultation_fee',
        'doctors.status',
        'doctors.languages',
        'doctors.bio',
        'users.email',
      ])
      .where('doctors.id', '=', doctorId)
      .where('doctors.status', '=', 'VERIFIED')
      .executeTakeFirst();

    if (!doctor) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Verified doctor profile not found.',
      );
    }

    const specializations = await this.dbService.db
      .selectFrom('doctor_specializations')
      .select(['specialization'])
      .where('doctor_id', '=', doctorId)
      .execute();

    return {
      id: doctor.id,
      experienceYears: doctor.experience_years,
      consultationFee: doctor.consultation_fee,
      languages: doctor.languages,
      bio: doctor.bio,
      specializations: specializations.map(s => s.specialization),
    };
  }
}
