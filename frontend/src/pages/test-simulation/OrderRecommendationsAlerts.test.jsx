import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
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

describe('OrderRecommendations alerts', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockListSuppliers.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([]);
    mockListSupplierProducts.mockResolvedValue([]);
  });

  test('shows alert banner only when risk data exists', async () => {
    mockListSuggestions.mockResolvedValueOnce([
      { id: 'r1', productName: 'Ürün A', supplierName: 'Tedarikçi', status: 'pending', currentStock: 0, avgDailySales: 2, leadTimeDays: 2, daysToStockout: 0 },
    ]);

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect(await screen.findByText(/stok dışı kalabilir/)).toBeInTheDocument();
  });

  test('does not show alert banner when there is no risk', async () => {
    mockListSuggestions.mockResolvedValueOnce([
      { id: 'r1', productName: 'Ürün A', supplierName: 'Tedarikçi', status: 'pending', currentStock: 200, avgDailySales: 1, leadTimeDays: 2, daysToStockout: 45 },
    ]);

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect(await screen.findByText('Sipariş Önerileri')).toBeInTheDocument();
    expect(screen.queryByText(/stok dışı kalabilir/)).not.toBeInTheDocument();
  });
});

