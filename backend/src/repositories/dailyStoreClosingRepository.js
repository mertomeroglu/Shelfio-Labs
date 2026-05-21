import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({
  fileName: 'dailyStoreClosings.json',
  defaultData: dataDefaults.dailyStoreClosings || [],
});

export const dailyStoreClosingRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
};
