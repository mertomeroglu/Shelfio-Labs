import { createFileRepository } from './fileRepository.js';
import { config } from '../config/config.js';
import { normalizeTurkishTextDeep } from '../utils/turkishText.js';

const baseRepo = createFileRepository({ fileName: 'notifications.json', defaultData: [] });

const normalizeNotificationRecord = (item = {}) => normalizeTurkishTextDeep(item);

const normalizeNotificationCollection = (items = []) => (
  Array.isArray(items) ? items.map((item) => normalizeNotificationRecord(item)) : []
);

const readNormalizedAll = async () => {
  const rows = await baseRepo.getAll();
  const normalized = normalizeNotificationCollection(rows);
  if (config.runStartupMaintenance && JSON.stringify(rows) !== JSON.stringify(normalized)) {
    await baseRepo.writeData(normalized);
  }
  return normalized;
};

export const notificationRepo = {
  ...baseRepo,

  async getAll() {
    return readNormalizedAll();
  },

  async findById(id) {
    const all = await readNormalizedAll();
    return all.find((item) => item.id === id) || null;
  },

  async writeData(items) {
    return baseRepo.writeData(normalizeNotificationCollection(items));
  },

  async create(item) {
    return baseRepo.create(normalizeNotificationRecord(item));
  },

  async updateById(id, updater) {
    return baseRepo.updateById(id, (current) => {
      const nextValue = typeof updater === 'function' ? updater(current) : updater;
      return normalizeNotificationRecord(nextValue);
    });
  },

  async findByUserId(userId) {
    const all = await readNormalizedAll();
    return all.filter((item) => item.userId === userId);
  },

  async findByUserAndDedupeKey(userId, dedupeKey) {
    if (!dedupeKey) return null;
    const all = await readNormalizedAll();
    return all.find((item) => item.userId === userId && item.dedupeKey === dedupeKey) || null;
  },

  async markAllAsRead(userId) {
    const all = await readNormalizedAll();
    let changed = false;

    const next = all.map((item) => {
      if (item.userId !== userId || item.isRead) {
        return item;
      }
      changed = true;
      return {
        ...item,
        isRead: true,
      };
    });

    if (changed) {
      await baseRepo.writeData(normalizeNotificationCollection(next));
    }

    return { updated: changed };
  },
};
