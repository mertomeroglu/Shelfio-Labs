import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/appError.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { signCustomerRefreshToken, signToken, verifyCustomerRefreshToken } from '../utils/jwt.js';
import { customerRepo } from '../repositories/customerRepository.js';
import { customerService } from './customerService.js';
import { storeMapService } from './storeMapService.js';
import { customerCatalogService } from './customerCatalogService.js';

const normalize = (v) => String(v || '').trim();
const normalizePhone = (v) => normalize(v).replace(/\D/g, '');
const isStrongPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=?]).{8,}$/.test(String(value || ''));
const mapCustomer = (x) => ({ id: x.id, customerNo: String(x.customerNo || ''), name: x.name, phone: x.phone, email: x.email, totalOrders: Number(x.totalOrders || 0), totalSpent: Number(x.totalSpent || 0), isActive: x.isActive !== false, discounts: Array.isArray(x.discounts) ? x.discounts : [], giftCards: Array.isArray(x.giftCards) ? x.giftCards : [], createdAt: x.createdAt });

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
  async login(payload) {
    const identity = normalize(payload.identity).toLowerCase(); const password = String(payload.password || '');
    if (!identity || !password) throw new AppError(400, 'Telefon/email ve sifre zorunludur');
    const phone = normalizePhone(identity);
    const row = (await customerRepo.getAll()).find((x) => String(x.email || '').toLowerCase() === identity || normalizePhone(x.phone) === phone);
    if (!row) throw new AppError(401, 'Kullanici bilgileri hatali');
    if (row.isActive === false) throw new AppError(403, 'Hesabiniz pasif durumda');
    if (!await comparePassword(password, row.passwordHash || '')) throw new AppError(401, 'Kullanici bilgileri hatali');
    return {
      token: signToken({ sub: row.id, type: 'customer', email: row.email }),
      refreshToken: signCustomerRefreshToken({ sub: row.id, type: 'customer-refresh', email: row.email }),
      customer: mapCustomer(row),
    };
  },
  async refreshSession(payload) {
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
    return {
      token: signToken({ sub: row.id, type: 'customer', email: row.email }),
      refreshToken: signCustomerRefreshToken({ sub: row.id, type: 'customer-refresh', email: row.email }),
      customer: mapCustomer(row),
    };
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
  async storeMap() { return storeMapService.getCustomerStoreMap(); },
  async storeMapPublic() { return storeMapService.getCustomerStoreMap(); },
};
