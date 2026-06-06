import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'tasks.json', defaultData: [] });

export const taskRepo = {
  ...baseRepo,
  async findByAssignedTo(userId) {
    const all = await baseRepo.getAll();
    return all.filter((t) => t.assignedTo === userId);
  },
};
