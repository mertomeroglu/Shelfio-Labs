import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import PurchaseSuggestions from '../purchase-suggestions/PurchaseSuggestions.jsx';

const mockListSuggestions = vi.fn();
const mockGenerateSuggestions = vi.fn();
const mockGetSuggestionSummary = vi.fn();
const mockListSuppliers = vi.fn();
const mockListProducts = vi.fn();
const mockListSupplierProducts = vi.fn();

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('../../services/procurementService.js', () => ({
  procurementService: {
    listSuggestions: (...args) => mockListSuggestions(...args),
    generateSuggestions: (...args) => mockGenerateSuggestions(...args),
    getSuggestionSummary: (...args) => mockGetSuggestionSummary(...args),
    listSupplierProducts: (...args) => mockListSupplierProducts(...args),
    updateSuggestion: vi.fn(),
    approveSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
  },
}));

vi.mock('../../services/supplierService.js', () => ({
  supplierService: {
    list: (...args) => mockListSuppliers(...args),
  },
}));

vi.mock('../../services/productService.js', () => ({
  productService: {
    list: (...args) => mockListProducts(...args),
  },
}));

describe('OrderRecommendations empty state', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockGetSuggestionSummary.mockResolvedValue({
      totalEvaluated: 2,
      pendingCount: 0,
      manualEvaluationCount: 0,
      skippedCount: 2,
      archiveCount: 0,
      missingMinStockCount: 1,
      missingLeadTimeCount: 1,
      noRecentSalesCount: 2,
      sufficientStockCount: 1,
      missingSupplierMappingCount: 1,
      missingMoqOrCaseDataCount: 0,
      suppressedByInboundCount: 0,
      skippedByModeOrRiskCount: 0,
      lookbackDays: 30,
      reasonBreakdown: [
        { code: 'missing_demand_data', count: 2, text: 'Yeterli satış verisi olmadığı için otomatik öneri oluşturulmadı' },
      ],
      active: {
        activeCount: 2,
        pendingCount: 0,
        manualEvaluationCount: 0,
        skippedCount: 2,
        highRiskCount: 0,
      },
      archive: { archiveCount: 0, convertedCount: 0 },
    });
    mockListSuggestions.mockResolvedValue([]);
    mockListSuppliers.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([
      { id: 'p1', minStock: 0, criticalStock: 0, avgDailySales: 0, currentStock: 34 },
      { id: 'p2', minStock: 2, criticalStock: 2, avgDailySales: 0, currentStock: 14 },
    ]);
    mockListSupplierProducts.mockResolvedValue([{ productId: 'p2', leadTimeDays: 0 }]);
  });

  test('renders intelligent empty state and CTA', async () => {
    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('order-recommendations-empty-state')).toBeInTheDocument();
    expect(screen.getByText('Eksik Verileri Tamamla')).toBeInTheDocument();
    expect(screen.getByText(/Min. stok tanımı eksik ürün/)).toBeInTheDocument();
    expect(screen.getByText(/Temin tanımı eksik ürün/)).toBeInTheDocument();
    expect(screen.getByText(/Öneri motoru 2 ürünü son 30 günlük/)).toBeInTheDocument();
    expect(screen.getAllByText(/Yeterli satış verisi olmadığı için/).length).toBeGreaterThan(0);
  });
});

