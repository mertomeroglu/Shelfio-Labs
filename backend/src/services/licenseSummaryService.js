const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|code|licensekey|rawlicense|hash|refresh)/i;

const cleanText = (value, max = 250) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
};

const toNullableInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const toIsoOrNull = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const normalizeModules = (value) => (Array.isArray(value) ? value : [])
  .map((item) => cleanText(item, 100))
  .filter(Boolean);

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
};

const firstInt = (...values) => {
  for (const value of values) {
    const intValue = toNullableInt(value);
    if (intValue !== null) return intValue;
  }
  return null;
};

const firstIso = (...values) => {
  for (const value of values) {
    const iso = toIsoOrNull(value);
    if (iso) return iso;
  }
  return null;
};

const boolOrNull = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'demo'].includes(text)) return true;
    if (['false', '0', 'no'].includes(text)) return false;
  }
  return null;
};

const looksDemo = (...values) => values
  .map((value) => String(value || '').trim().toLowerCase())
  .some((value) => value === 'demo' || value.includes('demo'));

const safeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const hasKeys = (value) => Object.keys(safeObject(value)).length > 0;

const getNestedData = (payload) => {
  const root = safeObject(payload);
  const data = safeObject(root.data);
  return hasKeys(data) ? { root, source: data } : { root, source: root };
};

const findActiveLikeEntry = (entries) => {
  const normalized = entries.map((entry) => safeObject(entry)).filter(hasKeys);
  if (!normalized.length) return {};
  return normalized.find((entry) => {
    const status = String(entry.status || entry.licenseStatus || entry.state || '').trim().toLowerCase();
    return ['active', 'activated'].includes(status);
  }) || normalized[0];
};

const pickLicensePayload = (payload = {}) => {
  const { root, source } = getNestedData(payload);
  const account = safeObject(source.account || root.account);
  const user = safeObject(source.user || root.user || source.customer || root.customer || source.member || root.member);
  const candidates = [
    source.license,
    source.entitlement,
    source.subscription,
    root.license,
    root.entitlement,
    root.subscription,
    account.license,
    account.entitlement,
    user.license,
    user.entitlement,
    findActiveLikeEntry(asArray(source.entitlements)),
    findActiveLikeEntry(asArray(root.entitlements)),
    findActiveLikeEntry(asArray(account.entitlements)),
    findActiveLikeEntry(asArray(user.entitlements)),
    // Extra defensive shapes for getshelfio payloads
    safeObject(payload?.license),
    safeObject(payload?.entitlements),
    safeObject(payload?.data?.license),
    safeObject(payload?.data?.entitlements),
    findActiveLikeEntry(asArray(payload?.entitlements)),
    findActiveLikeEntry(asArray(payload?.data?.entitlements)),
  ].map((entry) => safeObject(entry)).filter(hasKeys);

  return candidates.find((entry) => {
    const status = String(entry.status || entry.licenseStatus || entry.state || '').trim().toLowerCase();
    return ['active', 'activated'].includes(status);
  }) || candidates[0] || {};
};

export const sanitizeLicenseSummary = (value = {}) => {
  const summary = safeObject(value);
  const planName = firstText(summary.planName);
  const planSlug = firstText(summary.planSlug);
  const licenseType = firstText(summary.licenseType);
  const isDemo = boolOrNull(summary.isDemo) ?? looksDemo(planSlug, planName, licenseType);

  let remainingDays = firstInt(summary.remainingDays);
  const expiresAt = firstIso(summary.expiresAt);
  if (remainingDays === null && expiresAt) {
    const diffTime = new Date(expiresAt).getTime() - Date.now();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    remainingDays = diffDays >= 0 ? diffDays : 0;
  }

  return {
    source: firstText(summary.source) || 'getshelfio',
    externalLicenseId: cleanText(summary.externalLicenseId, 180),
    externalTenantId: cleanText(summary.externalTenantId, 180),
    ownerEmail: cleanText(summary.ownerEmail, 320),
    planName,
    planSlug,
    licenseType,
    status: firstText(summary.status),
    expiresAt,
    activatedAt: firstIso(summary.activatedAt),
    remainingDays,
    isDemo,
    storeLimit: firstInt(summary.storeLimit),
    userLimit: firstInt(summary.userLimit),
    enabledModules: normalizeModules(summary.enabledModules),
    screenAccess: Array.isArray(summary.screenAccess) ? summary.screenAccess.map(s => String(s || '').trim()).filter(Boolean) : null,
    maskedKey: firstText(summary.maskedKey, 120),
  };
};

export const buildLicenseSummaryFromControlPayload = (payload = {}) => {
  const { root, source } = getNestedData(payload);
  const account = safeObject(source.account || root.account);
  const user = safeObject(source.user || root.user || source.customer || root.customer || source.member || root.member);
  const license = safeObject(pickLicensePayload(payload) || source.subscription);
  const plan = safeObject(source.plan || license.plan || account.plan || user.plan || root.plan);
  const limits = safeObject(source.limits || license.limits || plan.limits || root.limits);
  const sourcePlanText = typeof source.plan === 'string' ? source.plan : null;
  const licensePlanText = typeof license.plan === 'string' ? license.plan : null;
  const tenant = safeObject(source.tenant || root.tenant || license.tenant || account.tenant || user.tenant);
  const owner = safeObject(source.owner || root.owner || license.owner || account.owner || user.owner);

  const planSlug = firstText(
    plan.slug,
    plan.id,
    plan.code,
    source.planSlug,
    source.planCode,
    root.planSlug,
    root.planCode,
    license.planSlug,
    license.planCode,
    licensePlanText,
    sourcePlanText,
  );
  const planName = firstText(
    plan.name,
    source.planName,
    license.planName,
    root.planName,
    plan.id
  );
  const licenseType = firstText(
    source.licenseType,
    license.licenseType,
    license.type,
    root.licenseType
  );
  const explicitDemo = boolOrNull(source.isDemo ?? license.isDemo ?? plan.isDemo ?? root.isDemo);

  return sanitizeLicenseSummary({
    source: 'getshelfio',
    externalLicenseId: firstText(
      license.id,
      license.licenseId,
      license.license_id,
      source.licenseId,
      source.externalLicenseId,
      root.licenseId,
      root.externalLicenseId,
    ),
    externalTenantId: firstText(
      tenant.id,
      tenant.tenantId,
      tenant.tenant_id,
      license.tenantId,
      license.externalTenantId,
      source.tenantId,
      source.externalTenantId,
      root.tenantId,
      root.externalTenantId,
    ),
    ownerEmail: firstText(
      owner.email,
      license.ownerEmail,
      license.licenseOwnerEmail,
      source.ownerEmail,
      root.ownerEmail,
      user.email,
      user.username,
      account.email,
      account.username,
    ),
    planName,
    planSlug,
    licenseType,
    status: firstText(license.status, license.licenseStatus, license.state, source.licenseStatus, source.status, root.status),
    expiresAt: firstIso(license.expiresAt, license.expires_at, source.expiresAt, source.expires_at, root.expiresAt, root.expires_at),
    activatedAt: firstIso(license.activatedAt, license.activated_at, source.activatedAt, source.activated_at, root.activatedAt, root.activated_at),
    remainingDays: firstInt(license.remainingDays, source.remainingDays, root.remainingDays),
    isDemo: explicitDemo ?? looksDemo(planSlug, planName, licenseType),
    storeLimit: firstInt(limits.stores, limits.storeLimit, source.storeLimit, license.storeLimit, root.storeLimit),
    userLimit: firstInt(limits.users, limits.userLimit, source.userLimit, license.userLimit, root.userLimit),
    enabledModules: normalizeModules(
      license.enabledModules || source.enabledModules || license.modules || source.modules || root.enabledModules || root.modules,
    ),
    screenAccess: license.screenAccess || source.screenAccess || root.screenAccess || license.screen_access || source.screen_access || root.screen_access || null,
    maskedKey: firstText(license.maskedKey, source.maskedKey, root.maskedKey),
  });
};

export const buildLicenseSummaryFromDbLicense = (license = {}) => {
  const payload = safeObject(license.payload);
  const storedSummary = sanitizeLicenseSummary(payload.licenseSummary || {});
  const plan = safeObject(license.plan);

  return sanitizeLicenseSummary({
    source: firstText(storedSummary.source, payload.source) || 'getshelfio',
    externalLicenseId: firstText(storedSummary.externalLicenseId, license.externalLicenseId),
    externalTenantId: firstText(storedSummary.externalTenantId, license.externalTenantId, license.tenant?.externalTenantId),
    ownerEmail: firstText(storedSummary.ownerEmail, license.licenseOwnerEmail),
    planName: firstText(storedSummary.planName, plan.name, payload.planName),
    planSlug: firstText(storedSummary.planSlug, plan.slug, plan.code, license.planCode, license.externalPlan),
    licenseType: firstText(storedSummary.licenseType, payload.licenseType, license.externalPlan),
    status: firstText(storedSummary.status, license.externalStatus, license.status),
    expiresAt: firstIso(storedSummary.expiresAt, license.expiresAt),
    activatedAt: firstIso(storedSummary.activatedAt, license.activatedAt),
    remainingDays: firstInt(storedSummary.remainingDays, payload.remainingDays),
    isDemo: boolOrNull(storedSummary.isDemo) ?? looksDemo(storedSummary.planSlug, license.planCode, license.externalPlan),
    storeLimit: firstInt(storedSummary.storeLimit, license.storeLimit),
    userLimit: firstInt(storedSummary.userLimit, license.userLimit),
    enabledModules: normalizeModules(storedSummary.enabledModules?.length ? storedSummary.enabledModules : license.enabledModules),
    screenAccess: storedSummary.screenAccess || payload.screenAccess || null,
    maskedKey: firstText(storedSummary.maskedKey, payload.maskedKey),
  });
};

export const redactLicenseSummaryInput = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key)));
};
