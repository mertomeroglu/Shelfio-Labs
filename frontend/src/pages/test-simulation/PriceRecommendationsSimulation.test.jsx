import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
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
        productName: 'Kefir',
        category: 'Sut',
        supplierName: 'Tedarikci A',
        sku: 'KEF-1',
        currentPrice: 100,
        cost: 75,
        currentStock: 70,
        avgDailySales: 0.3,
        daysToExpiry: 4,
        riskLevel: 'high',
        discountSuggestion: { discountRate: 20 },
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

describe('PriceRecommendationsSimulation', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
  });

  test('expands reason panel and updates simulation by quick chips', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Kefir')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Neden?' }));
    expect(screen.getByText('Indirim Simulasyonu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '%30' }));

    expect(screen.getByText('₺70,00')).toBeInTheDocument();
  });
});
