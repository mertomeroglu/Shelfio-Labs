import { userService } from '../services/userService.js';

export const userController = {
  async list(req, res, next) {
    try {
      const data = await userService.list();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await userService.create(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await userService.update(req.params.id, req.body, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      await userService.remove(req.params.id, req.user.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  async activities(req, res, next) {
    try {
      const data = await userService.listActivities(req.params.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
