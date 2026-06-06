import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'supplierProducts.json', defaultData: dataDefaults.supplierProducts });

export const supplierProductRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
};
