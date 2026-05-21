import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'accessRequests.json', defaultData: [] });

export const accessRequestRepo = {
  ...baseRepo,
  async findPendingByUserPermission(userId, permission, storeId) {
    const all = await baseRepo.getAll();
    return all.find((item) => (
      item.userId === userId
      && item.permission === permission
      && item.storeId === storeId
      && item.status === 'pending'
    )) || null;
  },
};
