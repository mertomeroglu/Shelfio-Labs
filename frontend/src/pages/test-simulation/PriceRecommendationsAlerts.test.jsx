import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
        productName: 'Yumurta',
        category: 'Kahvalti',
        supplierName: 'Tedarikci A',
        sku: 'YUM-1',
        currentPrice: 90,
        cost: 52,
        currentStock: 44,
        avgDailySales: 0.2,
        daysToExpiry: 2,
        riskLevel: 'critical',
        discountSuggestion: { discountRate: 35 },
      },
    ],
    dynamicPricing: [],
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

describe('PriceRecommendationsAlerts', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
  });

  test('critical filter button applies urgent filter flow', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Oncelikli Fiyat Aksiyonlari')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kritikleri Filtrele' }));

    await waitFor(() => {
      const calls = mockGetAnalysis.mock.calls.map((call) => call[0]);
      expect(calls.some((params) => params?.sktStatus === 'critical')).toBe(true);
    });
  });
});
