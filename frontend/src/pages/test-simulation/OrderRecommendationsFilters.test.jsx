import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('OrderRecommendations filters and presets', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockListSuggestions.mockResolvedValue([
      {
        id: 'r1',
        sku: 'SKU-1',
        productName: 'Hızlı Ürün',
        status: 'pending',
        supplierId: 's1',
        supplierName: 'Tedarikçi A',
        avgDailySales: 10,
        currentStock: 10,
        leadTimeDays: 3,
        suggestedQty: 25,
        daysToStockout: 2,
      },
      {
        id: 'r2',
        sku: 'SKU-2',
        productName: 'Yavaş Ürün',
        status: 'pending',
        supplierId: 's2',
        supplierName: 'Tedarikçi B',
        avgDailySales: 0.4,
        currentStock: 80,
        leadTimeDays: 2,
        suggestedQty: 4,
        daysToStockout: 150,
      },
    ]);
    mockListSuppliers.mockResolvedValue([{ id: 's1', name: 'Tedarikçi A' }, { id: 's2', name: 'Tedarikçi B' }]);
    mockListProducts.mockResolvedValue([{ id: 'p1' }]);
    mockListSupplierProducts.mockResolvedValue([{ productId: 'p1', leadTimeDays: 3 }]);
  });

  test('preset filters and manual filters work together', async () => {
    const user = userEvent.setup();
    renderPage();

    expect((await screen.findAllByText('Hızlı Ürün')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Yavaş Ürün').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Kritik (3 gün içinde)' }));

    await waitFor(() => {
      expect(screen.queryByText('Yavaş Ürün')).not.toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Ürün, SKU veya tedarikçi ara'), 'Hızlı');
    expect(screen.getByDisplayValue('Hızlı')).toBeInTheDocument();
  });

  test('filter panel and preset buttons are visible', async () => {
    renderPage();

    expect(await screen.findByText('Filtre Paneli')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Hızlı filtreler' })).toBeInTheDocument();
  });
});

