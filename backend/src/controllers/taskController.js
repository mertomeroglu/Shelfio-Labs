import { taskService } from '../services/taskService.js';
import { sendListResponse } from '../utils/listResponse.js';

export const taskController = {
  async list(req, res, next) {
    try {
      const tasks = req.user.role === 'admin'
        ? await taskService.list(req.query)
        : await taskService.listByUser(req.user.id, req.query);
      sendListResponse(res, tasks);
    } catch (error) {
      next(error);
    }
  },

  async summary(req, res, next) {
    try {
      const data = await taskService.getSummary(req.user.role === 'admin' ? null : req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const task = await taskService.getById(req.params.id);
      if (req.user.role !== 'admin' && task.assignedTo !== req.user.id) {
        return res.status(403).json({ message: 'Bu göreve erişim yetkiniz yok.' });
      }
      res.json(task);
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const task = await taskService.create(req.body, req.user.id, req.user);
      res.status(201).json(task);
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const existing = await taskService.getById(req.params.id);
      if (req.user.role !== 'admin' && existing.assignedTo !== req.user.id) {
        return res.status(403).json({ message: 'Bu görevi güncelleme yetkiniz yok.' });
      }
      const task = await taskService.update(req.params.id, req.body, req.user);
      res.json(task);
    } catch (error) {
      next(error);
    }
  },

  async addComment(req, res, next) {
    try {
      const existing = await taskService.getById(req.params.id);
      if (req.user.role !== 'admin' && existing.assignedTo !== req.user.id) {
        return res.status(403).json({ message: 'Bu göreve yorum ekleme yetkiniz yok.' });
      }
      const task = await taskService.addComment(req.params.id, req.body, req.user);
      res.status(201).json(task);
    } catch (error) {
      next(error);
    }
  },

  async toggleStatus(req, res, next) {
    try {
      const task = await taskService.toggleStatus(req.params.id, req.user.id, req.user);
      res.json(task);
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const existing = await taskService.getById(req.params.id);
      if (req.user.role !== 'admin' && existing.assignedTo !== req.user.id) {
        return res.status(403).json({ message: 'Bu görevi silme yetkiniz yok.' });
      }
      await taskService.remove(req.params.id);
      res.json({ message: 'Görev silindi' });
    } catch (error) {
      next(error);
    }
  },
};

