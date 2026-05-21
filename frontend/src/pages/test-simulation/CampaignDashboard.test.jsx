import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../system-settings/Settings.jsx';

const mockSettingsGet = vi.fn();
const mockSettingsUpdate = vi.fn();
const mockGetLoginActivities = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetDeveloperLogs = vi.fn();
const mockCategoryList = vi.fn();
const mockDashboard = vi.fn();
const mockPricingAnalysis = vi.fn();
const mockPurchaseSuggestions = vi.fn();
const mockProductList = vi.fn();
const mockUserList = vi.fn();
const mockCustomerList = vi.fn();
const mockAssignGiftCard = vi.fn();

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('../../services/settingsService.js', () => ({
  settingsService: {
    get: (...args) => mockSettingsGet(...args),
    update: (...args) => mockSettingsUpdate(...args),
    getLoginActivities: (...args) => mockGetLoginActivities(...args),
    getAuditLogs: (...args) => mockGetAuditLogs(...args),
    getDeveloperLogs: (...args) => mockGetDeveloperLogs(...args),
    updateSystemDeskPin: vi.fn(),
    sendDeveloperLog: vi.fn(),
  },
}));

vi.mock('../../services/categoryService.js', () => ({
  categoryService: { list: (...args) => mockCategoryList(...args) },
}));

vi.mock('../../services/productService.js', () => ({
  productService: { list: (...args) => mockProductList(...args) },
}));

vi.mock('../../services/reportService.js', () => ({
  reportService: { getDashboard: (...args) => mockDashboard(...args) },
}));

vi.mock('../../services/pricingAnalysisService.js', () => ({
  pricingAnalysisService: { getAnalysis: (...args) => mockPricingAnalysis(...args) },
}));

vi.mock('../../services/procurementService.js', () => ({
  procurementService: { listSuggestions: (...args) => mockPurchaseSuggestions(...args) },
}));

vi.mock('../../services/userService.js', () => ({
  userService: { list: (...args) => mockUserList(...args) },
}));

vi.mock('../../services/customerAdminService.js', () => ({
  customerAdminService: {
    list: (...args) => mockCustomerList(...args),
    assignGiftCard: (...args) => mockAssignGiftCard(...args),
  },
}));

const renderCampaignPage = () => render(
  <MemoryRouter initialEntries={['/kampanya-yonetimi']}>
    <Routes>
      <Route path="/kampanya-yonetimi" element={<Settings />} />
    </Routes>
  </MemoryRouter>,
);

describe('CampaignDashboard', () => {
  beforeEach(() => {
    mockSettingsGet.mockResolvedValue({
      updatedAt: '2026-04-17T10:00:00.000Z',
      customerRelations: { giftCards: [], campaigns: [] },
      overview: {},
    });
    mockSettingsUpdate.mockResolvedValue({ ok: true });
    mockGetLoginActivities.mockResolvedValue([]);
    mockGetAuditLogs.mockResolvedValue([]);
    mockGetDeveloperLogs.mockResolvedValue([]);
    mockCategoryList.mockResolvedValue([{ id: 'c1', name: 'Sut' }]);
    mockProductList.mockResolvedValue([
      { id: 'p1', name: 'Milk', categoryId: 'c1', categoryName: 'Sut', brand: 'Mis', currentStock: 60, avgDailySales: 0.5, currentPrice: 100, cost: 65, daysToExpiry: 3 },
      { id: 'p2', name: 'Cheese', categoryId: 'c1', categoryName: 'Sut', brand: 'Mis', currentStock: 55, avgDailySales: 1, currentPrice: 120, cost: 70, daysToExpiry: 12 },
      { id: 'p3', name: 'Yogurt', categoryId: 'c1', categoryName: 'Sut', brand: 'Mis', currentStock: 48, avgDailySales: 0.8, currentPrice: 90, cost: 58, daysToExpiry: 9 },
    ]);
    mockUserList.mockResolvedValue([{ id: 'u1', name: 'Yönetici' }]);
    mockCustomerList.mockResolvedValue([
      { id: 'cust-1', customerNo: '00000006', name: 'Zeynep ^ahin', phone: '5443197602', email: 'zeynep@shelfio.test', isActive: true, giftCards: [] },
    ]);
    mockAssignGiftCard.mockResolvedValue({ ok: true });
    mockDashboard.mockResolvedValue({ overview: { totalProducts: 100, totalSuppliers: 12, totalStockQuantity: 980 } });
    mockPricingAnalysis.mockResolvedValue({
      sections: {
        expirationRisk: [{ productId: 'p1', productName: 'Milk', category: 'Sut', brand: 'Mis', currentStock: 60, avgDailySales: 0.5, daysToExpiry: 3, currentPrice: 100, cost: 65 }],
        dynamicPricing: [{ productId: 'p2', productName: 'Cheese', category: 'Sut', brand: 'Mis', currentStock: 55, avgDailySales: 1, daysToExpiry: 12, currentPrice: 120, cost: 70 }],
        fastMoving: [],
        slowMoving: [],
        competitorMismatch: [],
      },
    });
    mockPurchaseSuggestions.mockResolvedValue([{ id: 's1', productId: 'p1', productName: 'Milk', currentStock: 45, avgDailySales: 1 }]);
  });

  test('shows campaign home summary and suggested campaigns on main tab', async () => {
    renderCampaignPage();

    expect(await screen.findByText('Ana Sayfa Karar Özeti')).toBeInTheDocument();
    expect((await screen.findAllByText('Önerilen Kampanyalar')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: /Kampanya Oluştur/i })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: /Detay/i })).length).toBeGreaterThanOrEqual(5);
  });

  test('tabs are actionable and can switch to Genel view', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    const genelTab = await screen.findByRole('tab', { name: /Genel/i });
    await user.click(genelTab);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Genel/i })).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('assigns a gift card to a customer from the gift card tab', async () => {
    const user = userEvent.setup();
    mockSettingsGet.mockResolvedValueOnce({
      updatedAt: '2026-04-17T10:00:00.000Z',
      customerRelations: {
        giftCards: [{ id: 'g1', code: 'GC100', name: 'Sadakat Kartı', valueType: 'amount', value: 150, isActive: true, createdAt: '2026-04-15T10:00:00.000Z' }],
        campaigns: [],
        automationCenter: { enabled: false, autoCreateTasks: false, notifyOnCritical: true, taskAssigneeUserId: '', rules: [] },
      },
      overview: {},
    });

    renderCampaignPage();

    const giftCardTab = await screen.findByRole('tab', { name: /Hediye Kartı/i });
    await user.click(giftCardTab);

    expect(await screen.findByRole('option', { name: /Zeynep Şahin/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Hediye Kartı'), 'GC100');
    await user.selectOptions(screen.getByLabelText('Müşteri Seç'), 'cust-1');
    await user.click(screen.getByRole('button', { name: /Müşteriye Ata/i }));

    await waitFor(() => {
      expect(mockAssignGiftCard).toHaveBeenCalledWith('cust-1', { code: 'GC100' });
    });
  });
});
