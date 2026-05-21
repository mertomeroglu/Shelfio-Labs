import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'supportTickets.json', defaultData: [] });

export const supportTicketRepo = {
  ...baseRepo,

  async findByTicketId(ticketId) {
    const all = await baseRepo.getAll();
    return all.find((item) => item.id === ticketId) || null;
  },
};
