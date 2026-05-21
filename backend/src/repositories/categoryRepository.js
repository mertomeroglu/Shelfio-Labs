import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'categories.json', defaultData: dataDefaults.categories });

export const categoryRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
  async findByName(name) {
    return repository.findOne((category) => category.name.toLowerCase() === name.toLowerCase());
  },
  async findByCode(code) {
    return repository.findOne((category) => String(category.code || '').toLowerCase() === String(code || '').toLowerCase());
  },
  async findBySlug(slug) {
    return repository.findOne((category) => String(category.slug || '').toLowerCase() === String(slug || '').toLowerCase());
  },
};