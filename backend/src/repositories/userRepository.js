import { dataDefaults } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';

const repository = createFileRepository({ fileName: 'users.json', defaultData: dataDefaults.users });

export const userRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  deleteById: repository.deleteById,
  async findByUsername(username) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (!normalizedUsername) {
      return null;
    }

    return repository.findOne((user) => String(user?.username || '').trim().toLowerCase() === normalizedUsername);
  },
};
