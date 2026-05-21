import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PricingAnalysis from '../pricing-analysis/PricingAnalysis.jsx';

const mockGetAnalysis = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../services/pricingAnalysisService.js', () => ({
  pricingAnalysisService: {
    getAnalysis: (...args) => mockGetAnalysis(...args),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const sampleResponse = {
  generatedAt: '2026-04-17T08:00:00.000Z',
  sections: {
    expirationRisk: [
      {
        id: 'p1',
        productId: 'p1',
        productName: 'Makarna',
        category: 'Kuru Gida',
        supplierName: 'Tedarikci A',
        sku: 'MAK-1',
        currentPrice: 40,
        cost: 28,
        currentStock: 65,
        avgDailySales: 0.9,
        daysToExpiry: 8,
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

describe('PriceRecommendationsIntegration', () => {
  beforeEach(() => {
    mockGetAnalysis.mockResolvedValue(sampleResponse);
    mockNavigate.mockReset();
    localStorage.clear();
  });

  test('campaign action stores draft and redirects to campaign page', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Makarna')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Makarna satirini sec/i }));
    await user.click(screen.getByRole('button', { name: 'Kampanyaya Ekle' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/kampanya-yonetimi'));
    });

    const stored = localStorage.getItem('pricingCampaignDraft');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored).productIds).toEqual(['p1']);
  });
});
