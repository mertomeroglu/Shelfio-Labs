import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
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

describe('OrderRecommendations supplier grouping UI', () => {
  beforeEach(() => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockListSuggestions.mockResolvedValue([
      { id: 'r1', productName: 'Ürün A', sku: 'A', supplierId: 's1', supplierName: 'Tedarikçi A', status: 'pending', currentStock: 10, avgDailySales: 2, leadTimeDays: 3, daysToStockout: 4 },
      { id: 'r2', productName: 'Ürün B', sku: 'B', supplierId: 's2', supplierName: 'Tedarikçi B', status: 'pending', currentStock: 8, avgDailySales: 2, leadTimeDays: 3, daysToStockout: 3 },
    ]);
    mockListSuppliers.mockResolvedValue([{ id: 's1', name: 'Tedarikçi A' }, { id: 's2', name: 'Tedarikçi B' }]);
    mockListProducts.mockResolvedValue([]);
    mockListSupplierProducts.mockResolvedValue([]);
  });

  test('toggles grouped view and renders supplier grouping sections', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Görünüm' }));

    expect(await screen.findByTestId('supplier-grouping-ui')).toBeInTheDocument();
    expect(screen.getAllByText('Tedarikçi A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tedarikçi B').length).toBeGreaterThan(0);
  });
});

