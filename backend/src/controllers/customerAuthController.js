import { customerAuthService } from '../services/customerAuthService.js';

const getCustomerAuthMeta = (req) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || '');
  return {
    ipAddress: forwardedFor || req.ip || req.socket?.remoteAddress || '',
    userAgent,
    device: userAgent,
    requestId: req.requestId || req.headers['x-request-id'] || '',
    source: 'customer_mobile',
  };
};

export const customerAuthController = {
  async register(req, res, next) { try { res.status(201).json({ success: true, data: await customerAuthService.register(req.body || {}) }); } catch (e) { next(e); } },
  async login(req, res, next) { try { res.json({ success: true, data: await customerAuthService.login(req.body || {}, getCustomerAuthMeta(req)) }); } catch (e) { next(e); } },
  async forgotPassword(req, res, next) { try { res.json({ success: true, data: await customerAuthService.forgotPassword(req.body || {}, { ip: req.ip, userAgent: req.get('user-agent') || '' }) }); } catch (e) { next(e); } },
  async resetPassword(req, res, next) { try { res.json({ success: true, data: await customerAuthService.resetPassword(req.body || {}) }); } catch (e) { next(e); } },
  async refresh(req, res, next) { try { res.json({ success: true, data: await customerAuthService.refreshSession(req.body || {}, getCustomerAuthMeta(req)) }); } catch (e) { next(e); } },
  async deleteAccount(req, res, next) { try { res.json({ success: true, data: await customerAuthService.deleteAccount(req.body || {}) }); } catch (e) { next(e); } },
  async logout(req, res, next) { try { res.json({ success: true, data: await customerAuthService.logout(req.customer.id, getCustomerAuthMeta(req)) }); } catch (e) { next(e); } },
  async me(req, res, next) { try { res.json({ success: true, data: await customerAuthService.me(req.customer.id) }); } catch (e) { next(e); } },
  async updateProfile(req, res, next) { try { res.json({ success: true, data: await customerAuthService.updateProfile(req.customer.id, req.body || {}) }); } catch (e) { next(e); } },
  async dashboard(req, res, next) { try { res.json({ success: true, data: await customerAuthService.dashboard(req.customer.id) }); } catch (e) { next(e); } },
  async catalog(req, res, next) { try { res.json({ success: true, data: await customerAuthService.catalog(req.query || {}) }); } catch (e) { next(e); } },
  async catalogByBarcode(req, res, next) { try { res.json({ success: true, data: await customerAuthService.catalogByBarcode(req.params.barcode) }); } catch (e) { next(e); } },
  async catalogDetail(req, res, next) { try { res.json({ success: true, data: await customerAuthService.catalogDetail(req.params.id) }); } catch (e) { next(e); } },
  async catalogStockForecast(req, res, next) { try { res.json({ success: true, data: await customerAuthService.catalogStockForecast(req.params.id) }); } catch (e) { next(e); } },
  async orders(req, res, next) { try { res.json({ success: true, data: await customerAuthService.orders(req.customer.id, req.query || {}) }); } catch (e) { next(e); } },
  async getCart(req, res, next) { try { res.json({ success: true, data: await customerAuthService.getCart(req.customer.id) }); } catch (e) { next(e); } },
  async updateCart(req, res, next) { try { res.json({ success: true, data: await customerAuthService.updateCart(req.customer.id, req.body || {}) }); } catch (e) { next(e); } },
  async placeOrder(req, res, next) { try { res.status(201).json({ success: true, data: await customerAuthService.placeOrder(req.customer.id, req.body || {}) }); } catch (e) { next(e); } },
  async createMobileOrder(req, res, next) { try { res.status(201).json({ success: true, data: await customerAuthService.createMobileOrder(req.customer.id, req.body || {}) }); } catch (e) { next(e); } },
  async getMobileOrder(req, res, next) { try { res.json({ success: true, data: await customerAuthService.getMobileOrder(req.customer.id, req.params.id) }); } catch (e) { next(e); } },
  async confirmMobileOrderHandoff(req, res, next) { try { res.json({ success: true, data: await customerAuthService.confirmMobileOrderHandoff(req.customer.id, req.params.id) }); } catch (e) { next(e); } },
  async notifications(req, res, next) { try { res.json({ success: true, data: await customerAuthService.notifications(req.customer.id, req.query?.limit) }); } catch (e) { next(e); } },
  async markNotificationsAsRead(req, res, next) { try { res.json({ success: true, data: await customerAuthService.markNotificationsAsRead(req.customer.id) }); } catch (e) { next(e); } },
  async clearNotifications(req, res, next) { try { res.json({ success: true, data: await customerAuthService.clearNotifications(req.customer.id) }); } catch (e) { next(e); } },
  async getRoutePlan(req, res, next) {
    try {
      const items = req.body?.items;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.json({
          success: true,
          source: 'fallback',
          route: [],
          missingLocation: [],
          summary: {
            totalItems: 0,
            locatedItems: 0,
            missingLocationCount: 0,
            routeMode: 'coordinates'
          }
        });
      }

      const mergedItems = [];
      const qtyMap = new Map();
      for (const item of items) {
        if (!item || !item.productId) continue;
        const qty = Math.max(1, Math.floor(Number(item.quantity || 1)));
        const productId = String(item.productId).trim();
        if (!productId) continue;
        qtyMap.set(productId, (qtyMap.get(productId) || 0) + qty);
      }

      for (const [productId, quantity] of qtyMap.entries()) {
        mergedItems.push({ productId, quantity });
      }

      if (mergedItems.length === 0) {
        return res.json({
          success: true,
          source: 'fallback',
          route: [],
          missingLocation: [],
          summary: {
            totalItems: 0,
            locatedItems: 0,
            missingLocationCount: 0,
            routeMode: 'coordinates'
          }
        });
      }

      const data = await customerAuthService.getCartRoutePlan(mergedItems);
      res.json({ success: true, ...data });
    } catch (e) {
      next(e);
    }
  },
  async storeMap(req, res, next) { try { res.json({ success: true, data: await customerAuthService.storeMap(req.customer.id) }); } catch (e) { next(e); } },
  async storeMapPublic(_req, res, next) { try { res.json({ success: true, data: await customerAuthService.storeMapPublic() }); } catch (e) { next(e); } },
};
