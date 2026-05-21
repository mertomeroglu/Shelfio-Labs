import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({
  fileName: 'settings.json',
  defaultData: dataDefaults.settings,
  idKey: 'companyName',
  recoverOnReadError: true,
});

export const settingsRepo = {
  async getSettings() {
    const current = await repository.readData();
    return {
      ...dataDefaults.settings,
      ...current,
    };
  },
  async updateSettings(nextSettings) {
    return repository.writeData({
      ...dataDefaults.settings,
      ...nextSettings,
    });
  },
};
