import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'sections.json', defaultData: [] });

export const sectionRepo = {
  ...baseRepo,
  async findByNumber(number) {
    const all = await baseRepo.getAll();
    return all.find((s) => s.number === number);
  },
};
