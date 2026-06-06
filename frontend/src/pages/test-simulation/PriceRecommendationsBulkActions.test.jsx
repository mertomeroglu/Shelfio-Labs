import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PricingAnalysis from '../pricing-analysis/PricingAnalysis.jsx';

const mockGetSummary = vi.fn();
const mockGetRows = vi.fn();
const mockProductList = vi.fn();
const mockProductUpdate = vi.fn();
const mockCategoryList = vi.fn();
const mockLabelList = vi.fn();

vi.mock('../../services/pricingAnalysisService.js', () => ({
  pricingAnalysisService: {
    getSummary: (...args) => mockGetSummary(...args),
    getRows: (...args) => mockGetRows(...args),
    invalidateCache: vi.fn(),
  },
}));

vi.mock('../../services/productService.js', async () => {
  const actual = await vi.importActual('../../services/productService.js');
  return {
    ...actual,
    productService: {
      list: (...args) => mockProductList(...args),
      update: (...args) => mockProductUpdate(...args),
    },
  };
});

vi.mock('../../services/categoryService.js', () => ({
  categoryService: {
    list: (...args) => mockCategoryList(...args),
    listLabels: (...args) => mockLabelList(...args),
  },
}));

const sampleSummary = {
  generatedAt: '2026-04-17T08:00:00.000Z',
  summary: {
    totalAnalyzedProducts: 2,
    highRiskProducts: 1,
    discountSuggestedProducts: 2,
  },
};

const sampleRows = [
  {
    id: 'p1',
    productId: 'p1',
    productName: 'Sut 1L',
    category: 'Sut',
    supplierName: 'Tedarikci A',
    sku: 'SUT-1',
    currentPrice: 80,
    cost: 55,
    currentStock: 50,
    avgDailySales: 0.8,
    daysToExpiry: 4,
    riskLevel: 'high',
    discountSuggestion: { discountRate: 15 },
  },
  {
    id: 'p2',
    productId: 'p2',
    productName: 'Ayran 300ml',
    category: 'Sut',
    supplierName: 'Tedarikci A',
    sku: 'AYR-2',
    currentPrice: 50,
    cost: 34,
    currentStock: 44,
    avgDailySales: 0.7,
    daysToExpiry: 5,
    riskLevel: 'medium',
    discountSuggestion: { discountRate: 10 },
  },
];

const productRows = [
  {
    id: 'plain',
    productId: 'plain',
    name: 'Kampanyasiz Urun',
    productName: 'Kampanyasiz Urun',
    sku: 'PLAIN-1',
    categoryId: 'cat-1',
    categoryName: 'Sut',
    salePrice: 100,
    currentPrice: 100,
    purchasePrice: 80,
  },
  {
    id: 'campaign',
    productId: 'campaign',
    name: 'Kampanyali Urun',
    productName: 'Kampanyali Urun',
    sku: 'CAMP-1',
    categoryId: 'cat-1',
    categoryName: 'Sut',
    salePrice: 100,
    currentPrice: 70,
    campaignPrice: 70,
    discountedPrice: 70,
    purchasePrice: 80,
    hasActiveDiscount: true,
    activeCampaign: {
      name: 'Aktif Kampanya',
      discountRate: 30,
      effectiveDiscountRate: 30,
      appliedMode: 'rate',
    },
  },
];

const renderPage = () => render(
  <MemoryRouter>
    <PricingAnalysis />
  </MemoryRouter>,
);

describe('PriceRecommendationsBulkActions', () => {
  beforeEach(() => {
    mockGetSummary.mockResolvedValue(sampleSummary);
    mockGetRows.mockResolvedValue(sampleRows);
    mockProductList.mockResolvedValue(productRows);
    mockProductUpdate.mockResolvedValue({});
    mockCategoryList.mockResolvedValue([{ id: 'cat-1', name: 'Sut' }]);
    mockLabelList.mockResolvedValue([]);
  });

  test('shows and uses bulk action bar for selected rows', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Sut 1L')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Sut 1L satirini sec/i }));
    await user.click(screen.getByRole('checkbox', { name: /Ayran 300ml satirini sec/i }));

    expect(screen.getByText('2 urun secili')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Toplu indirim (%)'));
    await user.type(screen.getByLabelText('Toplu indirim (%)'), '25');
    await user.click(screen.getByRole('button', { name: 'Toplu Indirim Uygula' }));

    expect(await screen.findByText(/simulasyon indirimi uygulandi/i)).toBeInTheDocument();
  });

  test('separates regular margin risk from active campaign effective price risk in bulk preview', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Sut 1L')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Toplu Fiyat Güncelleme/i }));
    await user.click(screen.getByRole('button', { name: 'Ürün Bazlı' }));
    await user.type(screen.getByLabelText('Ürün ara'), 'Kampanyali');
    await user.click(await screen.findByRole('button', { name: /Kampanyali Urun/i }));
    await user.clear(screen.getByLabelText('Değer'));
    await user.type(screen.getByLabelText('Değer'), '10');

    expect(await screen.findByText(/aktif kampanya nedeniyle efektif fiyat maliyet altında kalıyor/i)).toBeInTheDocument();
    expect(screen.getByText('Aktif kampanya fiyatı maliyet altında')).toBeInTheDocument();
    expect(screen.getByText(/Regular: .*100,00.*110,00/i)).toBeInTheDocument();
  });
});
