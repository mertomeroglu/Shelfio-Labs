import { createFileRepository } from './fileRepository.js';

export const customerOrderRepo = createFileRepository({
  fileName: 'customerOrders.json',
  defaultData: [],
});
