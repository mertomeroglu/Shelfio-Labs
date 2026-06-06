import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({
  fileName: 'settings.json',
  defaultData: dataDefaults.settings,
  idKey: 'companyName',
  recoverOnReadError: true,
});

const cleanSettingsDefaults = {
  ...dataDefaults.settings,
  businessName: 'Shelfio',
  companyName: 'Shelfio',
  storeName: '',
  branchCode: '',
  storeAddress: '',
  storePhone: '',
  storeEmail: '',
  taxNumber: '',
  loginActivities: [],
  auditLogs: [],
  developerLogs: [],
};

export const settingsRepo = {
  async getSettings() {
    const current = await repository.readData();
    return {
      ...cleanSettingsDefaults,
      ...current,
    };
  },
  async updateSettings(nextSettings) {
    return repository.writeData({
      ...cleanSettingsDefaults,
      ...nextSettings,
    });
  },
};
