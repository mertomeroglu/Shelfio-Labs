import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../system-settings/Settings.jsx';

const mockSettingsGet = vi.fn();
const mockGetLoginActivities = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetDeveloperLogs = vi.fn();
const mockCategoryList = vi.fn();
const mockDashboard = vi.fn();
const mockPricingAnalysis = vi.fn();
const mockPurchaseSuggestions = vi.fn();

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('../../services/settingsService.js', () => ({
  settingsService: {
    get: (...args) => mockSettingsGet(...args),
    update: vi.fn(),
    getLoginActivities: (...args) => mockGetLoginActivities(...args),
    getAuditLogs: (...args) => mockGetAuditLogs(...args),
    getDeveloperLogs: (...args) => mockGetDeveloperLogs(...args),
    updateSystemDeskPin: vi.fn(),
    sendDeveloperLog: vi.fn(),
  },
}));

vi.mock('../../services/categoryService.js', () => ({ categoryService: { list: (...args) => mockCategoryList(...args) } }));
vi.mock('../../services/reportService.js', () => ({ reportService: { getDashboard: (...args) => mockDashboard(...args) } }));
vi.mock('../../services/pricingAnalysisService.js', () => ({ pricingAnalysisService: { getAnalysis: (...args) => mockPricingAnalysis(...args) } }));
vi.mock('../../services/procurementService.js', () => ({ procurementService: { listSuggestions: (...args) => mockPurchaseSuggestions(...args) } }));

const renderCampaignPage = () => render(
  <MemoryRouter initialEntries={['/kampanya-yonetimi']}>
    <Routes>
      <Route path="/kampanya-yonetimi" element={<Settings />} />
    </Routes>
  </MemoryRouter>,
);

describe('CampaignSimulation', () => {
  beforeEach(() => {
    mockSettingsGet.mockResolvedValue({ customerRelations: { giftCards: [], campaigns: [] } });
    mockGetLoginActivities.mockResolvedValue([]);
    mockGetAuditLogs.mockResolvedValue([]);
    mockGetDeveloperLogs.mockResolvedValue([]);
    mockCategoryList.mockResolvedValue([{ id: 'c1', name: 'Sut' }]);
    mockDashboard.mockResolvedValue({ overview: { totalProducts: 10, totalSuppliers: 2, totalStockQuantity: 140 } });
    mockPricingAnalysis.mockResolvedValue({ sections: { expirationRisk: [{ productId: 'p1', currentStock: 50, avgDailySales: 0.8, daysToExpiry: 8, currentPrice: 100, cost: 65 }], dynamicPricing: [], fastMoving: [], slowMoving: [], competitorMismatch: [] } });
    mockPurchaseSuggestions.mockResolvedValue([]);
  });

  test('simulation panel updates when discount input changes', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    const generalTab = await screen.findByRole('tab', { name: /Genel/i });
    await user.click(generalTab);

    const discountInput = screen.getByLabelText('İndirim Oranı (%)');
    await user.clear(discountInput);
    await user.type(discountInput, '25');

    expect(screen.getByText('Impact Simulation')).toBeInTheDocument();
    expect(screen.getByText(/Estimated sales increase/i)).toBeInTheDocument();
  });
});

