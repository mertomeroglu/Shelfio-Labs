import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'temporaryPermissionGrants.json', defaultData: [] });

export const temporaryPermissionGrantRepo = {
  ...baseRepo,
  async findActiveByUser(userId) {
    const all = await baseRepo.getAll();
    const now = Date.now();
    return all.filter((item) => (
      item.userId === userId
      && item.status === 'active'
      && new Date(item.expiresAt).getTime() > now
    ));
  },
};
