import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const deviceRepository = createFileRepository({ fileName: 'eslDevices.json', defaultData: dataDefaults.eslDevices });
const historyRepository = createFileRepository({
  fileName: 'eslHistory.json',
  defaultData: dataDefaults.eslHistory,
  recoverOnReadError: true,
});

export const eslDeviceRepo = {
  getAll: deviceRepository.getAll,
  findById: deviceRepository.findById,
  create: deviceRepository.create,
  updateById: deviceRepository.updateById,
  deleteById: deviceRepository.deleteById,
  replaceAll: deviceRepository.writeData,
  async findByMac(mac) {
    return deviceRepository.findOne((d) => d.macAddress === mac);
  },
};

export const eslHistoryRepo = {
  getAll: historyRepository.getAll,
  findById: historyRepository.findById,
  create: historyRepository.create,
  clearAll: () => historyRepository.writeData([]),
};
