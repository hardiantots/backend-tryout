import { PrismaClient, UserRoleCode } from '@prisma/client';
import * as argon2 from 'argon2';
import { loadSecretsFromSsm } from '../src/common/config/ssm-secrets.util';

let prisma: PrismaClient;

async function main() {
  console.log('⏳ Memuat konfigurasi dari AWS SSM...');
  
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
    if (!process.env.DATABASE_URL) {
      process.env.NODE_ENV = 'production';
    }
  }

  await loadSecretsFromSsm();

  prisma = new PrismaClient();

  console.log('⏳ Memastikan role ADMIN dan PARTICIPANT tersedia...');

  const roles = [
    { code: UserRoleCode.MASTER_ADMIN, name: 'Master Admin', description: 'Super user sistem ujian.' },
    { code: UserRoleCode.ADMIN, name: 'Admin', description: 'Operational user with scoped content permissions.' },
    { code: UserRoleCode.PARTICIPANT, name: 'Participant', description: 'Exam participant role.' },
  ];

  for (const r of roles) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
      create: {
        code: r.code,
        name: r.name,
        description: r.description,
      },
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.ADMIN } });

  console.log('⏳ Menyiapkan akun Admin...');

  const admins = [
    'rendy@gmail.com',
    'yoeljerr@gmail.com',
    'ryuann@gmail.com'
  ];
  const plainPassword = 'TOEdisiApril2025';
  const passwordHash = await argon2.hash(plainPassword);

  for (const email of admins) {
    const fullName = email.split('@')[0];
    
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        isEmailVerified: true,
      },
      create: {
        email,
        fullName: fullName.charAt(0).toUpperCase() + fullName.slice(1),
        passwordHash,
        isEmailVerified: true,
      },
    });

    const existingUserRole = await prisma.userRole.findFirst({
      where: {
        userId: user.id,
        roleId: adminRole.id,
        revokedAt: null,
      },
    });

    if (!existingUserRole) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id,
        },
      });
      console.log(`✅ Role ADMIN berhasil ditambahkan ke user ${email}`);
    } else {
      console.log(`ℹ️ User ${email} sudah memiliki role ADMIN.`);
    }
  }

  console.log(`✅ Proses penambahan Roles dan Admin selesai!`);
}

main()
  .catch((e) => {
    console.error('❌ Gagal menjalankan seeder Admin:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
