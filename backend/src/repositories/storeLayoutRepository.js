import { getPrisma } from '../providers/postgresProvider.js';

export const storeLayoutRepo = {
  /* ─── Layout CRUD ─── */

  async findMany(where = {}) {
    const prisma = await getPrisma();
    return prisma.storeLayout.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  },

  async findById(id) {
    const prisma = await getPrisma();
    return prisma.storeLayout.findFirst({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  },

  async create(data) {
    const prisma = await getPrisma();
    return prisma.storeLayout.create({ data });
  },

  async update(id, data) {
    const prisma = await getPrisma();
    return prisma.storeLayout.update({
      where: { id },
      data,
    });
  },

  async remove(id) {
    const prisma = await getPrisma();
    return prisma.storeLayout.delete({ where: { id } });
  },

  /* ─── Items ─── */

  async findItems(layoutId) {
    const prisma = await getPrisma();
    return prisma.storeLayoutItem.findMany({
      where: { layoutId },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async deleteItemsByLayoutId(layoutId) {
    const prisma = await getPrisma();
    return prisma.storeLayoutItem.deleteMany({ where: { layoutId } });
  },

  async createManyItems(items) {
    const prisma = await getPrisma();
    return prisma.storeLayoutItem.createMany({ data: items });
  },

  /* ─── Transaction helpers ─── */

  async transaction(fn) {
    const prisma = await getPrisma();
    return prisma.$transaction(fn);
  },
};
