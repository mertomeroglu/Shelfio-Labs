import { createFileRepository } from './fileRepository.js';

export const customerRepo = createFileRepository({
  fileName: 'customers.json',
  defaultData: [],
});
