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

describe('OrderRecommendations empty state', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
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
  });
});

