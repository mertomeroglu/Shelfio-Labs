import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'warehouseLocations.json', defaultData: dataDefaults.warehouseLocations || [] });

export const warehouseLocationRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
  readData: repository.readData,
  writeData: repository.writeData,
};
