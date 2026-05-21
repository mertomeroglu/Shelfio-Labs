import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'suppliers.json', defaultData: dataDefaults.suppliers });

export const supplierRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
  async findByName(name) {
    return repository.findOne((supplier) => supplier.name.toLowerCase() === name.toLowerCase());
  },
};