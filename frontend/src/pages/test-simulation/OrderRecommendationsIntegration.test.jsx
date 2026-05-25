import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PurchaseSuggestions from '../purchase-suggestions/PurchaseSuggestions.jsx';

const mockNavigate = vi.fn();
const mockListSuggestions = vi.fn();
const mockGenerateSuggestions = vi.fn();
const mockListSuppliers = vi.fn();
const mockListProducts = vi.fn();
const mockListSupplierProducts = vi.fn();
const mockApproveSuggestion = vi.fn();

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
    approveSuggestion: (...args) => mockApproveSuggestion(...args),
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

const baseRows = [
  {
    id: 'r1',
    productId: 'p1',
    sku: 'SKU-1',
    productName: 'Ürün A',
    status: 'pending',
    supplierId: 's1',
    supplierName: 'Tedarikçi A',
    sold7: 35,
    avgDailySales: 6,
    currentStock: 12,
    leadTimeDays: 8,
    suggestedQty: 20,
    daysToStockout: 2,
    salesTrendLast14Days: [2, 3, 4, 4, 5, 4, 6, 5, 4, 7, 6, 5, 7, 8],
  },
  {
    id: 'r2',
    productId: 'p2',
    sku: 'SKU-2',
    productName: 'Ürün B',
    status: 'approved',
    supplierId: 's2',
    supplierName: 'Tedarikçi B',
    sold7: 0,
    avgDailySales: 0,
    currentStock: 240,
    leadTimeDays: 2,
    suggestedQty: 12,
  },
];

describe('OrderRecommendations integration flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockNavigate.mockReset();
    mockGenerateSuggestions.mockResolvedValue({ ok: true });
    mockApproveSuggestion.mockResolvedValue({ id: 'po-1', orderNumber: 'PO-1' });
    mockListSuggestions.mockResolvedValue(baseRows);
    mockListSuppliers.mockResolvedValue([
      { id: 's1', name: 'Tedarikçi A' },
      { id: 's2', name: 'Tedarikçi B' },
    ]);
    mockListProducts.mockResolvedValue([
      { id: 'p1', minStock: 2, criticalStock: 2, avgDailySales: 6, currentStock: 12 },
      { id: 'p2', minStock: 4, criticalStock: 4, avgDailySales: 0, currentStock: 240 },
    ]);
    mockListSupplierProducts.mockResolvedValue([
      { supplierProductId: 'sp-1', productId: 'p1', supplierId: 's1', leadTimeDays: 8 },
      { supplierProductId: 'sp-2', productId: 'p2', supplierId: 's2', leadTimeDays: 2 },
    ]);
  });

  test('refresh button retriggers generation and detail modal works with dynamic reasons', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Sipariş Önerisi Üret/i }));

    await waitFor(() => {
      expect(mockGenerateSuggestions).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: /Ürün A için diğer işlemler/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Detay' }));

    const detailTitle = await screen.findByText('Öneri Detayı');
    const detailModal = detailTitle.closest('.order-suggestion-detail-modal');
    expect(detailModal).toBeInTheDocument();
    expect(within(detailModal).getByText('SKU')).toBeInTheDocument();
    expect(within(detailModal).getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getAllByText('20 adet').length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Son 7 günde/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Siparişe Dönüştür' }).length).toBeGreaterThan(1);
  });

  test('draft edit action routes to siparis-olustur with prepared payload and leaves archiving to the target page', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Ürün A için diğer işlemler/i }));
    expect(await screen.findByRole('menuitem', { name: 'Reddet' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Öneriyi Taslakta Düzenle' }));

    expect(screen.queryByText('Tekli Satın Alım Onayı')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/siparis-olustur?'),
      expect.objectContaining({
        state: expect.objectContaining({
          from: '/siparis-onerileri',
          purchaseSuggestion: expect.objectContaining({
            suggestionId: 'r1',
            productName: 'Ürün A',
            supplierId: 's1',
            recommendedQuantity: 20,
          }),
          purchaseSuggestionFlow: expect.objectContaining({
            mode: 'single',
          }),
        }),
      }),
    );

    expect(mockNavigate.mock.calls[0][0]).toContain('intent=single');
    expect(mockNavigate.mock.calls[0][0]).toContain('handoffId=');
    expect(JSON.parse(window.localStorage.getItem('shelfio.purchaseSuggestions.archive.v1') || '{}')).toEqual({});
    const storedHandoffs = JSON.parse(window.sessionStorage.getItem('shelfio.purchaseSuggestions.handoffs.v1') || '{}');
    const handoffIds = Object.keys(storedHandoffs);
    expect(handoffIds).toHaveLength(1);
    expect(storedHandoffs[handoffIds[0]]).toEqual(expect.objectContaining({
      intent: 'single',
      items: [
        expect.objectContaining({
          suggestionId: 'r1',
          productId: 'p1',
          supplierId: 's1',
          supplierProductId: 'sp-1',
        }),
      ],
    }));
  });

  test('convert action creates order without leaving purchase suggestions page', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PurchaseSuggestions />
      </MemoryRouter>
    );

    expect((await screen.findAllByText('Ürün A')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Siparişe Dönüştür' }));

    await waitFor(() => {
      expect(mockApproveSuggestion).toHaveBeenCalledWith('r1', {});
    });

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/siparis-takibi',
      expect.anything(),
    );
    expect((await screen.findAllByText(/olu/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Detaya Git' })).toBeInTheDocument();
  });
});
