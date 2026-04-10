import { PrismaClient, ComponentType } from '@prisma/client';
import { loadSecretsFromSsm } from '../src/common/config/ssm-secrets.util';

let prisma: PrismaClient;

const subTests = [
  { code: 'PU_INDUKTIF', name: 'Penalaran Umum - Induktif', component: ComponentType.TPS, orderIndex: 1, durationSeconds: 600 },
  { code: 'PU_DEDUKTIF', name: 'Penalaran Umum - Deduktif', component: ComponentType.TPS, orderIndex: 2, durationSeconds: 600 },
  { code: 'PU_KUANTITATIF', name: 'Penalaran Umum - Kuantitatif', component: ComponentType.TPS, orderIndex: 3, durationSeconds: 600 },
  { code: 'PPU', name: 'Pengetahuan dan Pemahaman Umum', component: ComponentType.TPS, orderIndex: 4, durationSeconds: 900 },
  { code: 'PBM', name: 'Pemahaman Bacaan dan Menulis', component: ComponentType.TPS, orderIndex: 5, durationSeconds: 1500 },
  { code: 'PK', name: 'Pengetahuan Kuantitatif', component: ComponentType.TPS, orderIndex: 6, durationSeconds: 1200 },
  { code: 'LIT_ID', name: 'Literasi Bahasa Indonesia', component: ComponentType.LITERASI, orderIndex: 7, durationSeconds: 2550 },
  { code: 'LIT_EN', name: 'Literasi Bahasa Inggris', component: ComponentType.LITERASI, orderIndex: 8, durationSeconds: 1200 },
  { code: 'PM', name: 'Penalaran Matematika', component: ComponentType.LITERASI, orderIndex: 9, durationSeconds: 2550 },
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

  console.log('⏳ Memulai sinkronisasi Sub-Tes SNBT...');

  for (const item of subTests) {
    const subTest = await prisma.subTest.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        component: item.component,
        orderIndex: item.orderIndex,
        isActive: true,
      },
      create: {
        code: item.code,
        name: item.name,
        component: item.component,
        orderIndex: item.orderIndex,
      },
    });

    await prisma.sectionSchedule.upsert({
      where: { subTestId: subTest.id },
      update: {
        orderIndex: item.orderIndex,
        durationSeconds: item.durationSeconds,
        isLockedNavigation: true,
        isActive: true,
      },
      create: {
        subTestId: subTest.id,
        orderIndex: item.orderIndex,
        durationSeconds: item.durationSeconds,
        isLockedNavigation: true,
        isActive: true,
      },
    });
    
    console.log(`✅ Upserted ${item.name} (${item.durationSeconds / 60} menit)`);
  }

  const totalDuration = subTests.reduce((sum, item) => sum + item.durationSeconds, 0);
  console.log(`🎉 Proses selesai! Total durasi ujian tercatat: ${totalDuration / 60} Menit (${totalDuration} Detik).`);
}

main()
  .catch((e) => {
    console.error('❌ Gagal menjalankan sinkronisasi Sub-tes:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
