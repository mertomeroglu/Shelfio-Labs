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
        productName: 'Yogurt',
        category: 'Sut',
        supplierName: 'Tedarikci A',
        sku: 'YOG-1',
        currentPrice: 120,
        cost: 80,
        currentStock: 60,
        avgDailySales: 0.5,
        daysToExpiry: 5,
        riskLevel: 'high',
        discountSuggestion: { discountRate: 25 },
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

describe('PriceRecommendationsFilters', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
  });

  test('updates service query when manual filters change', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Risk Seviyesi');
    expect(mockGetAnalysis).toHaveBeenCalledWith({ risk: '', sktStatus: '', salesSpeed: '', hasSuggestion: '' });

    await user.selectOptions(screen.getByLabelText('Risk Seviyesi'), 'critical');

    await waitFor(() => {
      expect(mockGetAnalysis).toHaveBeenLastCalledWith({
        risk: 'critical',
        sktStatus: '',
        salesSpeed: '',
        hasSuggestion: '',
      });
    });
  });

  test('preset chips can be toggled', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Yogurt');

    const preset = screen.getByRole('button', { name: 'SKT Yaklasanlar' });
    await user.click(preset);
    expect(preset.className).toContain('is-active');

    await user.click(preset);
    expect(preset.className).not.toContain('is-active');
  });
});
