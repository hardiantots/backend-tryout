import { PrismaClient, UserRoleCode, PermissionCode } from '@prisma/client';
import { loadSecretsFromSsm } from '../src/common/config/ssm-secrets.util';

let prisma: PrismaClient;

const roleDefinitions = [
  { code: UserRoleCode.MASTER_ADMIN, name: 'Master Admin', description: 'Can manage roles, permissions, and all operational features.' },
  { code: UserRoleCode.ADMIN, name: 'Admin', description: 'Operational user with scoped content permissions (input and edit questions).' },
  { code: UserRoleCode.PARTICIPANT, name: 'Participant', description: 'Exam participant role.' },
];

const permissionDefinitions = [
  PermissionCode.QUESTION_CREATE,
  PermissionCode.QUESTION_UPDATE,
  PermissionCode.QUESTION_DELETE,
  PermissionCode.QUESTION_VIEW_DRAFT,
  PermissionCode.QUESTION_PUBLISH,
  PermissionCode.QUESTION_REVIEW,
  PermissionCode.SUBTEST_VIEW,
  PermissionCode.EXAM_RESULT_VIEW,
  PermissionCode.EXAM_RESULT_EXPORT,
  PermissionCode.USER_VIEW,
  PermissionCode.USER_SUSPEND,
  PermissionCode.ADMIN_ROLE_ASSIGN,
  PermissionCode.ADMIN_ROLE_REVOKE,
  PermissionCode.ADMIN_PERMISSION_GRANT,
  PermissionCode.ADMIN_PERMISSION_REVOKE,
  PermissionCode.AUDIT_LOG_VIEW,
];

// Master Admin owns all. Admin only owns these:
const adminDefaultPermissions: PermissionCode[] = [
  PermissionCode.SUBTEST_VIEW,
  PermissionCode.QUESTION_VIEW_DRAFT,
  PermissionCode.QUESTION_CREATE,
  PermissionCode.QUESTION_UPDATE,
];

async function main() {
  console.log('⏳ Memuat konfigurasi SSM/Env...');
  
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
    if (!process.env.DATABASE_URL) {
      process.env.NODE_ENV = 'production';
    }
  }

  await loadSecretsFromSsm();
  prisma = new PrismaClient();

  console.log('⏳ Memastikan definisi Permission dan Hubungan Role...');

  // 1. Ensure Roles exist
  for (const role of roleDefinitions) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }
  console.log('✅ Roles tersinkronisasi.');

  // 2. Ensure all PermissionCodes exist
  for (const code of permissionDefinitions) {
    await prisma.permission.upsert({
      where: { code },
      update: {
        name: code,
        description: `Permission ${code}`,
      },
      create: {
        code,
        name: code,
        description: `Permission ${code}`,
      },
    });
  }
  console.log('✅ Daftar Permissions tesinkronisasi.');

  const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.MASTER_ADMIN } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.ADMIN } });
  const allPermissions = await prisma.permission.findMany({});

  // 3. Grant EVERY permission to Master Admin
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: masterRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: masterRole.id,
        permissionId: permission.id,
      },
    });
  }
  console.log('✅ Master Admin Permission terpasang secara komperhensif (ALL ACCESS).');

  // 4. Grant explicitly limited permissions to Admin (Input/Edit only)
  const adminPermissions = allPermissions.filter((p) => adminDefaultPermissions.includes(p.code as PermissionCode));
  for (const permission of adminPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }
  console.log('✅ Admin Permission terpasang (Hanya Read, Create, dan Update).');
  console.log('🎉 Role dan Akses berhasil diamankan! Participant tidak memiliki role permission admin dan hanya digerakkan via Token.');
}

main()
  .catch((e) => {
    console.error('❌ Gagal menjalankan sinkronisasi Permission:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
