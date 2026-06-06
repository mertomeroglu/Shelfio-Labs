import { campaignAnalysisService } from '../services/campaignAnalysisService.js';

export const campaignAnalysisController = {
  async suggestions(req, res, next) {
    try {
      const data = await campaignAnalysisService.getSuggestions(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async simulate(req, res, next) {
    try {
      const data = await campaignAnalysisService.simulate(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
