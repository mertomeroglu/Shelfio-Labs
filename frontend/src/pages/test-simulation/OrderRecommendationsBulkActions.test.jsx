import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PurchaseSuggestions from '../purchase-suggestions/PurchaseSuggestions.jsx';

const mockNavigate = vi.fn();
const mockListSuggestions = vi.fn();
const mockGenerateSuggestions = vi.fn();
const mockListSuppliers = vi.fn();
const mockListProducts = vi.fn();
const mockListSupplierProducts = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'admin', name: 'Test Kullanıcı' } }),
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

describe('OrderRecommendations bulk actions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockNavigate.mockReset();
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
      {
        id: 'r2',
        productId: 'p2',
        sku: 'SKU-2',
        productName: 'Ürün B',
        status: 'pending',
        supplierId: 's1',
        supplierName: 'Tedarikçi A',
        avgDailySales: 4,
        currentStock: 9,
        leadTimeDays: 3,
        suggestedQty: 10,
        daysToStockout: 3,
      },
    ]);
    mockListSuppliers.mockResolvedValue([{ id: 's1', name: 'Tedarikçi A' }]);
    mockListProducts.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
    ]);
    mockListSupplierProducts.mockResolvedValue([
      { productId: 'p1', supplierId: 's1', leadTimeDays: 3 },
      { productId: 'p2', supplierId: 's1', leadTimeDays: 3 },
    ]);
  });

  test('bulk action button appears only after valid selection exists', async () => {
    const user = userEvent.setup();
    renderPage();

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Toplu Siparişe Gönder' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('checkbox', { name: /Ürün A için seç|Ürün B için seç|Tümünü seç/ })[1]);

    expect(screen.getByRole('button', { name: 'Toplu Siparişe Gönder' })).toBeInTheDocument();
  });

  test('selecting multiple rows routes with bulk payload instead of calling approve endpoint', async () => {
    const user = userEvent.setup();
    renderPage();

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);

    const rowCheckboxes = screen.getAllByRole('checkbox');
    await user.click(rowCheckboxes[1]);
    await user.click(rowCheckboxes[2]);

    await user.click(screen.getByRole('button', { name: 'Toplu Siparişe Gönder' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/siparis-olustur?'),
        expect.objectContaining({
          state: expect.objectContaining({
            purchaseSuggestions: expect.arrayContaining([
              expect.objectContaining({ suggestionId: 'r1', supplierId: 's1' }),
              expect.objectContaining({ suggestionId: 'r2', supplierId: 's1' }),
            ]),
            purchaseSuggestionFlow: expect.objectContaining({
              mode: 'bulk',
            }),
          }),
        }),
      );
    });

    expect(mockNavigate.mock.calls[0][0]).toContain('intent=bulk');
    expect(mockNavigate.mock.calls[0][0]).toContain('handoffId=');
    const storedHandoffs = JSON.parse(window.sessionStorage.getItem('shelfio.purchaseSuggestions.handoffs.v1') || '{}');
    const handoffIds = Object.keys(storedHandoffs);
    expect(handoffIds).toHaveLength(1);
    expect(storedHandoffs[handoffIds[0]]).toEqual(expect.objectContaining({
      intent: 'bulk',
      items: expect.arrayContaining([
        expect.objectContaining({ suggestionId: 'r1', productId: 'p1' }),
        expect.objectContaining({ suggestionId: 'r2', productId: 'p2' }),
      ]),
    }));
  });
});
