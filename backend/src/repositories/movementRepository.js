import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'movements.json', defaultData: dataDefaults.movements });

export const movementRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  updateById: repository.updateById,
  create: repository.create,
};