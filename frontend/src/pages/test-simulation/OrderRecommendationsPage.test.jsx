import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import PurchaseSuggestions from '../purchase-suggestions/PurchaseSuggestions.jsx';

const mockListSuggestions = vi.fn();
const mockGenerateSuggestions = vi.fn();
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

const renderPage = () => render(
  <MemoryRouter>
    <PurchaseSuggestions />
  </MemoryRouter>
);

describe('OrderRecommendationsPage', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockListSuggestions.mockResolvedValue([
      {
        id: 'r1',
        productId: 'p1',
        sku: 'SKU-1',
        productName: 'Ürün A',
        status: 'pending',
        supplierId: 's1',
        supplierName: 'Tedarikçi A',
        avgDailySales: 6,
        currentStock: 12,
        leadTimeDays: 3,
        suggestedQty: 20,
        daysToStockout: 2,
      },
    ]);
    mockListSuppliers.mockResolvedValue([{ id: 's1', name: 'Tedarikçi A' }]);
    mockListProducts.mockResolvedValue([{ id: 'p1', minStock: 4, criticalStock: 4, avgDailySales: 6, currentStock: 12 }]);
    mockListSupplierProducts.mockResolvedValue([{ productId: 'p1', leadTimeDays: 3 }]);
  });

  test('loads page without auto-generating when suggestion data exists', async () => {
    renderPage();

    expect(await screen.findByText('Sipariş Önerileri')).toBeInTheDocument();
    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);
    expect(mockGenerateSuggestions).not.toHaveBeenCalled();
  });

  test('renders top summary cards without calculation formula copy', async () => {
    renderPage();

    expect(await screen.findByText('Toplam Öneri')).toBeInTheDocument();
    expect((await screen.findAllByText('Bekleyen')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Önerilen miktar =/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sipariş öneri listesi üst sayfalama')).toBeInTheDocument();
  });
});
