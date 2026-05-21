import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'catalogImports.json', defaultData: dataDefaults.catalogImports || [] });

export const catalogImportRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
};
