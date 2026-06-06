import { disconnectPrisma, getPrisma } from '../../src/providers/postgresProvider.js';
import { buildLicenseSummaryFromDbLicense, sanitizeLicenseSummary } from '../../src/services/licenseSummaryService.js';
import { normalizePlanCode, normalizePlanModules, PLAN_PAGES } from '../../src/services/ssoProvisioningService.js';

const shouldApply = process.argv.includes('--apply');
const safeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const run = async () => {
  const prisma = await getPrisma();
  const licenses = await prisma.license.findMany({
    where: { externalLicenseId: { not: null } },
    include: { plan: true },
  });

  let changed = 0;
  for (const license of licenses) {
    const planCode = normalizePlanCode(license.planCode || license.externalPlan || license.plan?.code);
    const screenAccess = PLAN_PAGES[planCode] || PLAN_PAGES.starter;
    const enabledModules = normalizePlanModules(planCode, [], screenAccess);
    const payload = safeObject(license.payload);
    const licenseSummary = sanitizeLicenseSummary({
      ...buildLicenseSummaryFromDbLicense(license),
      planSlug: planCode,
      isDemo: planCode === 'demo',
      enabledModules,
      screenAccess,
    });
    const data = {
      planCode,
      externalPlan: planCode,
      enabledModules,
      payload: {
        ...payload,
        screenAccess,
        licenseSummary,
      },
    };
    const isChanged = JSON.stringify({
      planCode: license.planCode,
      externalPlan: license.externalPlan,
      enabledModules: license.enabledModules,
      screenAccess: payload.screenAccess,
      licenseSummary: payload.licenseSummary,
    }) !== JSON.stringify({
      planCode: data.planCode,
      externalPlan: data.externalPlan,
      enabledModules: data.enabledModules,
      screenAccess: data.payload.screenAccess,
      licenseSummary: data.payload.licenseSummary,
    });

    if (!isChanged) continue;
    changed += 1;
    console.log(`${shouldApply ? 'APPLY' : 'DRY-RUN'} license=${license.id} plan=${planCode}`);
    if (shouldApply) {
      await prisma.license.update({ where: { id: license.id }, data });
    }
  }

  console.log(`${shouldApply ? 'Applied' : 'Would update'} ${changed} of ${licenses.length} external licenses.`);
};

run()
  .catch((error) => {
    console.error('License access matrix repair failed:', error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
