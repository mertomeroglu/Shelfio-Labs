import { customerService } from '../services/customerService.js';

export const customerController = {
  async list(_req, res, next) { try { res.json({ success: true, data: await customerService.list() }); } catch (e) { next(e); } },
  async availableGiftCards(_req, res, next) { try { res.json({ success: true, data: await customerService.listAvailableGiftCards() }); } catch (e) { next(e); } },
  async detail(req, res, next) { try { res.json({ success: true, data: await customerService.detail(req.params.id) }); } catch (e) { next(e); } },
  async create(req, res, next) { try { res.status(201).json({ success: true, data: await customerService.create(req.body || {}) }); } catch (e) { next(e); } },
  async setStatus(req, res, next) { try { res.json({ success: true, data: await customerService.updateStatus(req.params.id, req.body?.isActive) }); } catch (e) { next(e); } },
  async assignGiftCard(req, res, next) { try { res.json({ success: true, data: await customerService.assignGiftCard(req.params.id, req.body || {}) }); } catch (e) { next(e); } },
  async assignGiftCardBulk(req, res, next) { try { res.json({ success: true, data: await customerService.assignGiftCardBulk(req.body || {}) }); } catch (e) { next(e); } },
  async assignDiscount(req, res, next) { try { res.json({ success: true, data: await customerService.assignDiscount(req.params.id, req.body || {}) }); } catch (e) { next(e); } },
  async sendNotification(req, res, next) { try { res.status(201).json({ success: true, data: await customerService.sendNotification(req.body || {}) }); } catch (e) { next(e); } },
};
