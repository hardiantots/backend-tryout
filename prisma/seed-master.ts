import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('⏳ Menyiapkan data Master Admin...');

  const email = 'hardiantotandiseno@gmail.com';
  const plainPassword = '#D3n6b4s012';

  // 1. Hash password menggunakan argon2
  const passwordHash = await argon2.hash(plainPassword);

  // 2. Pastikan enum MASTER_ADMIN ada di tabel Role
  const roleCode = 'MASTER_ADMIN';
  const roleName = 'Master Admin';

  const role = await prisma.role.upsert({
    where: { code: roleCode },
    update: { name: roleName },
    create: {
      code: roleCode,
      name: roleName,
      description: 'Super user sistem ujian.',
    },
  });

  // 3. Upsert user (Buat baru jika belum ada, update password jika email sudah ada)
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
      fullName: 'Hardian Totandiseno',
      passwordHash,
      isEmailVerified: true,
    },
  });

  // 4. Hubungkan User dengan Role (di tabel UserRole)
  const existingUserRole = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      roleId: role.id,
      revokedAt: null,
    },
  });

  if (!existingUserRole) {
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });
    console.log(`✅ Role ${roleCode} berhasil ditambahkan ke user ${email}`);
  } else {
    console.log(`ℹ️ User ${email} sudah memiliki role ${roleCode}.`);
  }

  console.log(`✅ Master Admin berhasil disiapkan!`);
  console.log(`📧 Email: ${email}`);
  console.log(`🔑 Password: (Tersimpan aman dengan enkripsi argon2)`);
}

main()
  .catch((e) => {
    console.error('❌ Gagal menjalankan seeder Master Admin:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
