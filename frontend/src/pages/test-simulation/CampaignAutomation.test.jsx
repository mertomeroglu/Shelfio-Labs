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

vi.mock('../../hooks/useAuth.js', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
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

describe('CampaignAutomation', () => {
  beforeEach(() => {
    mockSettingsGet.mockResolvedValue({ customerRelations: { giftCards: [], campaigns: [], automationCenter: { rules: [] } } });
    mockGetLoginActivities.mockResolvedValue([]);
    mockGetAuditLogs.mockResolvedValue([]);
    mockGetDeveloperLogs.mockResolvedValue([]);
    mockCategoryList.mockResolvedValue([]);
    mockDashboard.mockResolvedValue({ overview: { totalProducts: 10, totalSuppliers: 2, totalStockQuantity: 140 } });
    mockPricingAnalysis.mockResolvedValue({ sections: { expirationRisk: [], dynamicPricing: [], fastMoving: [], slowMoving: [], competitorMismatch: [] } });
    mockPurchaseSuggestions.mockResolvedValue([]);
  });

  test('adds automation rule and renders automation history table', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    await user.click(await screen.findByRole('tab', { name: /Otomasyon/i }));

    await user.type(screen.getByLabelText('Kural Adı'), 'Dusen satis kurali');
    await user.click(screen.getByRole('button', { name: 'Kural Ekle' }));

    expect(await screen.findByText('Dusen satis kurali')).toBeInTheDocument();
    expect(screen.getByLabelText('Automation history')).toBeInTheDocument();
  });
});

