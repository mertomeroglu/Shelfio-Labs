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

describe('OrderRecommendations loading/error states', () => {
  test('shows loading indicator on slow api response', async () => {
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockListSuggestions.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([]), 40);
    }));
    mockListSuppliers.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([]);
    mockListSupplierProducts.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect(screen.getByText('Sipariş Önerileri')).toBeInTheDocument();
    expect(screen.getByText('Veriler yükleniyor...')).toBeInTheDocument();
    expect(await screen.findByTestId('order-recommendations-empty-state')).toBeInTheDocument();
  });
});

