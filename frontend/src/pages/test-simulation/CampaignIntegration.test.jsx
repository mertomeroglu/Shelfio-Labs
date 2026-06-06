import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../system-settings/Settings.jsx';

const mockSettingsGet = vi.fn();
const mockGetLoginActivities = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetDeveloperLogs = vi.fn();
const mockCategoryList = vi.fn();
const mockCategoryLabelList = vi.fn();
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
vi.mock('../../services/categoryService.js', () => ({
  categoryService: {
    list: (...args) => mockCategoryList(...args),
    listLabels: (...args) => mockCategoryLabelList(...args),
  },
}));
vi.mock('../../services/reportService.js', () => ({ reportService: { getDashboard: (...args) => mockDashboard(...args) } }));
vi.mock('../../services/pricingAnalysisService.js', () => ({ pricingAnalysisService: { getAnalysis: (...args) => mockPricingAnalysis(...args) } }));
vi.mock('../../services/procurementService.js', () => ({ procurementService: { listSuggestions: (...args) => mockPurchaseSuggestions(...args) } }));

const renderCampaignPage = () => render(
  <MemoryRouter initialEntries={['/kampanya-yonetimi?source=pricing']}>
    <Routes>
      <Route path="/kampanya-yonetimi" element={<Settings />} />
    </Routes>
  </MemoryRouter>,
);

describe('CampaignIntegration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pricingCampaignDraft', JSON.stringify({ productIds: ['p1', 'p2'], discountRate: 20 }));

    mockSettingsGet.mockResolvedValue({ customerRelations: { giftCards: [], campaigns: [] } });
    mockGetLoginActivities.mockResolvedValue([]);
    mockGetAuditLogs.mockResolvedValue([]);
    mockGetDeveloperLogs.mockResolvedValue([]);
    mockCategoryList.mockResolvedValue([{ id: 'c1', name: 'Sut' }]);
    mockCategoryLabelList.mockResolvedValue([]);
    mockDashboard.mockResolvedValue({ overview: { totalProducts: 20, totalSuppliers: 3, totalStockQuantity: 300 } });
    mockPricingAnalysis.mockResolvedValue({
      sections: {
        expirationRisk: [{ productId: 'p1', productName: 'Milk', category: 'Sut', currentStock: 50, avgDailySales: 0.7, daysToExpiry: 5, currentPrice: 100, cost: 65 }],
        dynamicPricing: [],
        fastMoving: [],
        slowMoving: [],
        competitorMismatch: [],
      },
    });
    mockPurchaseSuggestions.mockResolvedValue([{ id: 's1', productId: 'p1', productName: 'Milk', currentStock: 45, avgDailySales: 0.8 }]);
  });

  test('creates campaign draft from suggestion and supports bulk list actions', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    const suggestionButtons = await screen.findAllByRole('button', { name: /Öneriden kampanya oluştur/i });
    await user.click(suggestionButtons[0]);
    await user.click(await screen.findByRole('tab', { name: /Genel/i }));

    expect(screen.getByLabelText('Kampanya Adı')).not.toHaveValue('');

    await user.click(screen.getByLabelText('Süresiz Kampanya'));

    await user.click(await screen.findByRole('button', { name: 'Kampanya Ekle' }));
    const checkboxes = await screen.findAllByRole('checkbox');
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });
});

