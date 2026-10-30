import * as argon2 from 'argon2';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { v7 as uuidv7 } from 'uuid';

dotenv.config();

async function runSeed() {
  const dbUrl = process.env.DATABASE_URL;
  const isNeon = dbUrl?.includes('neon.tech') || dbUrl?.includes('sslmode=require');
  const pool = dbUrl
    ? new Pool({
        connectionString: dbUrl,
        ssl: isNeon || process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'amrutam_telemed',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgrespassword',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });

  const client = await pool.connect();

  try {
    process.stdout.write('[Seed] Starting database seed with demo data...\n');
    await client.query('BEGIN');

    // Default password for all demo accounts: "AmrutamSecurePass2026!"
    const defaultPasswordHash = await argon2.hash('AmrutamSecurePass2026!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    // 1. Admin User
    const adminId = uuidv7();
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      [adminId, 'admin@amrutam.global', defaultPasswordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       SELECT id, 'ADMIN'::user_role_enum FROM users WHERE email = 'admin@amrutam.global'
       ON CONFLICT (user_id, role) DO NOTHING`,
    );

    // 2. Doctor User (Verified Ayurvedic Specialist)
    const doctorUserId = uuidv7();
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      [doctorUserId, 'dr.sharma@amrutam.global', defaultPasswordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       SELECT id, 'DOCTOR'::user_role_enum FROM users WHERE email = 'dr.sharma@amrutam.global'
       ON CONFLICT (user_id, role) DO NOTHING`,
    );

    const docUserRes = await client.query(
      `SELECT id FROM users WHERE email = 'dr.sharma@amrutam.global'`,
    );
    const verifiedDoctorUserId = docUserRes.rows[0]?.id;

    if (verifiedDoctorUserId) {
      const doctorId = uuidv7();
      await client.query(
        `INSERT INTO doctors (id, user_id, license_number, experience_years, consultation_fee, status, languages, bio)
         VALUES ($1, $2, 'AYUR-IN-2024-9872', 12, 500.00, 'VERIFIED', ARRAY['English', 'Hindi', 'Sanskrit'], 'Senior Ayurvedic Vaidya specializing in Panchakarma and lifestyle disorders.')
         ON CONFLICT (user_id) DO UPDATE 
         SET status = 'VERIFIED',
             experience_years = 12,
             consultation_fee = 500.00,
             languages = ARRAY['English', 'Hindi', 'Sanskrit'],
             bio = 'Senior Ayurvedic Vaidya specializing in Panchakarma and lifestyle disorders.'`,
        [doctorId, verifiedDoctorUserId],
      );

      const docRes = await client.query(`SELECT id FROM doctors WHERE user_id = $1`, [
        verifiedDoctorUserId,
      ]);
      const actualDoctorId = docRes.rows[0]?.id;

      if (actualDoctorId) {
        // Specializations
        await client.query(
          `INSERT INTO doctor_specializations (doctor_id, specialization)
           VALUES ($1, 'Ayurveda'), ($1, 'Panchakarma'), ($1, 'Digestive Health')
           ON CONFLICT DO NOTHING`,
          [actualDoctorId],
        );

        // Generate availability slots for the next 7 days (9am, 10am, 11am daily)
        const now = new Date();
        for (let day = 1; day <= 7; day++) {
          const slotDate = new Date(now);
          slotDate.setDate(now.getDate() + day);

          for (const hour of [9, 10, 11, 14, 15]) {
            const startAt = new Date(slotDate);
            startAt.setHours(hour, 0, 0, 0);
            const endAt = new Date(startAt);
            endAt.setMinutes(startAt.getMinutes() + 30);

            await client.query(
              `INSERT INTO availability_slots (id, doctor_id, start_at, end_at, status)
               VALUES ($1, $2, $3, $4, 'OPEN')
               ON CONFLICT DO NOTHING`,
              [uuidv7(), actualDoctorId, startAt.toISOString(), endAt.toISOString()],
            );
          }
        }
      }
    }

    // 3. Patient User
    const patientUserId = uuidv7();
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      [patientUserId, 'patient.demo@example.com', defaultPasswordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       SELECT id, 'PATIENT'::user_role_enum FROM users WHERE email = 'patient.demo@example.com'
       ON CONFLICT (user_id, role) DO NOTHING`,
    );

    // 4. Auditor User
    const auditorUserId = uuidv7();
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      [auditorUserId, 'compliance.auditor@amrutam.global', defaultPasswordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       SELECT id, 'AUDITOR'::user_role_enum FROM users WHERE email = 'compliance.auditor@amrutam.global'
       ON CONFLICT (user_id, role) DO NOTHING`,
    );

    await client.query('COMMIT');
    process.stdout.write(
      '[Seed] Database successfully seeded with demo accounts and verified doctor slots!\n',
    );
    process.stdout.write(`
Demo Credentials:
- Admin:    admin@amrutam.global / AmrutamSecurePass2026!
- Doctor:   dr.sharma@amrutam.global / AmrutamSecurePass2026!
- Patient:  patient.demo@example.com / AmrutamSecurePass2026!
- Auditor:  compliance.auditor@amrutam.global / AmrutamSecurePass2026!
\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    process.stderr.write(`[Seed Error] Seed failed: ${(err as Error).message}\n`);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runSeed().catch(() => process.exit(1));
}

export { runSeed };
