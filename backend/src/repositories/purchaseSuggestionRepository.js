import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'purchaseSuggestions.json', defaultData: dataDefaults.purchaseSuggestions });

export const purchaseSuggestionRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
};
