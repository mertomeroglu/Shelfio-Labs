import { userRepo } from '../repositories/userRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';

export const securityMigrationService = {
  async apply() {
    const users = await userRepo.getAll();
    for (const user of users) {
      const normalizedStoreId = String(user.storeId || 'store-main').trim() || 'store-main';
      const nextUser = {
        ...user,
        storeId: normalizedStoreId,
      };

      if (Object.prototype.hasOwnProperty.call(nextUser, 'passwordText')) {
        delete nextUser.passwordText;
      }

      await userRepo.updateById(user.id, nextUser);
    }

    const settings = await settingsRepo.getSettings();
    if (!settings.defaultStoreId) {
      await settingsRepo.updateSettings({
        ...settings,
        defaultStoreId: 'store-main',
        updatedAt: new Date().toISOString(),
      });
    }
  },
};
