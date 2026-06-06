import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import SupplierProducts from '../order-creation/SupplierProducts.jsx';

const mockListSupplierProducts = vi.fn();
const mockHasSupplierProductsCache = vi.fn();
const mockListProducts = vi.fn();
const mockHasProductsCache = vi.fn();
const mockListSuppliers = vi.fn();
const mockHasSuppliersCache = vi.fn();
const mockGetStocks = vi.fn();
const mockHasStocksCache = vi.fn();
const mockGetSettings = vi.fn();
const mockListLogisticsTariffs = vi.fn();
const mockGetLogisticsQuote = vi.fn();

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'admin', name: 'Test Kullanıcı' } }),
}));

vi.mock('../../services/productService.js', () => ({
  productService: {
    list: (...args) => mockListProducts(...args),
    hasListCache: (...args) => mockHasProductsCache(...args),
  },
}));

vi.mock('../../services/supplierService.js', () => ({
  supplierService: {
    list: (...args) => mockListSuppliers(...args),
    hasListCache: (...args) => mockHasSuppliersCache(...args),
  },
}));

vi.mock('../../services/stockService.js', () => ({
  stockService: {
    getStocks: (...args) => mockGetStocks(...args),
    hasStocksCache: (...args) => mockHasStocksCache(...args),
  },
}));

vi.mock('../../services/settingsService.js', () => ({
  settingsService: {
    get: (...args) => mockGetSettings(...args),
  },
}));

vi.mock('../../services/procurementService.js', () => ({
  procurementService: {
    listSupplierProducts: (...args) => mockListSupplierProducts(...args),
    hasSupplierProductsCache: (...args) => mockHasSupplierProductsCache(...args),
    listLogisticsTariffs: (...args) => mockListLogisticsTariffs(...args),
    getLogisticsQuote: (...args) => mockGetLogisticsQuote(...args),
    createOrder: vi.fn(),
    createBulkOrders: vi.fn(),
    updateSupplierProduct: vi.fn(),
    createSupplierProduct: vi.fn(),
    deleteSupplierProduct: vi.fn(),
    removeSupplierProduct: vi.fn(),
  },
}));

const HANDOFF_KEY = 'shelfio.purchaseSuggestions.handoffs.v1';

const product = {
  id: 'p1',
  name: 'Test Ürün',
  sku: 'SKU-1',
  barcode: '8690001',
  unit: 'adet',
  criticalStock: 5,
};

const supplier = {
  id: 's1',
  name: 'Test Tedarikçi',
  isActive: true,
  teslimatPerformansi: 92,
};

const supplierProduct = {
  id: 'sp-1',
  supplierProductId: 'sp-1',
  productId: 'p1',
  productName: 'Test Ürün',
  productSku: 'SKU-1',
  supplierId: 's1',
  supplierName: 'Test Tedarikçi',
  supplierProductName: 'Test Ürün',
  supplierSku: 'SKU-1',
  purchasePrice: 10,
  currency: 'TRY',
  minimumOrderQty: 1,
  priceUnit: 'adet',
  minOrderUnit: 'adet',
  defaultOrderUnit: 'adet',
  isActive: true,
};

const seedHandoff = (item) => {
  window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
    h1: {
      source: 'oneriler',
      intent: 'single',
      createdAt: '2026-05-24T10:00:00.000Z',
      items: [item],
    },
  }));
};

const renderDraft = () => render(
  <MemoryRouter initialEntries={['/siparis-olustur?source=oneriler&intent=single&handoffId=h1']}>
    <SupplierProducts />
  </MemoryRouter>
);

describe('order suggestion draft handoff resolution', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockListSupplierProducts.mockReset();
    mockHasSupplierProductsCache.mockReturnValue(false);
    mockHasProductsCache.mockReturnValue(false);
    mockHasSuppliersCache.mockReturnValue(false);
    mockHasStocksCache.mockReturnValue(false);
    mockListProducts.mockResolvedValue([product]);
    mockListSuppliers.mockResolvedValue([supplier]);
    mockGetStocks.mockResolvedValue([{ productId: 'p1', totalStock: 2, shelfStock: 1, warehouseStock: 1 }]);
    mockGetSettings.mockResolvedValue({ branchCode: 'BR-1' });
    mockListLogisticsTariffs.mockResolvedValue([]);
    mockGetLogisticsQuote.mockResolvedValue({ totalCost: 0, serviceLevel: 'standard' });
  });

  test('opens draft by resolving exact supplierProductId from handoff', async () => {
    seedHandoff({
      suggestionId: 'r1',
      supplierProductId: 'sp-1',
      productId: 'p1',
      supplierId: 's1',
      productName: 'Test Ürün',
      sku: 'SKU-1',
      recommendedQuantity: 4,
      orderUnit: 'adet',
    });
    mockListSupplierProducts.mockImplementation((params = {}) => {
      if (params.supplierProductId === 'sp-1') return Promise.resolve([supplierProduct]);
      return Promise.resolve([]);
    });

    renderDraft();

    await waitFor(() => {
      expect(mockListSupplierProducts).toHaveBeenCalledWith(expect.objectContaining({ supplierProductId: 'sp-1' }));
    });
    expect(await screen.findByText(/Adet Fiyat/)).toBeInTheDocument();
    expect(screen.queryByText('Taslak Açılamadı')).not.toBeInTheDocument();
  });

  test('opens draft by resolving productId and supplierId when supplierProductId is missing', async () => {
    seedHandoff({
      suggestionId: 'r1',
      productId: 'p1',
      supplierId: 's1',
      productName: 'Test Ürün',
      sku: 'SKU-1',
      recommendedQuantity: 4,
      orderUnit: 'adet',
    });
    mockListSupplierProducts.mockImplementation((params = {}) => {
      if (params.productId === 'p1' && params.supplierId === 's1') return Promise.resolve([supplierProduct]);
      return Promise.resolve([]);
    });

    renderDraft();

    await waitFor(() => {
      expect(mockListSupplierProducts).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', supplierId: 's1' }));
    });
    expect(await screen.findByText(/Adet Fiyat/)).toBeInTheDocument();
    expect(screen.queryByText('Taslak Açılamadı')).not.toBeInTheDocument();
  });

  test('does not show a missing-match error while exact lookup is still loading', async () => {
    let resolveLookup;
    seedHandoff({
      suggestionId: 'r1',
      supplierProductId: 'sp-1',
      productId: 'p1',
      supplierId: 's1',
      productName: 'Test Ürün',
      sku: 'SKU-1',
      recommendedQuantity: 4,
      orderUnit: 'adet',
    });
    mockListSupplierProducts.mockImplementation((params = {}) => {
      if (params.supplierProductId === 'sp-1') {
        return new Promise((resolve) => {
          resolveLookup = () => resolve([supplierProduct]);
        });
      }
      return Promise.resolve([]);
    });

    renderDraft();

    await waitFor(() => {
      expect(mockListSupplierProducts).toHaveBeenCalledWith(expect.objectContaining({ supplierProductId: 'sp-1' }));
    });
    expect(screen.queryByText('Taslak Açılamadı')).not.toBeInTheDocument();

    resolveLookup();
    expect(await screen.findByText(/Adet Fiyat/)).toBeInTheDocument();
  });

  test('shows specific supplier connection error and consumes stale handoff when mapping is really missing', async () => {
    seedHandoff({
      suggestionId: 'r1',
      productId: 'p1',
      supplierId: 's1',
      productName: 'Test Ürün',
      sku: 'SKU-1',
      recommendedQuantity: 4,
      orderUnit: 'adet',
    });
    mockListSupplierProducts.mockResolvedValue([]);

    renderDraft();

    expect(await screen.findByText('Taslak Açılamadı')).toBeInTheDocument();
    expect(screen.getByText('Ürün bulundu ancak geçerli tedarikçi bağlantısı alınamadı.')).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(window.sessionStorage.getItem(HANDOFF_KEY) || '{}');
      expect(stored.h1).toBeUndefined();
    });
  });
});
