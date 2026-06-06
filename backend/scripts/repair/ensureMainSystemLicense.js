import { disconnectPrisma } from '../../src/providers/postgresProvider.js';
import {
  ensureMainSystemLicense,
  getMainSystemLicenseKey,
} from '../../src/services/mainSystemLicenseService.js';
import { maskLicenseKey } from '../../src/utils/licenseKey.js';

const run = async () => {
  const licenseKey = getMainSystemLicenseKey();
  await ensureMainSystemLicense({ licenseKey });
  console.log(`Main system license ensured: ${maskLicenseKey(licenseKey)}`);
};

run()
  .catch((error) => {
    console.error('Main system license ensure failed:', error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
