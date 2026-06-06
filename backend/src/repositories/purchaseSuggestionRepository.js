import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';
import { createPostgresRepository } from './postgresRepository.js';

const repository = createFileRepository({ fileName: 'purchaseSuggestions.json', defaultData: dataDefaults.purchaseSuggestions });

export const createPurchaseSuggestionRepository = (client = null) => (
  createPostgresRepository({ fileName: 'purchaseSuggestions.json', defaultData: dataDefaults.purchaseSuggestions, client })
);

export const purchaseSuggestionRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
};
