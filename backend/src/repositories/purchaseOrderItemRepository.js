import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'purchaseOrderItems.json', defaultData: dataDefaults.purchaseOrderItems });

export const purchaseOrderItemRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
};
