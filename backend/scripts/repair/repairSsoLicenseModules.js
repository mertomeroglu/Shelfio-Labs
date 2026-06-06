import 'dotenv/config';
import { disconnectPrisma, getPrisma } from '../../src/providers/postgresProvider.js';
import { normalizePlanModules } from '../../src/services/ssoProvisioningService.js';

const main = async () => {
  const prisma = await getPrisma();

  console.log('SSO lisans modülleri veri onarım betiği başlatılıyor...');
  
  // getshelfio SSO ile senkronize olan tüm lisans kayıtlarını getir
  const licenses = await prisma.license.findMany({
    where: {
      externalLicenseId: { not: null },
    },
  });

  console.log(`Toplam ${licenses.length} adet SSO lisans kaydı bulundu. Analiz ediliyor...`);

  let updatedCount = 0;
  for (const license of licenses) {
    const planCode = license.planCode || license.externalPlan || 'starter';
    const oldModules = Array.isArray(license.enabledModules) ? license.enabledModules : [];
    
    // Modülleri plan bazlı normalize et
    const normalizedModules = normalizePlanModules(planCode, oldModules);

    // Old modules ve normalized modules karşılaştırması
    const oldModulesSet = new Set(oldModules);
    const newModulesSet = new Set(normalizedModules);

    let hasChange = oldModulesSet.size !== newModulesSet.size;
    if (!hasChange) {
      for (const mod of normalizedModules) {
        if (!oldModulesSet.has(mod)) {
          hasChange = true;
          break;
        }
      }
    }

    if (hasChange) {
      console.log(`GÜNCELLENİYOR -> Lisans ID: ${license.id}, Plan: ${planCode}, Sahibi: ${license.licenseOwnerEmail}`);
      console.log(`  Eski Modüller: [${oldModules.join(', ')}]`);
      console.log(`  Yeni Modüller:  [${normalizedModules.join(', ')}]`);

      await prisma.license.update({
        where: { id: license.id },
        data: {
          enabledModules: normalizedModules,
          updatedAt: new Date(),
        },
      });
      updatedCount++;
    } else {
      console.log(`GEÇİLİYOR -> Lisans ID: ${license.id} zaten güncel.`);
    }
  }

  console.log(`\nVeri onarım işlemi tamamlandı.`);
  console.log(`Başarıyla güncellenen lisans sayısı: ${updatedCount}`);
};

main()
  .catch((error) => {
    console.error('Veri onarım sırasında hata oluştu:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
