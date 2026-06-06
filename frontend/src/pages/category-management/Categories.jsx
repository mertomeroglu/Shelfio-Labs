import { useEffect, useMemo, useState } from 'react';
import { Tags, CheckCircle2, Package, Plus, Layers } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import DataTable from '../../components/DataTable.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { buildTaxonomyResolver, formatNumber, resolveCategoryMainLabel } from '../../services/formatters.js';
import { categoryService } from '../../services/categoryService.js';
import { productService } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';

const initialForm = {
  categoryType: 'main',
  name: '',
  code: '',
  slug: '',
  parentCategoryId: '',
  description: '',
  isActive: true,
  icon: '',
  color: '#2563eb',
  sortOrder: '',
  requiresColdChain: false,
  requiresFreezer: false,
  linkedSectionId: '',
  linkedSectionNo: '',
  linkedSectionName: '',
  storageStructure: '',
  temperatureNote: '',
  etiketler: '',
};

const normalizeUnicodeText = (value) => String(value || '').normalize('NFC');
const TURKISH_ASCII_MAP = {
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
};

const toAsciiToken = (value) => String(value || '').replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_ASCII_MAP[char] || char);
const flattenCategoryRows = (rows = []) => {
  const stack = Array.isArray(rows) ? [...rows] : [];
  const flat = [];
  const seen = new Set();
  const buildVirtualId = (node) => {
    const parent = String(node?.parentCategoryId || 'root').trim().toLocaleLowerCase('tr-TR');
    const name = String(node?.name || 'etiket').trim().toLocaleLowerCase('tr-TR');
    const slug = toSlug(`${parent}-${name}`) || `etiket-${Date.now()}`;
    return `virtual-${slug}`;
  };
  while (stack.length) {
    const node = stack.shift();
    if (!node) continue;
    const nodeId = String(node.id || buildVirtualId(node));
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    flat.push({
      ...node,
      id: nodeId,
      __virtual: !node.id,
    });
    const children = [
      ...(Array.isArray(node.subCategories) ? node.subCategories : []),
      ...(Array.isArray(node.children) ? node.children : []),
      ...(Array.isArray(node.altKategoriler) ? node.altKategoriler : []),
    ];
    children.forEach((child) => {
      if (!child) return;
      stack.push({
        ...child,
        parentCategoryId: child.parentCategoryId || node.id,
      });
    });
  }
  return flat;
};

const toSlug = (value) => toAsciiToken(normalizeUnicodeText(value))
  .toLocaleLowerCase('tr-TR')
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const toCode = (value) => normalizeUnicodeText(value)
  .toLocaleUpperCase('tr-TR')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .slice(0, 5);

const normalizeText = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');
const toTagToken = (value, fallback) => {
  const normalized = toAsciiToken(normalizeUnicodeText(value))
    .toLocaleUpperCase('tr-TR')
    .replace(/[^A-Z0-9]+/g, '');
  return (normalized.slice(0, 3) || fallback).padEnd(3, 'X');
};

const parseExplicitTags = (value) => String(value || '')
  .split(',')
  .map((part) => String(part || '').trim())
  .filter(Boolean);

const toOptionalSortOrder = (value) => (
  value === 0 || Number(value) > 0 ? Number(value) : undefined
);

const suggestUniqueCode = (name, rows, excludeId = null) => {
  const seed = toCode(name) || 'CAT';
  const used = new Set(
    rows
      .filter((item) => item.id !== excludeId)
      .map((item) => String(item.code || '').toLocaleUpperCase('tr-TR'))
  );

  if (!used.has(seed)) return seed;

  for (let i = 2; i < 1000; i += 1) {
    const suffix = String(i);
    const prefixLen = Math.max(1, 5 - suffix.length);
    const candidate = `${seed.slice(0, prefixLen)}${suffix}`.slice(0, 5);
    if (!used.has(candidate)) return candidate;
  }

  return seed;
};

const suggestUniqueSlug = (name, rows, excludeId = null) => {
  const seed = toSlug(name) || 'kategori';
  const used = new Set(
    rows
      .filter((item) => item.id !== excludeId)
      .map((item) => String(item.slug || '').trim().toLocaleLowerCase('tr-TR'))
  );

  if (!used.has(seed)) return seed;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${seed}-${i}`;
    if (!used.has(candidate)) return candidate;
  }

  return seed;
};

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [sections, setSections] = useState([]);
  const [labelMaster, setLabelMaster] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [autoCode, setAutoCode] = useState(true);
  const [autoSlug, setAutoSlug] = useState(true);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [categoryList, productList, sectionList, masterLabels] = await Promise.all([
        categoryService.list({ forceRefresh: true }),
        productService.list({ fetchAll: true }),
        sectionService.list(),
        categoryService.listLabels({ forceRefresh: true }),
      ]);
      setCategories(flattenCategoryRows(categoryList));
      setProducts(Array.isArray(productList) ? productList : []);
      setSections(Array.isArray(sectionList) ? sectionList : []);
      setLabelMaster(Array.isArray(masterLabels) ? masterLabels : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Kategoriler', message: error.message || 'Kategoriler yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const categoryById = useMemo(() => {
    return new Map(categories.map((item) => [String(item.id), item]));
  }, [categories]);

  const taxonomyResolver = useMemo(
    () => buildTaxonomyResolver({ products, categories }),
    [products, categories]
  );

  const enrichedRows = useMemo(() => {
    const sectionById = new Map(sections.map((item) => [String(item.id), item]));
    const labelMapByCategory = new Map();
    labelMaster.forEach((item) => {
      const categoryId = String(item.categoryId || '');
      if (!categoryId) return;
      if (!labelMapByCategory.has(categoryId)) labelMapByCategory.set(categoryId, new Set());
      labelMapByCategory.get(categoryId).add(String(item.labelName || '').trim());
    });

    return categories
      .filter((item) => !item.parentCategoryId)
      .map((item) => {
        const mainCategory = resolveCategoryMainLabel(item, taxonomyResolver.categoryLookup);
        const tagsFromMaster = [...(labelMapByCategory.get(String(item.id)) || new Set())];
        const tagList = [...new Set(tagsFromMaster)]
          .map((tag) => String(tag || '').trim())
          .filter((tag) => tag && tag !== '-' && tag.toLocaleLowerCase('tr-TR') !== 'yok')
          .sort((a, b) => a.localeCompare(b, 'tr'));
        const productRows = products.filter((product) => String(resolveCategoryMainLabel({
          id: product.categoryId,
          name: product.categoryName,
          parentCategoryId: categoryById.get(String(product.categoryId || ''))?.parentCategoryId,
        }, taxonomyResolver.categoryLookup)) === String(mainCategory));

        const linkedSectionCounts = new Map();
        productRows.forEach((product) => {
          const key = String(product.sectionId || '');
          if (!key) return;
          linkedSectionCounts.set(key, (linkedSectionCounts.get(key) || 0) + 1);
        });

        let dominantSectionId = '';
        let dominantCount = -1;
        linkedSectionCounts.forEach((count, sectionId) => {
          if (count > dominantCount) {
            dominantSectionId = sectionId;
            dominantCount = count;
          }
        });

        const dominantSection = sectionById.get(String(item.linkedSectionId || dominantSectionId)) || null;
        const linkedSectionNo = String(item.linkedSectionNo || dominantSection?.number || '-');
        const linkedSectionName = String(item.linkedSectionName || dominantSection?.name || '-');

        const productCount = Number(item.productCount || productRows.length || 0);
        const averageDesi = productRows.length ?
          productRows.reduce((sum, product) => sum + Number(product.averageDesi || 0), 0) / productRows.length
          : 0;
        const estimatedTotalDesi = productRows.reduce((sum, product) => sum + Number(product.averageDesi || 0), 0);
        const maxShelfDesi = productRows.reduce((sum, product) => sum + (Number(product.maxShelfStock || 0) * Number(product.averageDesi || 0)), 0);

        const storageModel = item.storageStructure
          || (item.requiresFreezer ?
            'Dondurucu'
            : item.requiresColdChain ?
              'Soğuk Zincir'
              : 'Ortam');

        const tempNote = item.temperatureNote
          || (item.requiresFreezer ?
            '-18°C'
            : item.requiresColdChain ?
              '+1/+4°C'
              : (item.description || 'Ortam koşulu'));

        return {
          ...item,
          categoryLabel: mainCategory,
          tagPreview: tagList.length ? tagList.join(', ') : '-',
          tagList,
          linkedSectionNo,
          linkedSectionName,
          productCount,
          averageDesi,
          estimatedTotalDesi,
          maxShelfDesi,
          storageModel,
          tempNote,
        };
      });
  }, [categories, categoryById, products, sections, taxonomyResolver, labelMaster]);

  const filteredRows = enrichedRows;
  const tagRows = useMemo(
    () => {
      const grouped = new Map();
      const isMainCategory = (item) => item && !item.parentCategoryId;
      const hasValidMainParent = (parentId) => {
        const parent = categoryById.get(String(parentId || ''));
        return isMainCategory(parent);
      };

      categories
        .filter((item) => item.parentCategoryId && hasValidMainParent(item.parentCategoryId))
        .forEach((item) => {
          const parent = categoryById.get(String(item.parentCategoryId || ''));
          const parentName = parent?.name || '-';
          const dedupeKey = `${normalizeText(parentName)}::${normalizeText(item.name)}`;
          const current = grouped.get(dedupeKey);
          if (!current || String(item.id || '').localeCompare(String(current.id || ''), 'tr') < 0) {
            grouped.set(dedupeKey, { ...item, parentName });
          }
        });

      categories
        .filter((item) => isMainCategory(item))
        .forEach((item) => {
          const parentName = item.name || '-';
          const tagsFromField = parseExplicitTags(item.etiketler);
          tagsFromField.forEach((tagName) => {
            const dedupeKey = `${normalizeText(parentName)}::${normalizeText(tagName)}`;
            if (grouped.has(dedupeKey)) return;
            const virtualId = `virtual-tag-${toSlug(`${item.id || parentName}-${tagName}`) || `${item.id}-etiket`}`;
            grouped.set(dedupeKey, {
              id: virtualId,
              name: tagName,
              slug: toSlug(tagName),
              parentCategoryId: item.id,
              parentName,
              __virtual: true,
              sourceType: 'field',
            });
          });
        });

      const rows = [...grouped.values()].sort((a, b) => {
        const parentDiff = String(a.parentName || '').localeCompare(String(b.parentName || ''), 'tr');
        if (parentDiff !== 0) return parentDiff;
        return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
      });

      const codeCounter = new Map();
      const fieldRows = rows.map((row) => {
        const parentToken = toTagToken(row.parentName, 'KAT');
        const nameToken = toTagToken(row.name, 'ETK');
        const codePrefix = `${parentToken}-${nameToken}`;
        const next = (codeCounter.get(codePrefix) || 0) + 1;
        codeCounter.set(codePrefix, next);
        return {
          ...row,
          generatedTagCode: `${codePrefix}-${String(next).padStart(3, '0')}`,
        };
      });
      const masterRows = (Array.isArray(labelMaster) ? labelMaster : []).map((item) => ({
        id: item.labelId || item.id,
        name: item.labelName,
        slug: item.labelSlug,
        parentCategoryId: item.categoryId,
        parentName: item.categoryName || categoryById.get(String(item.categoryId || ''))?.name || '-',
        generatedTagCode: item.labelDisplayCode || item.labelCode || '-',
        machineCode: item.labelCode || '-',
        __virtual: true,
        sourceType: 'master',
      }));
      if (!masterRows.length) return fieldRows;
      const merged = new Map();
      masterRows.forEach((row) => {
        const key = `${normalizeText(row.parentName)}::${normalizeText(row.name)}`;
        merged.set(key, row);
      });
      fieldRows.forEach((row) => {
        const key = `${normalizeText(row.parentName)}::${normalizeText(row.name)}`;
        if (!merged.has(key)) merged.set(key, row);
      });
      return [...merged.values()].sort((a, b) => {
        const parentDiff = String(a.parentName || '').localeCompare(String(b.parentName || ''), 'tr');
        if (parentDiff !== 0) return parentDiff;
        return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
      });
    },
    [categories, categoryById, taxonomyResolver, labelMaster]
  );

  const summary = useMemo(
    () => ({
      total: categories.length,
      mainCategoryCount: categories.filter((item) => !item.parentCategoryId).length,
      subCategoryCount: tagRows.length,
      productTotal: categories.reduce((sum, item) => sum + (item.productCount || 0), 0),
    }),
    [categories, tagRows]
  );

  const parentOptions = useMemo(() => {
    return categories.filter((item) => {
      if (editingItem && item.id === editingItem.id) return false;
      return !item.parentCategoryId;
    });
  }, [categories, editingItem]);

  const isSubMode = form.categoryType === 'sub';

  const resetForm = () => {
    setForm(initialForm);
    setAutoCode(true);
    setAutoSlug(true);
  };

  const applyNameChange = (nextName) => {
    setForm((current) => {
      const next = { ...current, name: nextName };
      if (autoCode) {
        next.code = suggestUniqueCode(nextName, categories, editingItem?.id || null);
      }
      if (autoSlug) {
        next.slug = suggestUniqueSlug(nextName, categories, editingItem?.id || null);
      }
      return next;
    });
  };

  const openCreateModal = () => {
    const seedName = '';
    const nextCode = suggestUniqueCode(seedName, categories);
    const nextSlug = suggestUniqueSlug(seedName, categories);
    setEditingItem(null);
    setForm({
      ...initialForm,
      code: nextCode,
      slug: nextSlug,
    });
    setAutoCode(true);
    setAutoSlug(true);
    setIsModalOpen(true);
  };

  const openCreateTagModal = () => {
    setEditingItem(null);
    setForm({
      ...initialForm,
      categoryType: 'sub',
      code: suggestUniqueCode('', categories),
      slug: suggestUniqueSlug('', categories),
    });
    setAutoCode(true);
    setAutoSlug(true);
    setIsTagModalOpen(true);
  };

  const openEditModal = (row) => {
    if (row.__virtual) {
      setEditingItem(row);
      setForm({
        ...initialForm,
        categoryType: 'sub',
        name: row.name || '',
        code: row.generatedTagCode || suggestUniqueCode(row.name || '', categories),
        slug: row.slug || suggestUniqueSlug(row.name || '', categories),
        parentCategoryId: row.parentCategoryId || '',
      });
      setAutoCode(false);
      setAutoSlug(false);
      setIsTagModalOpen(true);
      return;
    }

    const matchedSection = sections.find((item) => (
      String(item.id) === String(row.linkedSectionId || '')
      || String(item.number || '') === String(row.linkedSectionNo || '')
      || String(item.name || '').trim() === String(row.linkedSectionName || '').trim()
    ));

    setEditingItem(row);
    setForm({
      categoryType: row.parentCategoryId ? 'sub' : 'main',
      name: row.name || '',
      code: row.code || suggestUniqueCode(row.name || '', categories, row.id),
      slug: row.slug || suggestUniqueSlug(row.name || '', categories, row.id),
      parentCategoryId: row.parentCategoryId || '',
      description: row.description || '',
      isActive: row.isActive !== false,
      icon: row.icon || '',
      color: row.color || '#2563eb',
      sortOrder: row.sortOrder === 0 || Number(row.sortOrder) > 0 ? String(row.sortOrder) : '',
      requiresColdChain: row.requiresColdChain === true,
      requiresFreezer: row.requiresFreezer === true,
      linkedSectionId: matchedSection?.id || row.linkedSectionId || '',
      linkedSectionNo: row.linkedSectionNo || '',
      linkedSectionName: row.linkedSectionName || '',
      storageStructure: row.storageStructure || '',
      temperatureNote: row.temperatureNote || '',
      etiketler: row.etiketler || '',
    });
    setAutoCode(false);
    setAutoSlug(false);
    if (row.parentCategoryId) {
      setIsTagModalOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = String(form.name || '').trim();
    const code = suggestUniqueCode(name, categories, editingItem?.id || null);
    const slug = suggestUniqueSlug(name, categories, editingItem?.id || null);
    const parentCategoryId = isSubMode ? String(form.parentCategoryId || '') : '';

    if (!name) {
      setToast({ type: 'error', title: 'Kategoriler', message: 'Kategori adı zorunludur.' });
      return;
    }

    if (isSubMode && !parentCategoryId) {
      setToast({ type: 'error', title: 'Kategoriler', message: 'Alt kategori için Üst Kategori seçimi zorunludur.' });
      return;
    }

    if (form.requiresColdChain && form.requiresFreezer) {
      setToast({ type: 'error', title: 'Kategoriler', message: 'Soğuk Zincir ve Dondurucu aynı anda seçilemez.' });
      return;
    }

    const normalizedName = normalizeText(name);
    const editingId = editingItem?.id || null;

    const duplicateNameAtSameParent = categories.find((item) => {
      if (item.id === editingId) return false;
      const itemParent = String(item.parentCategoryId || '');
      const targetParent = String(parentCategoryId || '');
      return itemParent === targetParent && normalizeText(item.name) === normalizedName;
    });
    if (duplicateNameAtSameParent) {
      setToast({ type: 'error', title: 'Kategoriler', message: 'Aynı üst kategori altında bu adla bir kategori zaten var.' });
      return;
    }

    try {
      setSubmitting(true);
      if (editingItem?.__virtual) {
        const parent = categoryById.get(String(parentCategoryId || ''));
        if (!parent) {
          throw new Error('Bağlı kategori bulunamadı.');
        }

        const replacedTags = parseExplicitTags(parent.etiketler).map((tag) => (
          normalizeText(tag) === normalizeText(editingItem.name) ? name : tag
        ));
        const dedupedTags = [];
        const seenTagNames = new Set();
        replacedTags.forEach((tag) => {
          const trimmed = String(tag || '').trim();
          const normalizedTag = normalizeText(trimmed);
          if (!trimmed || seenTagNames.has(normalizedTag)) return;
          seenTagNames.add(normalizedTag);
          dedupedTags.push(trimmed);
        });

        await categoryService.update(parent.id, {
          name: parent.name || '',
          code: parent.code || suggestUniqueCode(parent.name || '', categories, parent.id),
          slug: parent.slug || suggestUniqueSlug(parent.name || '', categories, parent.id),
          parentCategoryId: '',
          description: parent.description || '',
          isActive: parent.isActive !== false,
          icon: parent.icon || '',
          color: parent.color || '#2563eb',
          sortOrder: toOptionalSortOrder(parent.sortOrder),
          requiresColdChain: Boolean(parent.requiresColdChain),
          requiresFreezer: Boolean(parent.requiresFreezer),
          linkedSectionId: parent.linkedSectionId || '',
          linkedSectionNo: parent.linkedSectionNo || '',
          linkedSectionName: parent.linkedSectionName || '',
          storageStructure: parent.storageStructure || '',
          temperatureNote: parent.temperatureNote || '',
          etiketler: dedupedTags.join(', '),
        });
        setToast({ type: 'success', title: 'Kategoriler', message: 'Etiket güncellendi.' });
        setIsTagModalOpen(false);
        resetForm();
        setEditingItem(null);
        await loadData();
        return;
      }

      const payload = {
        name,
        code,
        slug,
        parentCategoryId,
        description: '',
        isActive: editingItem ? Boolean(form.isActive) : true,
        icon: String(form.icon || '').trim(),
        color: String(form.color || '').trim(),
        sortOrder: form.sortOrder === '' ? undefined : Number(form.sortOrder),
        requiresColdChain: Boolean(form.requiresColdChain),
        requiresFreezer: Boolean(form.requiresFreezer),
        linkedSectionId: '',
        linkedSectionNo: '',
        linkedSectionName: '',
        storageStructure: String(form.storageStructure || '').trim(),
        temperatureNote: String(form.temperatureNote || '').trim(),
        etiketler: String(form.etiketler || '').trim(),
      };
      if (editingItem) {
        await categoryService.update(editingItem.id, payload);
        setToast({ type: 'success', title: 'Kategoriler', message: 'Kategori güncellendi.' });
      } else {
        await categoryService.create(payload);
        setToast({ type: 'success', title: 'Kategoriler', message: 'Kategori eklendi.' });
      }
      setIsModalOpen(false);
      setIsTagModalOpen(false);
      resetForm();
      setEditingItem(null);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Kategoriler', message: error.message || 'İşlem başarısız.' });
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'categoryLabel',
      label: 'Kategori',
      render: (row) => (
        <span className="category-name-with-status-dot" aria-label={`${row.categoryLabel || row.name || '-'} ${row.isActive ? '(Aktif)' : '(Pasif)'}`}>
          <span className={`category-status-dot ${row.isActive ? 'active' : 'passive'}`} aria-hidden="true" />
          <span>{row.categoryLabel || row.name || '-'}</span>
        </span>
      ),
    },
    {
      key: 'tagPreview',
      label: 'Etiketler (Alt Kategoriler)',
      render: (row) => {
        if (!Array.isArray(row.tagList) || !row.tagList.length) {
          return <span className="muted-text">-</span>;
        }
        return (
          <div className="category-tag-chip-list" aria-label="Kategori alt etiketleri">
            {row.tagList.map((tag) => (
              <span key={`${row.id}-${tag}`} className="category-tag-chip">{tag}</span>
            ))}
          </div>
        );
      },
    },
    { key: 'code', label: 'Kategori Kodu', render: (row) => row.code || '-' },
    { key: 'linkedSectionNo', label: 'Bağlı Reyon No', render: (row) => row.linkedSectionNo || '-' },
    { key: 'linkedSectionName', label: 'Bağlı Reyon', render: (row) => row.linkedSectionName || '-' },
    { key: 'productCount', label: 'Ürün Çeşidi', sortValue: (row) => row.productCount || 0, render: (row) => formatNumber(row.productCount || 0) },
    { key: 'maxShelfDesi', label: 'Maksimum Reyon Desisi', sortValue: (row) => Number(row.maxShelfDesi || 0), render: (row) => Number(row.maxShelfDesi || 0) > 0 ? Number(row.maxShelfDesi).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-' },
    { key: 'storageModel', label: 'Ana Saklama Yapısı', render: (row) => row.storageModel || '-' },
    {
      key: 'actions',
      label: 'İşlemler',
      className: 'table-cell-actions',
      sortable: false,
      render: (row) =>
        isAdmin ? (
          <div className="table-actions">
            <button className="text-button" type="button" onClick={() => {
              openEditModal(row);
            }}>
              Düzenle
            </button>
            <button className="text-button danger" type="button" onClick={() => setDeleteTarget(row)}>
              Sil
            </button>
          </div>
        ) : (
          <span className="muted-text">Salt okunur</span>
        ),
    },
  ];

  const tagColumns = [
    { key: 'name', label: 'Etiket Adı' },
    { key: 'parentName', label: 'Bağlı Kategori' },
    { key: 'generatedTagCode', label: 'Etiket Kodu', render: (row) => row.generatedTagCode || row.code || '-' },
    { key: 'slug', label: 'Kısa Ad', render: (row) => row.slug || '-' },
    {
      key: 'actions',
      label: 'İşlemler',
      className: 'table-cell-actions',
      sortable: false,
      render: (row) => (
        isAdmin ? (
          <div className="table-actions">
            <button className="text-button" type="button" onClick={() => openEditModal(row)}>Düzenle</button>
            <button className="text-button danger" type="button" onClick={() => setDeleteTarget(row)}>Sil</button>
          </div>
        ) : <span className="muted-text">-</span>
      ),
    },
  ];

  return (
    <div className="page-stack categories-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader className="dashboard-hero" icon={<Tags size={22} />} title="Kategoriler" description="Kategorileri düzenleyin ve mağaza yapısını organize edin." actions={isAdmin ? <div className="table-actions"><button className="primary-button category-action-btn" type="button" onClick={openCreateModal}><Plus size={16} /> Yeni Kategori</button><button className="outline-button category-action-btn" type="button" onClick={openCreateTagModal}><Plus size={16} /> Yeni Etiket</button></div> : null} />
      <section className="mod-summary-grid three">
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-indigo"><Layers size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Toplam Kategori</span>
            <span className="mod-stat-value">{formatNumber(summary.total)}</span>
            <span className="mod-stat-caption">Sistemdeki kategori</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-green"><CheckCircle2 size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Ana Kategori Sayısı</span>
            <span className="mod-stat-value">{formatNumber(summary.mainCategoryCount)}</span>
            <span className="mod-stat-caption">Üst düzey kategori sayısı</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-amber"><Package size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Alt Kategori Sayısı</span>
            <span className="mod-stat-value">{formatNumber(summary.subCategoryCount)}</span>
            <span className="mod-stat-caption">Etiket olarak tanımlı alt kategoriler</span>
          </div>
        </div>
      </section>
      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Layers size={18} /></div>
          <div><h3>Kategori Listesi</h3><p>Tüm kategorileri görüntüleyin ve yönetin</p></div>
        </div>
        <DataTable columns={columns} rows={filteredRows} isLoading={isLoading} emptyMessage="Kategori kaydı bulunmuyor." pageSize={10} />
      </div>
      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-cyan"><Tags size={18} /></div>
          <div><h3>Etiket Listesi</h3><p>Alt etiketleri ayrı olarak yönetin</p></div>
        </div>
        <DataTable columns={tagColumns} rows={tagRows} isLoading={isLoading} emptyMessage="Etiket kaydı bulunmuyor." pageSize={10} />
      </div>
      <FormModal
        isOpen={isModalOpen}
        title={editingItem ? 'Kategori Düzenle' : 'Yeni Kategori'}
        description="Sadece ana kategori oluşturun veya mevcut ana kategoriyi düzenleyin."
        headerIcon={<Tags size={20} />}
        onClose={() => {
          setIsModalOpen(false);
          if (!editingItem) {
            resetForm();
          }
        }}
        modalClassName="category-form-fit-modal"
      >
        <form className="modal-form modal-structured-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll">
            <section className="modal-form-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Temel Bilgiler</h4>
              </div>
              <div className="form-grid modal-form-grid modal-form-grid-12 category-modal-compact-grid">
                <div className="col-12 category-main-split">
                  <label className="field-group category-main-name-field">
                    <span>Kategori Adı<span className="modal-required">*</span></span>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(event) => applyNameChange(event.target.value)}
                      placeholder="Örn. İçecek"
                    />
                  </label>
                  <div className="field-group category-inline-checks category-storage-compact" role="group" aria-label="Saklama gereksinimi">
                    <span>Saklama Gereksinimi</span>
                    <div className="category-inline-checks-grid">
                      <label className={`category-check-field ${form.requiresColdChain ? 'is-checked' : ''}`}>
                        <span>Soğuk Zincir</span>
                        <span className="category-check-toggle">
                          <input
                            type="checkbox"
                            checked={form.requiresColdChain}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setForm((current) => ({
                                ...current,
                                requiresColdChain: checked,
                                requiresFreezer: checked ? false : current.requiresFreezer,
                              }));
                            }}
                          />
                          <span className="category-check-track" aria-hidden="true"></span>
                          <span className="category-check-knob" aria-hidden="true"></span>
                        </span>
                      </label>
                      <label className={`category-check-field ${form.requiresFreezer ? 'is-checked' : ''}`}>
                        <span>Dondurucu</span>
                        <span className="category-check-toggle">
                          <input
                            type="checkbox"
                            checked={form.requiresFreezer}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setForm((current) => ({
                                ...current,
                                requiresFreezer: checked,
                                requiresColdChain: checked ? false : current.requiresColdChain,
                              }));
                            }}
                          />
                          <span className="category-check-track" aria-hidden="true"></span>
                          <span className="category-check-knob" aria-hidden="true"></span>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <div className="modal-actions modal-actions-sticky"><button className="ghost-button" type="button" onClick={() => setIsModalOpen(false)}>İptal</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button></div>
        </form>
      </FormModal>
      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title={deleteTarget?.parentCategoryId ? 'Etiket Sil' : 'Kategori Sil'}
        description={deleteTarget ? (
          deleteTarget.parentCategoryId
            ? `${deleteTarget.name} etiketini silmek istediğinize emin misiniz?`
            : `${deleteTarget.name} kategorisini silmek istediğinize emin misiniz? Bağlı ürün çeşitleri varsa işlem engellenir.`
        ) : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            if (deleteTarget?.__virtual) {
              const parent = categoryById.get(String(deleteTarget.parentCategoryId || ''));
              if (!parent) throw new Error('Bağlı kategori bulunamadı.');
              const nextTags = parseExplicitTags(parent.etiketler)
                .filter((tag) => normalizeText(tag) !== normalizeText(deleteTarget.name));
              await categoryService.update(parent.id, {
                name: parent.name || '',
                code: parent.code || suggestUniqueCode(parent.name || '', categories, parent.id),
                slug: parent.slug || suggestUniqueSlug(parent.name || '', categories, parent.id),
                parentCategoryId: '',
                description: parent.description || '',
                isActive: parent.isActive !== false,
                icon: parent.icon || '',
                color: parent.color || '#2563eb',
                sortOrder: toOptionalSortOrder(parent.sortOrder),
                requiresColdChain: Boolean(parent.requiresColdChain),
                requiresFreezer: Boolean(parent.requiresFreezer),
                linkedSectionId: parent.linkedSectionId || '',
                linkedSectionNo: parent.linkedSectionNo || '',
                linkedSectionName: parent.linkedSectionName || '',
                storageStructure: parent.storageStructure || '',
                temperatureNote: parent.temperatureNote || '',
                etiketler: nextTags.join(', '),
              });
              setToast({ type: 'success', title: 'Kategoriler', message: 'Etiket silindi.' });
            } else {
              await categoryService.remove(deleteTarget.id);
              setToast({ type: 'success', title: 'Kategoriler', message: 'Kategori silindi.' });
            }
            await loadData();
          } catch (error) {
            setToast({ type: 'error', title: 'Kategoriler', message: error.message || 'Kayıt silinemedi.' });
          } finally {
            setDeleteTarget(null);
          }
        }}
        confirmText="Sil"
      />
      <FormModal
        isOpen={isTagModalOpen}
        title={editingItem ? 'Etiket Düzenle' : 'Yeni Etiket'}
        description="Etiketi bir ana kategoriye bağlı olarak oluşturun"
        headerIcon={<Tags size={20} />}
        onClose={() => {
          setIsTagModalOpen(false);
          if (!editingItem) resetForm();
        }}
        modalClassName="category-form-fit-modal app-modal-standard"
      >
        <form className="modal-form modal-structured-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll">
            <section className="modal-form-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Etiket Bilgileri</h4>
              </div>
              <div className="form-grid modal-form-grid modal-form-grid-12 category-modal-compact-grid">
                <label className="field-group col-6">
                  <span>Etiket Adı<span className="modal-required">*</span></span>
                  <input autoFocus value={form.name} onChange={(event) => applyNameChange(event.target.value)} placeholder="Örn. Gazlı İçecekler" />
                </label>
                <label className="field-group col-6">
                  <span>Üst Kategori<span className="modal-required">*</span></span>
                  <select value={form.parentCategoryId} onChange={(event) => setForm((current) => ({ ...current, parentCategoryId: event.target.value, categoryType: 'sub' }))} required>
                    <option value="">Üst kategori seçin</option>
                    {parentOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          </div>
          <div className="modal-actions modal-actions-sticky"><button className="ghost-button" type="button" onClick={() => setIsTagModalOpen(false)}>İptal</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button></div>
        </form>
      </FormModal>
    </div>
  );
}
