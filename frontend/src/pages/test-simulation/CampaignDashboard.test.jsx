import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CampaignManagement from '../campaign-management/CampaignManagement.jsx';

const mockSettingsGet = vi.fn();
const mockSettingsUpdate = vi.fn();
const mockGetLoginActivities = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetDeveloperLogs = vi.fn();
const mockCategoryList = vi.fn();
const mockCategoryLabelList = vi.fn();
const mockDashboard = vi.fn();
const mockPricingAnalysis = vi.fn();
const mockCampaignSuggestions = vi.fn();
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
  categoryService: {
    list: (...args) => mockCategoryList(...args),
    listLabels: (...args) => mockCategoryLabelList(...args),
  },
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

vi.mock('../../services/campaignAnalysisService.js', () => ({
  campaignAnalysisService: { getSuggestions: (...args) => mockCampaignSuggestions(...args) },
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
      <Route path="/kampanya-yonetimi" element={<CampaignManagement />} />
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
    mockCategoryLabelList.mockResolvedValue([]);
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
    mockCampaignSuggestions.mockResolvedValue({
      rows: [],
      eligibleProductCount: 3,
      suggestions: Array.from({ length: 5 }, (_, index) => ({
        id: `test-campaign-suggestion-${index + 1}`,
        title: `Kampanya Önerisi ${index + 1}`,
        type: 'product',
        sourceModule: 'product',
        moduleLabel: 'Ürün Bazlı',
        recommendationType: 'discount_opportunity',
        priority: index === 0 ? 'high' : 'medium',
        affectedProductCount: 1,
        productIds: ['p1'],
        recommendedDiscount: 10 + index,
        reason: 'Satış ve stok sinyali kampanya için uygun.',
        suggestedAction: 'Kampanya oluştur',
      })),
      suppressedSuggestions: [
        {
          id: 'suppressed-test-campaign-suggestion',
          title: 'Bastırılmış öneri',
          type: 'product',
          sourceModule: 'product',
          isSuppressed: true,
          affectedProductCount: 0,
        },
      ],
    });
    mockPurchaseSuggestions.mockResolvedValue([{ id: 's1', productId: 'p1', productName: 'Milk', currentStock: 45, avgDailySales: 1 }]);
  });

  test('shows campaign home summary and suggested campaigns on main tab', async () => {
    renderCampaignPage();

    expect(await screen.findByText('Ana Sayfa Karar Özeti')).toBeInTheDocument();
    expect((await screen.findAllByText('Kampanya Öneri Adayları')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: /Kampanya Oluştur/i })).length).toBeGreaterThan(0);
    const actionMenus = await screen.findAllByRole('button', { name: /Diğer aksiyonlar/i });
    expect(actionMenus.length).toBeGreaterThanOrEqual(5);
    await userEvent.click(actionMenus[0]);
    expect(await screen.findByRole('menuitem', { name: /Detay/i })).toBeInTheDocument();
  });

  test('tabs are actionable and can switch to product view', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    const productTab = await screen.findByRole('tab', { name: /Ürün Bazlı/i });
    await user.click(productTab);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Ürün Bazlı/i })).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('keeps campaign drafts isolated between category, product and brand tabs', async () => {
    const user = userEvent.setup();
    renderCampaignPage();

    await user.click(await screen.findByRole('tab', { name: /Kategori Bazlı/i }));
    await user.type(await screen.findByLabelText(/Kampanya Adı/i), 'Hafta Sonu Kategori İndirimi');
    await user.clear(screen.getByLabelText(/İndirim Oranı/i));
    await user.type(screen.getByLabelText(/İndirim Oranı/i), '20');
    await user.type(screen.getByLabelText(/Başlangıç Tarihi/i), '2026-06-01');
    await user.type(screen.getByLabelText(/Bitiş Tarihi/i), '2026-06-07');

    await user.click(screen.getByRole('tab', { name: /Ürün Bazlı/i }));
    expect(screen.getByLabelText(/Kampanya Adı/i)).toHaveValue('');
    expect(screen.getByLabelText(/İndirim Oranı/i)).toHaveValue(null);
    await user.type(screen.getByLabelText(/Kampanya Adı/i), 'Ürün Taslağı');

    await user.click(screen.getByRole('tab', { name: /Marka Bazlı/i }));
    expect(screen.getByLabelText(/Kampanya Adı/i)).toHaveValue('');

    await user.click(screen.getByRole('tab', { name: /Kategori Bazlı/i }));
    expect(screen.getByLabelText(/Kampanya Adı/i)).toHaveValue('Hafta Sonu Kategori İndirimi');
    expect(screen.getByLabelText(/İndirim Oranı/i)).toHaveValue(20);
    expect(screen.getByLabelText(/Başlangıç Tarihi/i)).toHaveValue('2026-06-01');
    expect(screen.getByLabelText(/Bitiş Tarihi/i)).toHaveValue('2026-06-07');

    await user.click(screen.getByRole('tab', { name: /Ürün Bazlı/i }));
    expect(screen.getByLabelText(/Kampanya Adı/i)).toHaveValue('Ürün Taslağı');
  });

  test('keeps the gift card tab on its separate draft flow', async () => {
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

    expect(await screen.findByText('Yeni Hediye Kartı')).toBeInTheDocument();
    expect(screen.getByLabelText(/Kart Adı/i)).toHaveValue('');
    expect(screen.queryByLabelText(/Kampanya Adı/i)).not.toBeInTheDocument();
  });
});
