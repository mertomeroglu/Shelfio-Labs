import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { AppError } from '../utils/appError.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { signCustomerRefreshToken, signToken, verifyCustomerRefreshToken } from '../utils/jwt.js';
import { customerRepo } from '../repositories/customerRepository.js';
import { customerService } from './customerService.js';
import { storeMapService } from './storeMapService.js';
import { customerCatalogService } from './customerCatalogService.js';
import { mailService } from './mailService.js';
import { settingsService } from './settingsService.js';
import { getPrisma } from '../providers/postgresProvider.js';

const normalize = (v) => String(v || '').trim();
const normalizePhone = (v) => normalize(v).replace(/\D/g, '');
const isStrongPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=?]).{8,}$/.test(String(value || ''));
const isResetPasswordStrong = (value) => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(value || ''));
const mapCustomer = (x) => ({ id: x.id, customerNo: String(x.customerNo || ''), name: x.name, phone: x.phone, email: x.email, totalOrders: Number(x.totalOrders || 0), totalSpent: Number(x.totalSpent || 0), isActive: x.isActive !== false, discounts: Array.isArray(x.discounts) ? x.discounts : [], giftCards: Array.isArray(x.giftCards) ? x.giftCards : [], createdAt: x.createdAt });
const PASSWORD_RESET_MESSAGE = 'Eğer bu e-posta sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderildi.';
const PASSWORD_RESET_TTL_MINUTES = 30;
const PASSWORD_RESET_EMAIL_COOLDOWN_MS = 3 * 60 * 1000;
const PASSWORD_RESET_IP_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_RESET_IP_LIMIT = 12;
const passwordResetEmailCooldown = new Map();
const passwordResetIpHits = new Map();

const normalizeEmail = (value) => normalize(value).toLowerCase();
const isValidEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || ''));
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
const createResetToken = () => crypto.randomBytes(32).toString('base64url');
const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const isLocalhostBaseUrl = (value = '') => {
  try {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};
const getResetBaseUrl = () => {
  const configuredBaseUrl = String(process.env.CUSTOMER_RESET_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  const normalizedBaseUrl = (configuredBaseUrl || 'https://shelfiolabs.com').replace(/\/+$/, '');
  if (isProductionRuntime && isLocalhostBaseUrl(normalizedBaseUrl)) {
    return 'https://shelfiolabs.com';
  }
  return normalizedBaseUrl;
};
const buildResetLink = (token) => `${getResetBaseUrl()}/musteri/sifre-sifirla?token=${encodeURIComponent(token)}`;
const pruneRateMap = (map, now = Date.now()) => {
  for (const [key, value] of map.entries()) {
    const last = Array.isArray(value) ? Math.max(...value, 0) : Number(value || 0);
    if (!last || now - last > PASSWORD_RESET_IP_WINDOW_MS) map.delete(key);
  }
};
const isIpRateLimited = (ip) => {
  const key = normalize(ip) || 'unknown';
  const now = Date.now();
  pruneRateMap(passwordResetIpHits, now);
  const hits = (passwordResetIpHits.get(key) || []).filter((at) => now - at <= PASSWORD_RESET_IP_WINDOW_MS);
  hits.push(now);
  passwordResetIpHits.set(key, hits);
  return hits.length > PASSWORD_RESET_IP_LIMIT;
};

const recordCustomerLoginActivity = async (customer, meta = {}) => {
  try {
    await settingsService.recordLoginActivity(customer, {
      userType: 'customer',
      source: 'customer_mobile',
      eventType: meta.eventType || 'login_success',
      status: meta.status,
      failureReason: meta.failureReason,
      identity: meta.identity,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      device: meta.device,
      requestId: meta.requestId,
    });
  } catch {
    // Müşteri oturum akışı log hatası yüzünden kesilmemeli.
  }
};

const isEmailCoolingDown = (email) => {
  const now = Date.now();
  const last = Number(passwordResetEmailCooldown.get(email) || 0);
  if (last && now - last < PASSWORD_RESET_EMAIL_COOLDOWN_MS) return true;
  passwordResetEmailCooldown.set(email, now);
  return false;
};

export const customerAuthService = {
  async register(payload) {
    const name = normalize(payload.name); const phone = normalizePhone(payload.phone); const email = normalize(payload.email).toLowerCase(); const password = String(payload.password || '');
    if (!name || !phone || !email || !password) throw new AppError(400, 'Ad soyad, telefon, e-posta ve şifre zorunludur');
    if (!isStrongPassword(password)) throw new AppError(400, 'Şifre en az 8 karakter olmalı ve en az 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter içermelidir.');
    await customerService.list();
    const all = await customerRepo.getAll();
    if (all.some((x) => normalizePhone(x.phone) === phone)) throw new AppError(409, 'Bu telefon numarası ile kayıtlı bir hesap zaten bulunuyor.');
    if (all.some((x) => String(x.email || '').trim().toLowerCase() === email)) throw new AppError(409, 'Bu e-posta adresi ile kayıtlı bir hesap zaten bulunuyor.');
    const now = new Date().toISOString();
    const nextCustomerNo = String(Math.max(0, ...all.map((x) => Number.parseInt(String(x.customerNo || ''), 10) || 0)) + 1).padStart(8, '0');
    const row = { id: uuidv4(), customerNo: nextCustomerNo, name, phone, email, passwordHash: await hashPassword(password), totalOrders: 0, totalSpent: 0, isActive: true, discounts: [], giftCards: [], createdAt: now, updatedAt: now };
    await customerRepo.create(row);
    return {
      token: signToken({ sub: row.id, type: 'customer', email: row.email }),
      refreshToken: signCustomerRefreshToken({ sub: row.id, type: 'customer-refresh', email: row.email }),
      customer: mapCustomer(row),
    };
  },
  async login(payload, meta = {}) {
    const identity = normalize(payload.identity).toLowerCase(); const password = String(payload.password || '');
    if (!identity || !password) throw new AppError(400, 'Telefon/email ve sifre zorunludur');
    const phone = normalizePhone(identity);
    const row = (await customerRepo.getAll()).find((x) => String(x.email || '').toLowerCase() === identity || normalizePhone(x.phone) === phone);
    if (!row) {
      await recordCustomerLoginActivity(null, { ...meta, identity, eventType: 'login_failed', status: 'failed', failureReason: 'Kullanıcı bulunamadı' });
      throw new AppError(401, 'Kullanıcı bilgileri hatalı.');
    }
    if (row.isActive === false) {
      await recordCustomerLoginActivity(row, { ...meta, identity, eventType: 'login_failed', status: 'failed', failureReason: 'Kullanıcı pasif' });
      throw new AppError(403, 'Hesabiniz pasif durumda');
    }
    if (!await comparePassword(password, row.passwordHash || '')) {
      await recordCustomerLoginActivity(row, { ...meta, identity, eventType: 'login_failed', status: 'failed', failureReason: 'Şifre hatalı' });
      throw new AppError(401, 'Kullanıcı bilgileri hatalı.');
    }
    await recordCustomerLoginActivity(row, { ...meta, identity, eventType: 'login_success', status: 'success' });
    return {
      token: signToken({ sub: row.id, type: 'customer', email: row.email }),
      refreshToken: signCustomerRefreshToken({ sub: row.id, type: 'customer-refresh', email: row.email }),
      customer: mapCustomer(row),
    };
  },
  async forgotPassword(payload, meta = {}) {
    const email = normalizeEmail(payload?.email);
    if (!email || !isValidEmail(email)) throw new AppError(400, 'Geçerli bir e-posta adresi girin.');

    if (isIpRateLimited(meta.ip)) {
      return { message: PASSWORD_RESET_MESSAGE };
    }

    const coolingDown = isEmailCoolingDown(email);
    const row = (await customerRepo.getAll()).find((x) => normalizeEmail(x.email) === email && x.isActive !== false);
    if (!row || coolingDown) {
      return { message: PASSWORD_RESET_MESSAGE };
    }

    const prisma = await getPrisma();
    const token = createResetToken();
    const tokenHash = hashResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (PASSWORD_RESET_TTL_MINUTES * 60 * 1000));

    await prisma.customerPasswordResetToken.updateMany({
      where: { customerId: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    await prisma.customerPasswordResetToken.create({
      data: {
        id: uuidv4(),
        customerId: row.id,
        tokenHash,
        expiresAt,
        requestedIp: meta.ip || null,
        userAgent: meta.userAgent || null,
      },
    });

    try {
      await mailService.sendCustomerPasswordResetEmail({ to: email, resetLink: buildResetLink(token) });
    } catch (error) {
      await prisma.customerPasswordResetToken.updateMany({
        where: { tokenHash },
        data: { usedAt: new Date() },
      });
      throw new AppError(503, error?.userMessage || 'Şifre sıfırlama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.');
    }

    return { message: PASSWORD_RESET_MESSAGE };
  },
  async resetPassword(payload) {
    const token = normalize(payload?.token);
    const password = String(payload?.password || '');
    const passwordConfirm = String(payload?.passwordConfirm || '');

    if (!token) throw new AppError(400, 'Şifre sıfırlama bağlantısı geçersiz.');
    if (!password || !passwordConfirm) throw new AppError(400, 'Yeni şifre ve şifre tekrarı zorunludur.');
    if (password !== passwordConfirm) throw new AppError(400, 'Şifreler eşleşmiyor.');
    if (!isResetPasswordStrong(password)) throw new AppError(400, 'Şifre en az 8 karakter olmalı ve en az 1 harf ile 1 rakam içermelidir.');

    const prisma = await getPrisma();
    const tokenHash = hashResetToken(token);
    const resetRow = await prisma.customerPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { customer: true },
    });

    if (!resetRow || resetRow.usedAt || resetRow.expiresAt.getTime() <= Date.now() || !resetRow.customer || resetRow.customer.isActive === false) {
      throw new AppError(400, 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: resetRow.customerId },
        data: {
          passwordHash: await hashPassword(password),
          updatedAt: now,
        },
      }),
      prisma.customerPasswordResetToken.update({
        where: { id: resetRow.id },
        data: { usedAt: now },
      }),
      prisma.customerPasswordResetToken.updateMany({
        where: { customerId: resetRow.customerId, usedAt: null, id: { not: resetRow.id } },
        data: { usedAt: now },
      }),
    ]);

    return { message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' };
  },
  async refreshSession(payload, meta = {}) {
    const refreshToken = String(payload?.refreshToken || '').trim();
    if (!refreshToken) throw new AppError(401, 'Oturum yenileme bilgisi bulunamadı');
    let tokenPayload;
    try {
      tokenPayload = verifyCustomerRefreshToken(refreshToken);
    } catch {
      throw new AppError(401, 'Oturum yenilenemedi, lütfen tekrar giriş yapın');
    }
    if (tokenPayload?.type !== 'customer-refresh') throw new AppError(401, 'Geçersiz oturum yenileme isteği');
    const row = await customerRepo.findById(tokenPayload.sub);
    if (!row || row.isActive === false) throw new AppError(401, 'Müşteri oturumu bulunamadı');
    await recordCustomerLoginActivity(row, { ...meta, eventType: 'token_refresh', status: 'success' });
    return {
      token: signToken({ sub: row.id, type: 'customer', email: row.email }),
      refreshToken: signCustomerRefreshToken({ sub: row.id, type: 'customer-refresh', email: row.email }),
      customer: mapCustomer(row),
    };
  },
  async logout(id, meta = {}) {
    const row = await customerRepo.findById(id);
    if (row) {
      await recordCustomerLoginActivity(row, { ...meta, eventType: 'logout', status: 'success' });
    }
    return { ok: true };
  },
  async updateProfile(id, payload) {
    const row = await customerRepo.findById(id);
    if (!row) throw new AppError(404, 'Müşteri bulunamadı');

    const name = payload.name != null ? normalize(payload.name) : row.name;
    const phone = payload.phone != null ? normalizePhone(payload.phone) : normalizePhone(row.phone);
    const email = payload.email != null ? normalize(payload.email).toLowerCase() : String(row.email || '').toLowerCase();
    const password = payload.password != null ? String(payload.password || '') : '';

    if (!name || !phone || !email) throw new AppError(400, 'Ad soyad, telefon ve e-posta zorunludur');
    if (payload.password != null && password && !isStrongPassword(password)) throw new AppError(400, 'Şifre en az 8 karakter olmalı ve en az 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter içermelidir.');

    const all = await customerRepo.getAll();
    if (all.some((item) => String(item.id) !== String(id) && normalizePhone(item.phone) === phone)) throw new AppError(409, 'Bu telefon numarası ile kayıtlı bir hesap zaten bulunuyor.');
    if (all.some((item) => String(item.id) !== String(id) && String(item.email || '').trim().toLowerCase() === email)) throw new AppError(409, 'Bu e-posta adresi ile kayıtlı bir hesap zaten bulunuyor.');

    const nextPasswordHash = password ? await hashPassword(password) : row.passwordHash;
    const updated = await customerRepo.updateById(id, (current) => ({
      ...current,
      name,
      phone,
      email,
      passwordHash: nextPasswordHash,
      updatedAt: new Date().toISOString(),
    }));
    if (!updated) throw new AppError(404, 'Müşteri bulunamadı');

    const fresh = await customerRepo.findById(id);
    return mapCustomer(fresh);
  },
  async me(id) { const row = await customerRepo.findById(id); if (!row) throw new AppError(404, 'Musteri bulunamadi'); return mapCustomer(row); },
  async dashboard(id) { return customerService.portalDashboard(id); },
  async catalog(query = {}) { return customerCatalogService.listCatalog(query); },
  async catalogDetail(id) { return customerCatalogService.getProductById(id); },
  async catalogStockForecast(id) { return customerCatalogService.getProductStockForecast(id); },
  async orders(id, query) { return customerService.listOrders(id, query); },
  async getCart(id) { return customerService.getCart(id); },
  async updateCart(id, payload) { return customerService.updateCart(id, payload); },
  async placeOrder(id, payload) { return customerService.placeOrder(id, payload); },
  async notifications(id, limit) { return customerService.listCustomerNotifications(id, limit); },
  async markNotificationsAsRead(id) { return customerService.markCustomerNotificationsAsRead(id); },
  async clearNotifications(id) { return customerService.clearCustomerNotifications(id); },
  async storeMap() { return storeMapService.getCustomerStoreMap(); },
  async storeMapPublic() { return storeMapService.getCustomerStoreMap(); },
};
