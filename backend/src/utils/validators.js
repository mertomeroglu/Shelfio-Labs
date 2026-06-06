import { AppError } from './appError.js';
import { normalizeUnit, CANONICAL_UNITS_LOWER } from './unitSystem.js';
import { resolveProductBaseUnit } from './productUnitQuality.js';


const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const hasValue = (value) => value !== undefined && value !== null && value !== '';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_DESK_CODES = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
const MAX_DEPARTMENT_LENGTH = 64;
const PIN_PATTERN = /^\d{4}$/;
const REGISTER_PIN_PATTERN = /^\d{4}$/;

const SEARCH_CHAR_MAP = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

export const normalizeSearchText = (value) => String(value || '')
  .replace(/[ÇçĞğIıİÖöŞşÜü]/g, (char) => SEARCH_CHAR_MAP[char] || char)
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const includesSearchText = (value, query) => {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText(value).includes(needle);
};

export const normalizeBoolean = (value, fallback = true) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return fallback;
};

export const requireFields = (payload, fields) => {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string') {
      if (!value.trim()) {
        throw new AppError(400, `${field} zorunludur`);
      }
      continue;
    }

    if (value === undefined || value === null) {
      throw new AppError(400, `${field} zorunludur`);
    }
  }
};

export const validateRole = (role) => {
  if (!['admin', 'user', 'viewer', 'cashier', 'depo_personeli', 'komisyon_b', 'komisyon_c', 'komisyon_v'].includes(role)) {
    throw new AppError(400, 'Geçersiz rol');
  }
};

const validateNonNegativeNumber = (value, fieldName, { allowZero = true } = {}) => {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new AppError(400, `${fieldName} geçersiz`);
  }

  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw new AppError(400, `${fieldName} geçersiz`);
  }
};

export const validateCategoryPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['name']);
  }

  if (payload.name !== undefined && !normalizeString(payload.name)) {
    throw new AppError(400, 'Kategori adı boş olamaz');
  }

  if (payload.code !== undefined && !normalizeString(payload.code)) {
    throw new AppError(400, 'Kategori kodu boş olamaz');
  }

  if (payload.code !== undefined && normalizeString(payload.code).length > 5) {
    throw new AppError(400, 'Kategori kodu en fazla 5 karakter olabilir');
  }

  if (payload.slug !== undefined && !normalizeString(payload.slug)) {
    throw new AppError(400, 'Kategori slug boş olamaz');
  }

  if (payload.sortOrder !== undefined) {
    validateNonNegativeNumber(payload.sortOrder, 'sortOrder');
  }
};

export const validateSupplierPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['name']);
  }

  if (payload.name !== undefined && !normalizeString(payload.name)) {
    throw new AppError(400, 'Tedarikçi adı boş olamaz');
  }
};

export const validateProductPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['name', 'sku', 'categoryId', 'barcode']);
  }

  if (payload.name !== undefined && !normalizeString(payload.name)) {
    throw new AppError(400, 'Ürün adı boş olamaz');
  }

  if (payload.brand !== undefined && !normalizeString(payload.brand)) {
    throw new AppError(400, 'Marka alanı boş olamaz');
  }

  if (payload.sku !== undefined && !normalizeString(payload.sku)) {
    throw new AppError(400, 'Ürün SKU alanı boş olamaz');
  }

  if (payload.categoryId !== undefined && !normalizeString(payload.categoryId)) {
    throw new AppError(400, 'categoryId zorunludur');
  }

  if (payload.barcode !== undefined) {
    const barcode = normalizeString(payload.barcode);
    if (!barcode) {
      throw new AppError(400, 'barcode zorunludur');
    }

    if (!/^\d{13}$/.test(barcode)) {
      throw new AppError(400, 'barcode 13 haneli sayisal formatta olmalidir');
    }
  }

  if (payload.criticalStock !== undefined) {
    validateNonNegativeNumber(payload.criticalStock, 'criticalStock');
  }

  if (payload.maxShelfStock !== undefined) {
    validateNonNegativeNumber(payload.maxShelfStock, 'maxShelfStock');
  }

  if (payload.purchasePrice !== undefined) {
    validateNonNegativeNumber(payload.purchasePrice, 'purchasePrice');
  }

  if (payload.salePrice !== undefined) {
    validateNonNegativeNumber(payload.salePrice, 'salePrice');
  }

  if (payload.unitsPerCase !== undefined) {
    validateNonNegativeNumber(payload.unitsPerCase, 'unitsPerCase', { allowZero: false });
  }

  if (payload.casesPerPallet !== undefined) {
    validateNonNegativeNumber(payload.casesPerPallet, 'casesPerPallet', { allowZero: false });
  }

  if (payload.unitsPerPallet !== undefined) {
    validateNonNegativeNumber(payload.unitsPerPallet, 'unitsPerPallet', { allowZero: false });
  }

  if (payload.averageDesi !== undefined) {
    validateNonNegativeNumber(payload.averageDesi, 'averageDesi');
  }

  if (payload.requiredStorageType !== undefined) {
    const value = normalizeString(payload.requiredStorageType).toLocaleLowerCase('tr-TR');
    const isValid = ['ortam', 'cold_chain', 'soguk_zincir', 'soguk zincir', 'freezer', 'dondurucu'].includes(value);
    if (!isValid) {
      throw new AppError(400, 'requiredStorageType gecersiz');
    }
  }

  if (payload.unit !== undefined) {
    const unit = normalizeString(payload.unit).toLocaleLowerCase('tr-TR');
    if (unit && !CANONICAL_UNITS_LOWER.includes(unit)) {
      throw new AppError(400, `Geçersiz birim: ${payload.unit}`);
    }
  }

  if (!partial || payload.tagId !== undefined || payload.selectedTagId !== undefined || payload.etiket !== undefined) {
    const labelRef = normalizeString(payload.tagId || payload.selectedTagId || payload.etiket);
    if (!labelRef) {
      throw new AppError(400, 'Ürün etiketi zorunludur');
    }
  }
};

export const validateLoginPayload = (payload) => {
  requireFields(payload, ['username', 'password']);
};

export const validateUserPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['username', 'password', 'name', 'role', 'registerPin']);
  }

  if (payload.username !== undefined && !normalizeString(payload.username)) {
    throw new AppError(400, 'Kullanıcı adı boş olamaz');
  }

  if (payload.name !== undefined && !normalizeString(payload.name)) {
    throw new AppError(400, 'Ad soyad boş olamaz');
  }

  if (payload.storeId !== undefined && !normalizeString(payload.storeId)) {
    throw new AppError(400, 'storeId boş olamaz');
  }

  if (payload.department !== undefined) {
    const department = normalizeString(payload.department);
    if (department && department.length > MAX_DEPARTMENT_LENGTH) {
      throw new AppError(400, 'Geçersiz departman');
    }
  }

  if (payload.role !== undefined) {
    validateRole(normalizeString(payload.role));
  }

  if (payload.assignedDeskCode !== undefined && payload.assignedDeskCode !== null && payload.assignedDeskCode !== '') {
    const code = normalizeString(payload.assignedDeskCode).toUpperCase();
    if (!VALID_DESK_CODES.includes(code)) {
      throw new AppError(400, 'Geçersiz kasa kodu');
    }
  }

  const role = payload.role !== undefined ? normalizeString(payload.role) : undefined;
  if (role === 'cashier' && payload.assignedDeskCode !== undefined) {
    const code = normalizeString(payload.assignedDeskCode).toUpperCase();
    if (!VALID_DESK_CODES.includes(code)) {
      throw new AppError(400, 'Kasiyer için geçerli kasa kodu zorunludur');
    }
  }

  if (hasValue(payload.password) && String(payload.password).trim().length < 4) {
    throw new AppError(400, 'Şifre en az 4 karakter olmalıdır');
  }

  if (payload.registerPin !== undefined && payload.registerPin !== null && payload.registerPin !== '') {
    if (!REGISTER_PIN_PATTERN.test(String(payload.registerPin))) {
      throw new AppError(400, 'Sicil no 4 haneli sayi olmalidir');
    }
  }
};

export const validateRegisterPayload = (payload) => {
  validateUserPayload(payload);
};

export const validateSettingsPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['systemName', 'businessName', 'defaultCritical', 'currency', 'dateFormat']);
  }

  if (payload.systemName !== undefined && !normalizeString(payload.systemName)) {
    throw new AppError(400, 'Sistem adı boş olamaz');
  }

  if (payload.businessName !== undefined && !normalizeString(payload.businessName)) {
    throw new AppError(400, 'İşletme adı boş olamaz');
  }

  if (payload.defaultCritical !== undefined) {
    validateNonNegativeNumber(payload.defaultCritical, 'defaultCritical');
  }

  if (payload.storeEmail !== undefined) {
    const storeEmail = normalizeString(payload.storeEmail).toLocaleLowerCase('tr-TR');
    if (storeEmail && !EMAIL_PATTERN.test(storeEmail)) {
      throw new AppError(400, 'Magaza iletisim e-posta adresi gecersiz');
    }
  }

  if (payload.notificationSoundVolume !== undefined) {
    const volume = Number(payload.notificationSoundVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) {
      throw new AppError(400, 'Bildirim ses seviyesi gecersiz');
    }
  }

  if (payload.notificationSound !== undefined) {
    const soundFile = normalizeString(payload.notificationSound);
    if (soundFile && (!/\.mp3$/i.test(soundFile) || /[\\/]/.test(soundFile))) {
      throw new AppError(400, 'Bildirim sesi gecersiz');
    }
  }

  if (payload.posPin !== undefined && payload.posPin !== null && payload.posPin !== '') {
    if (!PIN_PATTERN.test(String(payload.posPin))) {
      throw new AppError(400, 'PIN 4 haneli sayi olmalidir');
    }
  }

  if (payload.roleManagementPin !== undefined && payload.roleManagementPin !== null && payload.roleManagementPin !== '') {
    if (!PIN_PATTERN.test(String(payload.roleManagementPin))) {
      throw new AppError(400, 'Rol yonetimi PIN kodu 4 haneli sayi olmalidir');
    }
  }

  if (payload.deskPins !== undefined) {
    if (typeof payload.deskPins !== 'object' || payload.deskPins === null || Array.isArray(payload.deskPins)) {
      throw new AppError(400, 'deskPins gecersiz');
    }

    for (const code of VALID_DESK_CODES) {
      if (payload.deskPins[code] !== undefined && payload.deskPins[code] !== null && payload.deskPins[code] !== '') {
        if (!PIN_PATTERN.test(String(payload.deskPins[code]))) {
          throw new AppError(400, `${code} PIN kodu 4 haneli sayi olmalidir`);
        }
      }
    }
  }

  if (payload.customerRelations !== undefined) {
    if (typeof payload.customerRelations !== 'object' || payload.customerRelations === null || Array.isArray(payload.customerRelations)) {
      throw new AppError(400, 'customerRelations gecersiz');
    }

    if (payload.customerRelations.giftCards !== undefined) {
      if (!Array.isArray(payload.customerRelations.giftCards)) {
        throw new AppError(400, 'giftCards bir dizi olmalidir');
      }

      payload.customerRelations.giftCards.forEach((card, index) => {
        if (!card || typeof card !== 'object' || Array.isArray(card)) {
          throw new AppError(400, `giftCards[${index}] gecersiz`);
        }

        if (!normalizeString(card.code)) {
          throw new AppError(400, `giftCards[${index}].code zorunludur`);
        }

        if (!normalizeString(card.name)) {
          throw new AppError(400, `giftCards[${index}].name zorunludur`);
        }

        const valueType = normalizeString(card.valueType);
        if (valueType && !['amount', 'percentage'].includes(valueType)) {
          throw new AppError(400, `giftCards[${index}].valueType gecersiz`);
        }

        const value = Number(card.value);
        if (Number.isNaN(value) || value <= 0) {
          throw new AppError(400, `giftCards[${index}].value sifirdan buyuk olmalidir`);
        }

        if (Array.isArray(card.allowedCategoryIds) === false && card.allowedCategoryIds !== undefined) {
          throw new AppError(400, `giftCards[${index}].allowedCategoryIds dizi olmalidir`);
        }

        if (card.expiresAt !== undefined && normalizeString(card.expiresAt) && !/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(card.expiresAt))) {
          throw new AppError(400, `giftCards[${index}].expiresAt gecersiz`);
        }

        const usageLimit = Number(card.usageLimit ?? card.maxUsage ?? 1);
        if (Number.isNaN(usageLimit) || usageLimit < 1) {
          throw new AppError(400, `giftCards[${index}].usageLimit en az 1 olmalidir`);
        }

        if (card.usedCount !== undefined) {
          const usedCount = Number(card.usedCount);
          if (Number.isNaN(usedCount) || usedCount < 0) {
            throw new AppError(400, `giftCards[${index}].usedCount gecersiz`);
          }
        }

        if (card.remainingUsage !== undefined) {
          const remainingUsage = Number(card.remainingUsage);
          if (Number.isNaN(remainingUsage) || remainingUsage < 0) {
            throw new AppError(400, `giftCards[${index}].remainingUsage gecersiz`);
          }
        }
      });
    }

    if (payload.customerRelations.campaigns !== undefined) {
      if (!Array.isArray(payload.customerRelations.campaigns)) {
        throw new AppError(400, 'campaigns bir dizi olmalidir');
      }

      payload.customerRelations.campaigns.forEach((campaign, index) => {
        if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
          throw new AppError(400, `campaigns[${index}] gecersiz`);
        }

        if (!normalizeString(campaign.name)) {
          throw new AppError(400, `campaigns[${index}].name zorunludur`);
        }

        const discountRate = Number(campaign.discountRate);
        if (Number.isNaN(discountRate) || discountRate <= 0 || discountRate > 100) {
          throw new AppError(400, `campaigns[${index}].discountRate 1-100 araliginda olmalidir`);
        }

        const type = normalizeString(campaign.type || campaign.campaignType || 'general').toLowerCase();
        if (!['general', 'category', 'product', 'brand', 'dynamic'].includes(type)) {
          throw new AppError(400, `campaigns[${index}].type gecersiz`);
        }

        const isIndefinite = normalizeBoolean(campaign.isIndefinite, false);
        if (!isIndefinite && !normalizeString(campaign.startsAt || campaign.startAt)) {
          throw new AppError(400, `campaigns[${index}].startsAt zorunludur`);
        }

        if (!isIndefinite && !normalizeString(campaign.endsAt || campaign.endAt)) {
          throw new AppError(400, `campaigns[${index}].endsAt zorunludur`);
        }

        if (campaign.priority !== undefined) {
          validateNonNegativeNumber(campaign.priority, `campaigns[${index}].priority`);
        }

        if (campaign.targetCategoryIds !== undefined && !Array.isArray(campaign.targetCategoryIds)) {
          throw new AppError(400, `campaigns[${index}].targetCategoryIds dizi olmalidir`);
        }

        if (campaign.targetCategoryLabelIds !== undefined && !Array.isArray(campaign.targetCategoryLabelIds)) {
          throw new AppError(400, `campaigns[${index}].targetCategoryLabelIds dizi olmalidir`);
        }

        if (campaign.targetCategoryLabels !== undefined && !Array.isArray(campaign.targetCategoryLabels)) {
          throw new AppError(400, `campaigns[${index}].targetCategoryLabels dizi olmalidir`);
        }

        if (campaign.targetProductIds !== undefined && !Array.isArray(campaign.targetProductIds)) {
          throw new AppError(400, `campaigns[${index}].targetProductIds dizi olmalidir`);
        }

        if (campaign.targetBrands !== undefined && !Array.isArray(campaign.targetBrands)) {
          throw new AppError(400, `campaigns[${index}].targetBrands dizi olmalidir`);
        }

        if (campaign.trigger !== undefined && (typeof campaign.trigger !== 'object' || campaign.trigger === null || Array.isArray(campaign.trigger))) {
          throw new AppError(400, `campaigns[${index}].trigger gecersiz`);
        }

        if (campaign.actions !== undefined && (typeof campaign.actions !== 'object' || campaign.actions === null || Array.isArray(campaign.actions))) {
          throw new AppError(400, `campaigns[${index}].actions gecersiz`);
        }
      });
    }

    if (payload.customerRelations.automationCenter !== undefined) {
      const automation = payload.customerRelations.automationCenter;
      if (typeof automation !== 'object' || automation === null || Array.isArray(automation)) {
        throw new AppError(400, 'automationCenter gecersiz');
      }

      if (automation.rules !== undefined && !Array.isArray(automation.rules)) {
        throw new AppError(400, 'automationCenter.rules bir dizi olmalidir');
      }

      if (Array.isArray(automation.rules)) {
        automation.rules.forEach((rule, index) => {
          if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
            throw new AppError(400, `automationCenter.rules[${index}] gecersiz`);
          }
          if (!normalizeString(rule.name)) {
            throw new AppError(400, `automationCenter.rules[${index}].name zorunludur`);
          }
        });
      }
    }
  }

  if (payload.weeklySchedule !== undefined) {
    if (!Array.isArray(payload.weeklySchedule)) {
      throw new AppError(400, 'weeklySchedule bir dizi olmalidir');
    }

    payload.weeklySchedule.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new AppError(400, `weeklySchedule[${index}] gecersiz`);
      }

      if (!normalizeString(row.dayKey)) {
        throw new AppError(400, `weeklySchedule[${index}].dayKey zorunludur`);
      }

      if (row.opensAt !== undefined && normalizeString(row.opensAt) && !/^\d{2}:\d{2}$/.test(String(row.opensAt))) {
        throw new AppError(400, `weeklySchedule[${index}].opensAt HH:mm formatinda olmalidir`);
      }

      if (row.closesAt !== undefined && normalizeString(row.closesAt) && !/^\d{2}:\d{2}$/.test(String(row.closesAt))) {
        throw new AppError(400, `weeklySchedule[${index}].closesAt HH:mm formatinda olmalidir`);
      }
    });
  }

  if (payload.specialDays !== undefined) {
    if (!Array.isArray(payload.specialDays)) {
      throw new AppError(400, 'specialDays bir dizi olmalidir');
    }

    payload.specialDays.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new AppError(400, `specialDays[${index}] gecersiz`);
      }

      const date = normalizeString(row.date);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new AppError(400, `specialDays[${index}].date YYYY-MM-DD formatinda olmalidir`);
      }

      if (row.opensAt !== undefined && normalizeString(row.opensAt) && !/^\d{2}:\d{2}$/.test(String(row.opensAt))) {
        throw new AppError(400, `specialDays[${index}].opensAt HH:mm formatinda olmalidir`);
      }

      if (row.closesAt !== undefined && normalizeString(row.closesAt) && !/^\d{2}:\d{2}$/.test(String(row.closesAt))) {
        throw new AppError(400, `specialDays[${index}].closesAt HH:mm formatinda olmalidir`);
      }
    });
  }

  if (payload.holidayMode !== undefined && typeof payload.holidayMode !== 'boolean') {
    throw new AppError(400, 'holidayMode boolean olmalidir');
  }

  if (payload.logisticsTariffs !== undefined) {
    if (!Array.isArray(payload.logisticsTariffs)) {
      throw new AppError(400, 'logisticsTariffs bir dizi olmalidir');
    }

    payload.logisticsTariffs.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new AppError(400, `logisticsTariffs[${index}] gecersiz`);
      }

      if (!normalizeString(row.cargoTypeCode)) {
        throw new AppError(400, `logisticsTariffs[${index}].cargoTypeCode zorunludur`);
      }

      if (!normalizeString(row.cargoTypeName)) {
        throw new AppError(400, `logisticsTariffs[${index}].cargoTypeName zorunludur`);
      }

      validateNonNegativeNumber(row.basePriceTl, `logisticsTariffs[${index}].basePriceTl`);

      if (row.caseQtyMin !== undefined && row.caseQtyMin !== null && row.caseQtyMin !== '') {
        validateNonNegativeNumber(row.caseQtyMin, `logisticsTariffs[${index}].caseQtyMin`);
      }

      if (row.caseQtyMax !== undefined && row.caseQtyMax !== null && row.caseQtyMax !== '') {
        validateNonNegativeNumber(row.caseQtyMax, `logisticsTariffs[${index}].caseQtyMax`);
      }

      if (row.desiMax !== undefined && row.desiMax !== null && row.desiMax !== '') {
        validateNonNegativeNumber(row.desiMax, `logisticsTariffs[${index}].desiMax`);
      }

      if (row.desiMin !== undefined && row.desiMin !== null && row.desiMin !== '') {
        validateNonNegativeNumber(row.desiMin, `logisticsTariffs[${index}].desiMin`);
      }

      if (row.incrementalPricePerCase !== undefined && row.incrementalPricePerCase !== null && row.incrementalPricePerCase !== '') {
        validateNonNegativeNumber(row.incrementalPricePerCase, `logisticsTariffs[${index}].incrementalPricePerCase`);
      }

      if (row.incrementalPricePerDesi !== undefined && row.incrementalPricePerDesi !== null && row.incrementalPricePerDesi !== '') {
        validateNonNegativeNumber(row.incrementalPricePerDesi, `logisticsTariffs[${index}].incrementalPricePerDesi`);
      }
    });
  }

  if (payload.roleDepartmentAssignments !== undefined) {
    if (
      typeof payload.roleDepartmentAssignments !== 'object'
      || payload.roleDepartmentAssignments === null
      || Array.isArray(payload.roleDepartmentAssignments)
    ) {
      throw new AppError(400, 'roleDepartmentAssignments gecersiz');
    }

    Object.entries(payload.roleDepartmentAssignments).forEach(([roleKey, departments]) => {
      if (!normalizeString(roleKey)) {
        throw new AppError(400, 'roleDepartmentAssignments rol anahtari gecersiz');
      }

      if (!Array.isArray(departments)) {
        throw new AppError(400, `roleDepartmentAssignments.${roleKey} bir dizi olmalidir`);
      }
    });
  }

  if (payload.departments !== undefined) {
    if (!Array.isArray(payload.departments)) {
      throw new AppError(400, 'departments bir dizi olmalidir');
    }

    payload.departments.forEach((department, index) => {
      if (!department || typeof department !== 'object' || Array.isArray(department)) {
        throw new AppError(400, `departments[${index}] gecersiz`);
      }
      if (!normalizeString(department.name) || normalizeString(department.name).length > MAX_DEPARTMENT_LENGTH) {
        throw new AppError(400, `departments[${index}].name gecersiz`);
      }
    });
  }

  if (payload.departmentPermissionRules !== undefined) {
    if (
      typeof payload.departmentPermissionRules !== 'object'
      || payload.departmentPermissionRules === null
      || Array.isArray(payload.departmentPermissionRules)
    ) {
      throw new AppError(400, 'departmentPermissionRules gecersiz');
    }

    Object.entries(payload.departmentPermissionRules).forEach(([departmentKey, rule]) => {
      if (!normalizeString(departmentKey)) {
        throw new AppError(400, 'departmentPermissionRules anahtari gecersiz');
      }
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new AppError(400, `departmentPermissionRules.${departmentKey} gecersiz`);
      }
      if (rule.allow !== undefined && !Array.isArray(rule.allow)) {
        throw new AppError(400, `departmentPermissionRules.${departmentKey}.allow bir dizi olmalidir`);
      }
      if (rule.deny !== undefined && !Array.isArray(rule.deny)) {
        throw new AppError(400, `departmentPermissionRules.${departmentKey}.deny bir dizi olmalidir`);
      }
    });
  }
};

export const validateStockMovementPayload = (payload, { type = 'IN' } = {}) => {
  requireFields(payload, ['productId']);

  if (!normalizeString(payload.productId)) {
    throw new AppError(400, 'productId zorunludur');
  }

  if (type === 'ADJUSTMENT') {
    if (!hasValue(payload.targetQuantity) && !hasValue(payload.qty)) {
      throw new AppError(400, 'targetQuantity zorunludur');
    }

    validateNonNegativeNumber(hasValue(payload.targetQuantity) ? payload.targetQuantity : payload.qty, 'targetQuantity');
    return;
  }

  requireFields(payload, ['qty']);
  const qty = Number(payload.qty);
  if (Number.isNaN(qty) || qty <= 0) {
    throw new AppError(400, 'Miktar sıfırdan büyük olmalıdır');
  }

  if (payload.location !== undefined && !['depo', 'reyon'].includes(normalizeString(payload.location))) {
    throw new AppError(400, 'Geçersiz stok konumu');
  }

  if (type === 'IN' && normalizeString(payload.entryType) === 'receipt') {
    requireFields(payload, [
      'supplierId',
      'batchNo',
      'purchasePrice',
      'receiptDate',
      'warehouseLocation',
      'acceptedCaseCount',
      'irsaliyeNo',
      'acceptanceType',
      'productionDate',
    ]);

    if (!normalizeString(payload.supplierId)) {
      throw new AppError(400, 'supplierId zorunludur');
    }

    if (!normalizeString(payload.batchNo)) {
      throw new AppError(400, 'batchNo zorunludur');
    }

    const skt = normalizeString(payload.skt);
    if (skt && !/^\d{4}-\d{2}-\d{2}$/.test(skt)) {
      throw new AppError(400, 'skt YYYY-MM-DD formatinda olmalidir');
    }

    const receiptDate = normalizeString(payload.receiptDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
      throw new AppError(400, 'receiptDate YYYY-MM-DD formatinda olmalidir');
    }

    const productionDate = normalizeString(payload.productionDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
      throw new AppError(400, 'productionDate YYYY-MM-DD formatinda olmalidir');
    }

    if (!normalizeString(payload.irsaliyeNo)) {
      throw new AppError(400, 'irsaliyeNo zorunludur');
    }

    const acceptanceType = normalizeString(payload.acceptanceType);
    if (!['satın alma', 'iade giriş', 'transfer giriş', 'sayım farkı'].includes(acceptanceType)) {
      throw new AppError(400, 'acceptanceType gecersiz');
    }

    validateNonNegativeNumber(payload.acceptedCaseCount, 'acceptedCaseCount', { allowZero: false });

    validateNonNegativeNumber(payload.purchasePrice, 'purchasePrice', { allowZero: false });

    if (!normalizeString(payload.warehouseLocation)) {
      throw new AppError(400, 'warehouseLocation zorunludur');
    }
  }

  if (type === 'OUT') {
    const outputType = normalizeString(payload.outputType);
    if (outputType && !['sevkiyat', 'mağaza içi tüketim', 'numune', 'manuel düzeltme', 'fire', 'transfer çıkışı'].includes(outputType)) {
      throw new AppError(400, 'outputType gecersiz');
    }

    const sourceLocationType = normalizeString(payload.sourceLocationType);
    if (sourceLocationType && !['depo', 'reyon'].includes(sourceLocationType)) {
      throw new AppError(400, 'sourceLocationType gecersiz');
    }
  }
};

export const validateStockTransferPayload = (payload) => {
  requireFields(payload, ['productId', 'qty', 'fromLocation', 'toLocation']);

  const qty = Number(payload.qty);
  if (Number.isNaN(qty) || qty <= 0) {
    throw new AppError(400, 'Miktar sıfırdan büyük olmalıdır');
  }

  const fromLocation = normalizeString(payload.fromLocation);
  const toLocation = normalizeString(payload.toLocation);
  if (!['depo', 'reyon'].includes(fromLocation) || !['depo', 'reyon'].includes(toLocation)) {
    throw new AppError(400, 'Geçersiz transfer konumu');
  }

  if (fromLocation === toLocation) {
    throw new AppError(400, 'Kaynak ve hedef konum aynı olamaz');
  }
};

export const sanitizeCategoryInput = (payload) => ({
  name: normalizeString(payload.name),
  code: normalizeString(payload.code),
  slug: normalizeString(payload.slug),
  parentCategoryId: normalizeString(payload.parentCategoryId),
  etiketler: normalizeString(payload.etiketler),
  linkedSectionNo: normalizeString(payload.linkedSectionNo),
  linkedSectionName: normalizeString(payload.linkedSectionName),
  storageStructure: normalizeString(payload.storageStructure),
  temperatureNote: normalizeString(payload.temperatureNote),
  sortOrder: hasValue(payload.sortOrder) ? Number(payload.sortOrder) : undefined,
  icon: normalizeString(payload.icon),
  color: normalizeString(payload.color),
  requiresColdChain: normalizeBoolean(payload.requiresColdChain, false),
  requiresFreezer: normalizeBoolean(payload.requiresFreezer, false),
  description: normalizeString(payload.description),
  isActive: normalizeBoolean(payload.isActive, true),
});

export const sanitizeSupplierInput = (payload) => ({
  name: normalizeString(payload.name),
  contactName: normalizeString(payload.contactName),
  phone: normalizeString(payload.phone),
  email: normalizeString(payload.email),
  address: normalizeString(payload.address),
  isActive: normalizeBoolean(payload.isActive, true),
  tedarikciTuru: normalizeString(payload.tedarikciTuru),
  website: normalizeString(payload.website),
  kategoriler: normalizeString(payload.kategoriler),
});

export const sanitizeProductInput = (payload) => ({
  sku: normalizeString(payload.sku),
  barcode: normalizeString(payload.barcode),
  name: normalizeString(payload.name),
  brand: normalizeString(payload.brand),
  categoryId: normalizeString(payload.categoryId),
  supplierId: normalizeString(payload.primarySupplierId || payload.supplierId),
  sectionId: normalizeString(payload.sectionId),
  shelfSide: normalizeString(payload.shelfSide),
  shelfNo: hasValue(payload.shelfNo) ? Number(payload.shelfNo) : undefined,
  shelfLevel: hasValue(payload.shelfLevel) ? Number(payload.shelfLevel) : undefined,
  depotLocationCode: normalizeString(payload.depotLocationCode || payload.defaultWarehouseLocationCode || payload.physicalLocationCode),
  physicalLocationCode: normalizeString(payload.physicalLocationCode || payload.depotLocationCode || payload.defaultWarehouseLocationCode),
  defaultWarehouseLocationCode: normalizeString(payload.defaultWarehouseLocationCode || payload.depotLocationCode || payload.physicalLocationCode),
  requiredStorageType: (() => {
    const raw = normalizeString(payload.requiredStorageType).toLocaleLowerCase('tr-TR');
    if (!raw || raw === 'ortam') return 'Ortam';
    if (['cold_chain', 'soguk_zincir', 'soguk zincir'].includes(raw)) return 'cold_chain';
    if (['freezer', 'dondurucu'].includes(raw)) return 'freezer';
    return undefined;
  })(),
  unit: resolveProductBaseUnit({
    name: payload.name,
    etiket: normalizeString(payload.etiket || payload.selectedTagId || payload.tagId),
    unit: normalizeUnit(payload.unit, normalizeString(payload.etiket || payload.selectedTagId || payload.tagId)),
  }).unit,
  purchasePrice: payload.purchasePrice !== undefined ? Number(payload.purchasePrice) : 0,
  salePrice: payload.salePrice !== undefined ? Number(payload.salePrice) : 0,
  etiket: normalizeString(payload.etiket || payload.selectedTagId || payload.tagId),
  tagId: normalizeString(payload.tagId || payload.selectedTagId || payload.etiket),
  placementPriority: normalizeString(payload.placementPriority),
  averageDesi: payload.averageDesi !== undefined ? Number(payload.averageDesi) : undefined,
  criticalStock: payload.criticalStock !== undefined ? Number(payload.criticalStock) : undefined,
  maxShelfStock: payload.maxShelfStock !== undefined ? Number(payload.maxShelfStock) : undefined,
  maxStock: payload.maxStock !== undefined ? Number(payload.maxStock) : undefined,
  unitsPerCase: payload.unitsPerCase !== undefined ? Number(payload.unitsPerCase) : undefined,
  casesPerPallet: payload.casesPerPallet !== undefined ? Number(payload.casesPerPallet) : undefined,
  unitsPerPallet: payload.unitsPerPallet !== undefined ? Number(payload.unitsPerPallet) : undefined,
  minimumOrderCaseQty: payload.minimumOrderCaseQty !== undefined ? Number(payload.minimumOrderCaseQty) : undefined,
  catalogVisibility: normalizeString(payload.catalogVisibility),
  registerOnOrder: payload.registerOnOrder !== undefined ? normalizeBoolean(payload.registerOnOrder, false) : undefined,
  isListed: payload.isListed !== undefined ? normalizeBoolean(payload.isListed, true) : undefined,
  orderActivatedStatus: normalizeString(payload.orderActivatedStatus),
  isActive: normalizeBoolean(payload.isActive, true),
});

export const sanitizeUserInput = (payload) => ({
  username: normalizeString(payload.username),
  password: hasValue(payload.password) ? String(payload.password) : '',
  name: normalizeString(payload.name),
  role: normalizeString(payload.role),
  department: normalizeString(payload.department),
  storeId: normalizeString(payload.storeId) || 'store-main',
  email: normalizeString(payload.email),
  isActive: normalizeBoolean(payload.isActive, true),
  assignedDeskCode: normalizeString(payload.assignedDeskCode).toUpperCase(),
  registerPin: normalizeString(payload.registerPin),
});

export const sanitizeRegisterInput = (payload) => ({
  username: normalizeString(payload.username),
  password: String(payload.password),
  name: normalizeString(payload.name),
  role: normalizeString(payload.role),
  storeId: normalizeString(payload.storeId) || 'store-main',
  email: normalizeString(payload.email),
  isActive: normalizeBoolean(payload.isActive, true),
  assignedDeskCode: normalizeString(payload.assignedDeskCode).toUpperCase(),
  registerPin: normalizeString(payload.registerPin),
});

export const sanitizeMovementInput = (payload) => ({
  productId: normalizeString(payload.productId),
  supplierId: normalizeString(payload.supplierId),
  qty: hasValue(payload.qty) ? Number(payload.qty) : undefined,
  targetQuantity: hasValue(payload.targetQuantity) ? Number(payload.targetQuantity) : undefined,
  entryType: normalizeString(payload.entryType),
  batchNo: normalizeString(payload.batchNo),
  skt: normalizeString(payload.skt),
  purchasePrice: hasValue(payload.purchasePrice) ? Number(payload.purchasePrice) : undefined,
  receiptDate: normalizeString(payload.receiptDate),
  warehouseLocation: normalizeString(payload.warehouseLocation),
  acceptedCaseCount: hasValue(payload.acceptedCaseCount) ? Number(payload.acceptedCaseCount) : undefined,
  irsaliyeNo: normalizeString(payload.irsaliyeNo),
  acceptanceType: normalizeString(payload.acceptanceType),
  productionDate: normalizeString(payload.productionDate),
  acceptanceNote: normalizeString(payload.acceptanceNote),
  outputType: normalizeString(payload.outputType),
  sourceLocationType: normalizeString(payload.sourceLocationType),
  sourceLocationCode: normalizeString(payload.sourceLocationCode),
  userNote: normalizeString(payload.userNote),
  approvalRequired: normalizeBoolean(payload.approvalRequired, false),
  note: normalizeString(payload.note),
  reasonCode: normalizeString(payload.reasonCode),
  reasonLabel: normalizeString(payload.reasonLabel),
  location: normalizeString(payload.location),
  fromLocation: normalizeString(payload.fromLocation),
  toLocation: normalizeString(payload.toLocation),
  referenceNo: normalizeString(payload.referenceNo),
  transferRequestId: normalizeString(payload.transferRequestId),
  transferRequestStatus: normalizeString(payload.transferRequestStatus),
});

export const sanitizeSettingsInput = (payload) => ({
  systemName: normalizeString(payload.systemName),
  businessName: normalizeString(payload.businessName),
  companyName: normalizeString(payload.companyName || payload.businessName),
  defaultCritical: payload.defaultCritical !== undefined ? Number(payload.defaultCritical) : undefined,
  currency: normalizeString(payload.currency),
  dateFormat: normalizeString(payload.dateFormat),
  timezone: normalizeString(payload.timezone) || 'Europe/Istanbul',
  dashboardMessage: normalizeString(payload.dashboardMessage),
  storeName: normalizeString(payload.storeName),
  branchCode: normalizeString(payload.branchCode),
  storeAddress: normalizeString(payload.storeAddress),
  storePhone: normalizeString(payload.storePhone),
  storeEmail: normalizeString(payload.storeEmail).toLocaleLowerCase('tr-TR'),
  taxNumber: normalizeString(payload.taxNumber),
  storeLogo: payload.storeLogo !== undefined ? normalizeString(payload.storeLogo) : undefined,
  notificationSoundEnabled: payload.notificationSoundEnabled !== undefined ? normalizeBoolean(payload.notificationSoundEnabled, true) : undefined,
  notificationSoundVolume: payload.notificationSoundVolume !== undefined
    ? Math.max(0, Math.min(100, Math.round(Number(payload.notificationSoundVolume) || 0)))
    : undefined,
  notificationSound: payload.notificationSound !== undefined ? normalizeString(payload.notificationSound) : undefined,
  openingTime: normalizeString(payload.openingTime) || '10:00',
  closingTime: normalizeString(payload.closingTime) || '22:00',
  closedDays: Array.isArray(payload.closedDays) ? payload.closedDays : [],
  holidayMode: normalizeBoolean(payload.holidayMode, false),
  logisticsTariffs: Array.isArray(payload.logisticsTariffs)
    ? payload.logisticsTariffs
      .map((row, index) => ({
        id: normalizeString(row?.id) || `cargo-tariff-${Date.now()}-${index}`,
        cargoTypeCode: normalizeString(row?.cargoTypeCode).toLowerCase(),
        cargoTypeName: normalizeString(row?.cargoTypeName),
        deliveryTarget: normalizeString(row?.deliveryTarget),
        storageCompatibility: normalizeString(row?.storageCompatibility),
        distanceType: normalizeString(row?.distanceType) || 'intercity',
        pricingUnit: normalizeString(row?.pricingUnit) || 'case',
        caseQtyMin: hasValue(row?.caseQtyMin) ? Number(row.caseQtyMin) : 1,
        caseQtyMax: hasValue(row?.caseQtyMax) ? Number(row.caseQtyMax) : null,
        desiMin: hasValue(row?.desiMin) ? Number(row.desiMin) : 0,
        desiMax: hasValue(row?.desiMax) ? Number(row.desiMax) : null,
        basePriceTl: hasValue(row?.basePriceTl) ? Number(row.basePriceTl) : 0,
        incrementalPricePerCase: hasValue(row?.incrementalPricePerCase) ? Number(row.incrementalPricePerCase) : null,
        incrementalPricePerDesi: hasValue(row?.incrementalPricePerDesi) ? Number(row.incrementalPricePerDesi) : null,
        isColdChain: normalizeBoolean(row?.isColdChain, false),
        isFrozenChain: normalizeBoolean(row?.isFrozenChain, false),
        isInternalTransfer: normalizeBoolean(row?.isInternalTransfer, false),
        isActive: normalizeBoolean(row?.isActive, true),
        notes: normalizeString(row?.notes),
      }))
      .filter((row) => row.cargoTypeCode && row.cargoTypeName)
    : undefined,
  weeklySchedule: Array.isArray(payload.weeklySchedule)
    ? payload.weeklySchedule.map((row) => ({
      dayKey: normalizeString(row?.dayKey),
      opensAt: normalizeString(row?.opensAt) || '10:00',
      closesAt: normalizeString(row?.closesAt) || '22:00',
      isClosed: normalizeBoolean(row?.isClosed, false),
    }))
    : undefined,
  specialDays: Array.isArray(payload.specialDays)
    ? payload.specialDays
      .map((row, index) => ({
        id: normalizeString(row?.id) || `special-day-${Date.now()}-${index}`,
        date: normalizeString(row?.date),
        opensAt: normalizeString(row?.opensAt) || '10:00',
        closesAt: normalizeString(row?.closesAt) || '22:00',
        isClosed: normalizeBoolean(row?.isClosed, false),
        note: normalizeString(row?.note),
      }))
      .filter((row) => row.date)
    : undefined,
  posPin: payload.posPin !== undefined ? String(payload.posPin) : undefined,
  roleManagementPin: payload.roleManagementPin !== undefined ? String(payload.roleManagementPin) : undefined,
  deskPins: payload.deskPins && typeof payload.deskPins === 'object' ? {
    B1: payload.deskPins.B1 !== undefined ? String(payload.deskPins.B1) : undefined,
    B2: payload.deskPins.B2 !== undefined ? String(payload.deskPins.B2) : undefined,
    B3: payload.deskPins.B3 !== undefined ? String(payload.deskPins.B3) : undefined,
    B4: payload.deskPins.B4 !== undefined ? String(payload.deskPins.B4) : undefined,
    B5: payload.deskPins.B5 !== undefined ? String(payload.deskPins.B5) : undefined,
    B6: payload.deskPins.B6 !== undefined ? String(payload.deskPins.B6) : undefined,
    B7: payload.deskPins.B7 !== undefined ? String(payload.deskPins.B7) : undefined,
    B8: payload.deskPins.B8 !== undefined ? String(payload.deskPins.B8) : undefined,
  } : undefined,
  roleDefinitions: Array.isArray(payload.roleDefinitions) ? payload.roleDefinitions : undefined,
  roleDepartmentAssignments: payload.roleDepartmentAssignments && typeof payload.roleDepartmentAssignments === 'object' && !Array.isArray(payload.roleDepartmentAssignments)
    ? Object.fromEntries(
      Object.entries(payload.roleDepartmentAssignments).map(([roleKey, departments]) => [
        normalizeString(roleKey),
        Array.isArray(departments)
          ? departments.map((item) => normalizeString(item)).filter(Boolean)
          : [],
      ])
    )
    : undefined,
  departments: Array.isArray(payload.departments)
    ? payload.departments.map((department, index) => ({
      id: normalizeString(department?.id) || `department-${index + 1}`,
      name: normalizeString(department?.name),
      description: normalizeString(department?.description),
      isActive: department?.isActive !== false,
      updatedAt: normalizeString(department?.updatedAt),
    })).filter((department) => department.name)
    : undefined,
  departmentPermissionRules: payload.departmentPermissionRules && typeof payload.departmentPermissionRules === 'object' && !Array.isArray(payload.departmentPermissionRules)
    ? Object.fromEntries(
      Object.entries(payload.departmentPermissionRules).map(([departmentKey, rule]) => [
        normalizeString(departmentKey),
        {
          allow: Array.isArray(rule?.allow)
            ? rule.allow.map((item) => normalizeString(item)).filter(Boolean)
            : [],
          deny: Array.isArray(rule?.deny)
            ? rule.deny.map((item) => normalizeString(item)).filter(Boolean)
            : [],
        },
      ])
    )
    : undefined,
  customerRelations: payload.customerRelations && typeof payload.customerRelations === 'object' ? {
    giftCards: Array.isArray(payload.customerRelations.giftCards)
      ? payload.customerRelations.giftCards.map((card, index) => {
        const usageLimitSource = hasValue(card?.usageLimit) ? Number(card.usageLimit) : Number(card?.maxUsage ?? 1);
        const usageLimit = Number.isFinite(usageLimitSource) && usageLimitSource >= 1 ? Math.floor(usageLimitSource) : 1;
        const usedCountSource = hasValue(card?.usedCount) ? Number(card.usedCount) : 0;
        const usedCount = Number.isFinite(usedCountSource) && usedCountSource >= 0 ? Math.floor(usedCountSource) : 0;
        const remainingUsageSource = hasValue(card?.remainingUsage) ? Number(card.remainingUsage) : Number.NaN;
        const remainingUsage = Number.isFinite(remainingUsageSource)
          ? Math.max(0, Math.min(usageLimit, Math.floor(remainingUsageSource)))
          : Math.max(0, usageLimit - usedCount);

        return {
          id: normalizeString(card?.id) || `giftcard-${Date.now()}-${index}`,
          code: normalizeString(card?.code).toUpperCase(),
          name: normalizeString(card?.name),
          valueType: normalizeString(card?.valueType) === 'percentage' ? 'percentage' : 'amount',
          value: hasValue(card?.value) ? Number(card.value) : 0,
          usageLimit,
          maxUsage: usageLimit,
          usedCount: Math.min(usedCount, usageLimit),
          remainingUsage,
          allowedCategoryIds: Array.isArray(card?.allowedCategoryIds)
            ? card.allowedCategoryIds.map((id) => normalizeString(id)).filter(Boolean)
            : [],
          rewardMode: normalizeString(card?.rewardMode || 'none') || 'none',
          minSpendForReward: hasValue(card?.minSpendForReward) ? Number(card.minSpendForReward) : 0,
          loyaltyPointCost: hasValue(card?.loyaltyPointCost) ? Number(card.loyaltyPointCost) : 0,
          expiresAt: normalizeString(card?.expiresAt),
          isActive: normalizeBoolean(card?.isActive, true),
          createdAt: normalizeString(card?.createdAt) || new Date().toISOString(),
        };
      })
      : [],
    campaigns: Array.isArray(payload.customerRelations.campaigns)
      ? payload.customerRelations.campaigns.map((campaign, index) => ({
        id: normalizeString(campaign?.id) || `campaign-${Date.now()}-${index}`,
        name: normalizeString(campaign?.name),
        type: normalizeString(campaign?.type || campaign?.campaignType || 'general').toLowerCase() || 'general',
        discountRate: hasValue(campaign?.discountRate) ? Number(campaign.discountRate) : 0,
        startsAt: normalizeString(campaign?.startsAt || campaign?.startAt),
        endsAt: normalizeString(campaign?.endsAt || campaign?.endAt),
        isIndefinite: normalizeBoolean(campaign?.isIndefinite, false),
        priority: hasValue(campaign?.priority) ? Number(campaign.priority) : 0,
        status: normalizeString(campaign?.status || (campaign?.isActive === false ? 'paused' : 'active')).toLowerCase() || 'active',
        conflictPolicy: (() => {
          const raw = normalizeString(campaign?.conflictPolicy || 'best_price')
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
          if (['highest_priority', 'priority', 'priority_wins', 'priority_first'].includes(raw)) return 'highest_priority';
          if (['higher_discount_wins', 'highest_discount', 'highest_discount_wins', 'lowest_price', 'lowest_effective_price', 'customer_best_price', 'best', 'best_price'].includes(raw)) return 'best_price';
          return 'best_price';
        })(),
        targetCategoryIds: Array.isArray(campaign?.targetCategoryIds)
          ? campaign.targetCategoryIds.map((id) => normalizeString(id)).filter(Boolean)
          : [],
        targetCategoryLabelIds: Array.isArray(campaign?.targetCategoryLabelIds)
          ? campaign.targetCategoryLabelIds.map((id) => normalizeString(id)).filter(Boolean)
          : [],
        targetCategoryLabels: Array.isArray(campaign?.targetCategoryLabels)
          ? campaign.targetCategoryLabels.map((label) => normalizeString(label)).filter(Boolean)
          : [],
        targetProductIds: Array.isArray(campaign?.targetProductIds)
          ? campaign.targetProductIds.map((id) => normalizeString(id)).filter(Boolean)
          : [],
        trigger: campaign?.trigger && typeof campaign.trigger === 'object' && !Array.isArray(campaign.trigger)
          ? {
            salesSpeed: normalizeString(campaign.trigger.salesSpeed).toLowerCase(),
            trendDirection: normalizeString(campaign.trigger.trendDirection).toLowerCase(),
            minOverStockRatio: hasValue(campaign.trigger.minOverStockRatio) ? Number(campaign.trigger.minOverStockRatio) : undefined,
            minRiskLevel: normalizeString(campaign.trigger.minRiskLevel).toLowerCase(),
          }
          : {},
        actions: campaign?.actions && typeof campaign.actions === 'object' && !Array.isArray(campaign.actions)
          ? {
            autoApplyDiscount: normalizeBoolean(campaign.actions.autoApplyDiscount, false),
            createTask: normalizeBoolean(campaign.actions.createTask, false),
            notify: normalizeBoolean(campaign.actions.notify, true),
          }
          : { autoApplyDiscount: false, createTask: false, notify: true },
        isActive: normalizeBoolean(campaign?.isActive, true),
        createdAt: normalizeString(campaign?.createdAt) || new Date().toISOString(),
      }))
      : [],
    automationCenter: payload.customerRelations.automationCenter && typeof payload.customerRelations.automationCenter === 'object' && !Array.isArray(payload.customerRelations.automationCenter)
      ? {
        enabled: normalizeBoolean(payload.customerRelations.automationCenter.enabled, false),
        autoCreateTasks: normalizeBoolean(payload.customerRelations.automationCenter.autoCreateTasks, false),
        notifyOnCritical: normalizeBoolean(payload.customerRelations.automationCenter.notifyOnCritical, true),
        taskAssigneeUserId: normalizeString(payload.customerRelations.automationCenter.taskAssigneeUserId),
        rules: Array.isArray(payload.customerRelations.automationCenter.rules)
          ? payload.customerRelations.automationCenter.rules.map((rule, index) => ({
            id: normalizeString(rule?.id) || `automation-rule-${Date.now()}-${index}`,
            name: normalizeString(rule?.name),
            isActive: normalizeBoolean(rule?.isActive, true),
            triggerType: normalizeString(rule?.triggerType).toLowerCase(),
            threshold: hasValue(rule?.threshold) ? Number(rule.threshold) : undefined,
            actionType: normalizeString(rule?.actionType).toLowerCase(),
          })).filter((rule) => rule.name)
          : [],
      }
      : undefined,
  } : undefined,
});

/* Task */

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_TASK_STATUSES = ['pending', 'in-progress', 'completed'];

export const validateTaskPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['title']);
  }

  if (hasValue(payload.priority) && !VALID_PRIORITIES.includes(payload.priority)) {
    throw new AppError(400, 'Geçersiz öncelik değeri (low, medium, high)');
  }

  if (hasValue(payload.status) && !VALID_TASK_STATUSES.includes(payload.status)) {
    throw new AppError(400, 'Geçersiz durum değeri');
  }
};

export const sanitizeTaskInput = (payload) => ({
  title: normalizeString(payload.title),
  description: normalizeString(payload.description),
  assignedTo: normalizeString(payload.assignedTo),
  priority: normalizeString(payload.priority) || 'medium',
  dueDate: normalizeString(payload.dueDate),
  status: normalizeString(payload.status) || 'pending',
});

/* Section */

export const validateSectionPayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    requireFields(payload, ['name', 'number']);
  }

  if (hasValue(payload.number)) {
    const num = Number(payload.number);
    if (Number.isNaN(num) || num < 1 || num > 99) {
      throw new AppError(400, 'Reyon numarası 1-99 arasında olmalıdır');
    }
  }
};

export const sanitizeSectionInput = (payload) => ({
  name: normalizeString(payload.name),
  number: hasValue(payload.number) ? Number(payload.number) : undefined,
  description: normalizeString(payload.description),
  isActive: normalizeBoolean(payload.isActive, true),
});
