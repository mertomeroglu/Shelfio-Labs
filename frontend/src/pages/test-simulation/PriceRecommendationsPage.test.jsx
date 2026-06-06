import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import PricingAnalysis from '../pricing-analysis/PricingAnalysis.jsx';

const mockGetAnalysis = vi.fn();

vi.mock('../../services/pricingAnalysisService.js', () => ({
  pricingAnalysisService: {
    getAnalysis: (...args) => mockGetAnalysis(...args),
  },
}));

const sampleResponse = {
  generatedAt: '2026-04-17T08:00:00.000Z',
  sections: {
    expirationRisk: [
      {
        id: 'p1',
        productId: 'p1',
        productName: 'Elma Suyu',
        category: 'Icecek',
        supplierName: 'Tedarikci A',
        sku: 'ELM-1',
        currentPrice: 100,
        cost: 70,
        currentStock: 56,
        avgDailySales: 0.4,
        daysToExpiry: 2,
        riskLevel: 'high',
        discountSuggestion: { discountRate: 30 },
      },
    ],
    dynamicPricing: [
      {
        id: 'p2',
        productId: 'p2',
        productName: 'Peynir',
        category: 'Sut',
        supplierName: 'Tedarikci B',
        sku: 'PEY-2',
        currentPrice: 200,
        cost: 120,
        currentStock: 20,
        avgDailySales: 5,
        daysToExpiry: 25,
        riskLevel: 'medium',
        discountSuggestion: { discountRate: 10 },
      },
    ],
    fastMoving: [],
    slowMoving: [],
    competitorMismatch: [],
  },
};

const renderPage = () => render(
  <MemoryRouter>
    <PricingAnalysis />
  </MemoryRouter>,
);

describe('PriceRecommendationsPage', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
  });

  test('renders summary cards and recommendation list', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Fiyat & Talep Analizi' })).toBeInTheDocument();
    expect(await screen.findByText('Toplam Öneri')).toBeInTheDocument();
    expect(await screen.findByText('Acil İşlem')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetAnalysis).toHaveBeenCalled();
    });

    expect((await screen.findAllByText('Elma Suyu')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Peynir')).length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Fiyat aksiyon tablosu' })).toBeInTheDocument();
  });

  test('shows critical hero when urgent rows exist', async () => {
    renderPage();

    expect(await screen.findByText('Öncelikli Fiyat Aksiyonları')).toBeInTheDocument();
    expect(screen.getByText(/acil indirim veya fiyat koruma değerlendirmesi bekliyor/i)).toBeInTheDocument();
  });
});

