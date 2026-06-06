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
        productName: 'Krema',
        category: 'Sut',
        supplierName: 'Tedarikci A',
        sku: 'KRE-1',
        currentPrice: 100,
        cost: 90,
        currentStock: 40,
        avgDailySales: 0.8,
        daysToExpiry: 3,
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

describe('PriceRecommendationsMargin', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
  });

  test('highlights risky post-discount margin values', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Krema')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Neden?' }));
    await user.click(screen.getByRole('button', { name: '%30' }));

    const dangerCell = document.querySelector('.pricing-emphasis.is-danger');
    expect(dangerCell).toBeTruthy();
  });
});
