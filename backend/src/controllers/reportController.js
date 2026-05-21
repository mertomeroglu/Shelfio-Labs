import { reportService } from '../services/reportService.js';
import { dailyClosingService } from '../services/dailyClosingService.js';
import { sendListResponse } from '../utils/listResponse.js';

const loadXlsx = async () => {
  const mod = await import('xlsx');
  return mod.default || mod;
};

const normalizeCellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  return value;
};

const estimateColumnWidths = (headers, tableRows) => {
  return headers.map((header, colIndex) => {
    const maxValueLength = tableRows.reduce((maxLen, row) => {
      const value = row[colIndex];
      const asText = String(value ?? '');
      return Math.max(maxLen, asText.length);
    }, String(header || '').length);

    return {
      wch: Math.min(48, Math.max(12, maxValueLength + 2)),
    };
  });
};

export const reportController = {
  async pricingAnalysis(req, res, next) {
    try {
      const data = await reportService.getPricingAnalysis(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async pricingAnalysisSummary(req, res, next) {
    try {
      const data = await reportService.getPricingAnalysisSummary(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async pricingAnalysisRows(req, res, next) {
    try {
      const data = await reportService.getPricingAnalysisRows(req.query);
      sendListResponse(res, data);
    } catch (error) {
      next(error);
    }
  },

  async pricingAnalysisDetail(req, res, next) {
    try {
      const data = await reportService.getPricingAnalysisDetail(req.params.productId, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async calculateSellPriceRecommendation(req, res, next) {
    try {
      const data = await reportService.calculateSellPriceRecommendation(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async approveSellPriceRecommendation(req, res, next) {
    try {
      const data = await reportService.approveSellPriceRecommendation(req.body || {}, req.user?.id || null);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async dashboard(req, res, next) {
    try {
      const data = await reportService.getDashboardSummary();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async summary(req, res, next) {
    try {
      const data = await reportService.getSummaryReport(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async dayEnd(req, res, next) {
    try {
      const days = Number(req.query.days || 7);
      const data = await dailyClosingService.listRecentClosings(days);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async runDayEnd(req, res, next) {
    try {
      const businessDate = req.body?.businessDate || req.query.businessDate;
      const data = businessDate
        ? await dailyClosingService.closeBusinessDate(businessDate, { source: 'manual-api' })
        : await dailyClosingService.closePreviousBusinessDate({ source: 'manual-api' });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async section(req, res, next) {
    try {
      const data = await reportService.getReportSection(req.params.section, req.query);
      if (!data) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz rapor bölümü.',
        });
      }
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async globalSearch(req, res, next) {
    try {
      const data = await reportService.globalSearch(req.query.q);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async lastStockUpdate(req, res, next) {
    try {
      const data = await reportService.getLastStockUpdate();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async exportXlsx(req, res, next) {
    try {
      const { section, ...query } = req.query;
      const exportData = await reportService.getSectionExportData(section, query);

      if (!exportData) {
        return res.status(400).json({
          success: false,
          message: 'Gecersiz rapor bolumu. Desteklenen bolumler: inventory, critical, category, supplier, movement, returns, aging, expiry, margin, supplier_performance',
        });
      }

      const { rows, fileName, sheetName, columns } = exportData;
      const XLSX = await loadXlsx();
      const workbook = XLSX.utils.book_new();
      const safeColumns = Array.isArray(columns) ? columns.filter((column) => column?.key && column?.header) : [];
      const safeRows = Array.isArray(rows) ? rows : [];
      const headers = safeColumns.map((column) => column.header);
      const tableRows = safeRows.map((row) => safeColumns.map((column) => normalizeCellValue(row[column.key])));

      if (!tableRows.length && headers.length) {
        tableRows.push(headers.map(() => ''));
      }

      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...tableRows]);
      worksheet['!cols'] = estimateColumnWidths(headers, tableRows);

      if (headers.length > 0) {
        const lastCol = headers.length - 1;
        const lastRow = tableRows.length;
        worksheet['!autofilter'] = {
          ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } }),
        };
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  },
};
