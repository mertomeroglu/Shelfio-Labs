import { v4 as uuidv4 } from 'uuid';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { sanitizeCategoryInput, validateCategoryPayload } from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';

const normalizeUnicodeText = (value) => String(value || '').normalize('NFC');

const toSlug = (value) => normalizeUnicodeText(value)
  .toLocaleLowerCase('tr-TR')
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const toCode = (value) => normalizeUnicodeText(value)
  .toLocaleUpperCase('tr-TR')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .slice(0, 5);

const normalizeKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const hasDuplicateNameAtSameParent = (categories, name, parentCategoryId, excludeId = null) => {
  const targetParent = String(parentCategoryId || '');
  const targetName = normalizeKey(name);
  return categories.some((item) => {
    if (excludeId && item.id === excludeId) return false;
    return normalizeKey(item.name) === targetName && String(item.parentCategoryId || '') === targetParent;
  });
};

const buildUniqueCode = async (baseValue, excludeId = null) => {
  const seed = String(baseValue || '').replace(/[^A-Z0-9]+/g, '').slice(0, 5) || `C${Date.now().toString().slice(-4)}`;
  let attempt = 0;
  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const prefixLength = Math.max(1, 5 - suffix.length);
    const candidate = `${seed.slice(0, prefixLength)}${suffix}`.slice(0, 5);
    const existing = await categoryRepo.findByCode(candidate);
    if (!existing || existing.id === excludeId) {
      return candidate;
    }
    attempt += 1;
  }

  return seed.slice(0, 5);
};

const buildUniqueValue = async (base, lookupFn, excludeId = null) => {
  let candidate = base;
  let index = 2;
  while (candidate) {
    const existing = await lookupFn(candidate);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${index}`;
    index += 1;
  }
  return base;
};

const mapCategory = async (category) => {
  const [products, parent] = await Promise.all([
    productRepo.getAll(),
    category.parentCategoryId ? categoryRepo.findById(category.parentCategoryId) : Promise.resolve(null),
  ]);
  const productCount = products.filter((product) => product.categoryId === category.id).length;

  return {
    ...category,
    productCount,
    parentCategoryName: parent?.name || null,
  };
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const listCategoriesFromPostgres = async () => {
  const prisma = await getPrisma();
  const rows = await withPostgresQueryLogging('GET /api/categories', () => prisma.category.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      mainSectionNo: true,
      mainSectionName: true,
      mainStorageType: true,
      requiresColdChain: true,
      requiresFreezer: true,
      isActive: true,
      payload: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  }));

  return rows.map((row) => ({
    ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    mainSectionNo: row.mainSectionNo,
    mainSectionName: row.mainSectionName,
    mainStorageType: row.mainStorageType,
    requiresColdChain: row.requiresColdChain === true,
    requiresFreezer: row.requiresFreezer === true,
    isActive: row.isActive !== false,
    productCount: row._count?.products || 0,
    parentCategoryName: null,
    createdAt: fromDateValue(row.createdAt),
    updatedAt: fromDateValue(row.updatedAt),
  }));
};

export const categoryService = {
  async list() {
    if (config.dataStore === 'postgres') {
      return listCategoriesFromPostgres();
    }

    const categories = await categoryRepo.getAll();
    const mapped = await Promise.all(categories.map((item) => mapCategory(item)));
    return mapped.sort((left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || Number(right.isActive) - Number(left.isActive)
      || left.name.localeCompare(right.name, 'tr')
    );
  },

  async getById(id) {
    const category = await categoryRepo.findById(id);
    if (!category) {
      throw createNotFoundError('Kategori bulunamadı');
    }

    return mapCategory(category);
  },

  async create(payload) {
    validateCategoryPayload(payload);
    const input = sanitizeCategoryInput(payload);
    const all = await categoryRepo.getAll();
    const maxSortOrder = all.reduce((max, item) => Math.max(max, Number(item.sortOrder || 0)), 0);

    const parentCategoryId = input.parentCategoryId || null;
    if (parentCategoryId) {
      const parent = await categoryRepo.findById(parentCategoryId);
      if (!parent) {
        throw new AppError(400, 'Üst kategori bulunamadı');
      }
    }

    if (hasDuplicateNameAtSameParent(all, input.name, parentCategoryId)) {
      throw new AppError(409, 'Aynı üst kategori altında bu isimde kategori zaten mevcut');
    }

    if (parentCategoryId) {
      const duplicateAcrossParents = all.find((item) =>
        String(item.parentCategoryId || '')
        && String(item.parentCategoryId || '') !== String(parentCategoryId)
        && normalizeKey(item.name) === normalizeKey(input.name));
      if (duplicateAcrossParents) {
        throw new AppError(409, 'Aynı etiket/alt kategori farklı ana kategoriye bağlanamaz');
      }
    }

    const requestedCode = toCode(input.code || input.name);
    const requestedSlug = toSlug(input.slug || input.name || `kategori-${Date.now().toString().slice(-4)}`);

    if (!requestedCode) {
      throw new AppError(400, 'Kategori kodu boş olamaz');
    }

    if (!requestedSlug) {
      throw new AppError(400, 'Kategori slug boş olamaz');
    }

    const sameCode = await categoryRepo.findByCode(requestedCode);
    if (sameCode) {
      throw new AppError(409, 'Kategori kodu zaten mevcut');
    }

    const sameSlug = await categoryRepo.findBySlug(requestedSlug);
    if (sameSlug) {
      throw new AppError(409, 'Kategori slug zaten mevcut');
    }

    const now = new Date().toISOString();
    const category = {
      id: uuidv4(),
      name: input.name,
      code: requestedCode,
      slug: requestedSlug,
      parentCategoryId,
      etiketler: input.etiketler || '',
      linkedSectionNo: input.linkedSectionNo || '',
      linkedSectionName: input.linkedSectionName || '',
      storageStructure: input.storageStructure || '',
      temperatureNote: input.temperatureNote || '',
      sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : maxSortOrder + 10,
      icon: input.icon || '',
      color: input.color || '',
      requiresColdChain: input.requiresColdChain === true,
      requiresFreezer: input.requiresFreezer === true,
      description: input.description,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    };

    await categoryRepo.create(category);
    return mapCategory(category);
  },

  async update(id, payload) {
    validateCategoryPayload(payload, { partial: true });
    const existing = await categoryRepo.findById(id);

    if (!existing) {
      throw createNotFoundError('Kategori bulunamadı');
    }

    const input = sanitizeCategoryInput({ ...existing, ...payload });
    const all = await categoryRepo.getAll();

    const parentCategoryId = input.parentCategoryId || null;
    if (parentCategoryId === id) {
      throw new AppError(400, 'Kategori kendisini üst kategori olarak seçemez');
    }
    if (parentCategoryId) {
      const parent = await categoryRepo.findById(parentCategoryId);
      if (!parent) {
        throw new AppError(400, 'Üst kategori bulunamadı');
      }
    }

    if (hasDuplicateNameAtSameParent(all, input.name, parentCategoryId, id)) {
      throw new AppError(409, 'Aynı üst kategori altında bu isimde kategori zaten mevcut');
    }

    if (parentCategoryId) {
      const duplicateAcrossParents = all.find((item) =>
        item.id !== id
        && String(item.parentCategoryId || '')
        && String(item.parentCategoryId || '') !== String(parentCategoryId)
        && normalizeKey(item.name) === normalizeKey(input.name));
      if (duplicateAcrossParents) {
        throw new AppError(409, 'Aynı etiket/alt kategori farklı ana kategoriye bağlanamaz');
      }
    }

    const requestedCode = toCode(input.code || input.name);
    const requestedSlug = toSlug(input.slug || input.name || existing.slug || `kategori-${Date.now().toString().slice(-4)}`);

    if (!requestedCode) {
      throw new AppError(400, 'Kategori kodu boş olamaz');
    }

    if (!requestedSlug) {
      throw new AppError(400, 'Kategori slug boş olamaz');
    }

    const sameCode = await categoryRepo.findByCode(requestedCode);
    if (sameCode && sameCode.id !== id) {
      throw new AppError(409, 'Kategori kodu zaten mevcut');
    }

    const sameSlug = await categoryRepo.findBySlug(requestedSlug);
    if (sameSlug && sameSlug.id !== id) {
      throw new AppError(409, 'Kategori slug zaten mevcut');
    }

    const updated = {
      ...existing,
      name: input.name,
      code: requestedCode,
      slug: requestedSlug,
      parentCategoryId,
      etiketler: input.etiketler || existing.etiketler || '',
      linkedSectionNo: input.linkedSectionNo || existing.linkedSectionNo || '',
      linkedSectionName: input.linkedSectionName || existing.linkedSectionName || '',
      storageStructure: input.storageStructure || existing.storageStructure || '',
      temperatureNote: input.temperatureNote || existing.temperatureNote || '',
      sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : (existing.sortOrder || 0),
      icon: input.icon || '',
      color: input.color || '',
      requiresColdChain: input.requiresColdChain === true,
      requiresFreezer: input.requiresFreezer === true,
      description: input.description,
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
    };

    await categoryRepo.updateById(id, updated);
    return mapCategory(updated);
  },

  async remove(id) {
    const category = await categoryRepo.findById(id);
    if (!category) {
      throw createNotFoundError('Kategori bulunamadı');
    }

    const products = await productRepo.getAll();
    const linkedProduct = products.find((product) => product.categoryId === id);
    if (linkedProduct) {
      throw new AppError(400, 'Bu kategoriye bağlı ürünler var');
    }

    await categoryRepo.deleteById(id);
    return category;
  },
};
