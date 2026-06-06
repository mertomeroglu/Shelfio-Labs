import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';
import { getBarcodeCandidates, getProductBarcodeCandidates } from '../utils/barcode.js';

const repository = createFileRepository({ fileName: 'products.json', defaultData: dataDefaults.products });

export const productRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
  async findBySku(sku) {
    return repository.findOne((product) => product.sku.toLowerCase() === sku.toLowerCase());
  },
  async findByBarcode(barcode) {
    const candidates = new Set(getBarcodeCandidates(barcode));
    return repository.findOne((product) =>
      getProductBarcodeCandidates(product).some((candidate) => candidates.has(candidate))
    );
  },
};
