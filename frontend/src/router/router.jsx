import { Suspense, lazy } from 'react';
import RootWrapper from '../components/RootWrapper.jsx';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import Login from '../pages/login/Login.jsx';
import RouteError from '../pages/_shared/route-error/RouteError.jsx';
import PersonnelLogin from '../pages/personnel-mobile/PersonnelLogin.jsx';
import PersonnelProtectedRoute from '../components/PersonnelProtectedRoute.jsx';
import PageLoading from '../components/PageLoading.jsx';
import { useAuth } from '../hooks/useAuth.js';

const PersonnelShell = lazy(() => import('../components/PersonnelShell.jsx'));
const PersonnelMobile = lazy(() => import('../pages/personnel-mobile/PersonnelMobile.jsx'));

const Dashboard = lazy(() => import('../pages/dashboard/Dashboard.jsx'));
const Products = lazy(() => import('../pages/product-management/Products.jsx'));
const Categories = lazy(() => import('../pages/category-management/Categories.jsx'));
const Suppliers = lazy(() => import('../pages/supplier-management/Suppliers.jsx'));
const StockMovements = lazy(() => import('../pages/stock-operations/StockMovements.jsx'));
const StockExpiryTracking = lazy(() => import('../pages/stock-expiry-tracking/StockExpiryTracking.jsx'));
const Tasks = lazy(() => import('../pages/task-planning/Tasks.jsx'));
const Reports = lazy(() => import('../pages/reporting/Reports.jsx'));
const Users = lazy(() => import('../pages/user-management/Users.jsx'));
const Settings = lazy(() => import('../pages/system-settings/Settings.jsx'));
const CampaignManagement = lazy(() => import('../pages/campaign-management/CampaignManagement.jsx'));
const BarcodeOperations = lazy(() => import('../pages/barcode-operations/BarcodeOperations.jsx'));
const ESLManagement = lazy(() => import('../pages/esl-management/ESLManagement.jsx'));
const POSGate = lazy(() => import('../pages/pos/POSGate.jsx'));
const POSHub = lazy(() => import('../pages/pos/POSHub.jsx'));
const PurchaseSuggestions = lazy(() => import('../pages/purchase-suggestions/PurchaseSuggestions.jsx'));
const PurchaseOrders = lazy(() => import('../pages/purchase-orders/PurchaseOrders.jsx'));
const PricingAnalysis = lazy(() => import('../pages/pricing-analysis/PricingAnalysis.jsx'));
const Notifications = lazy(() => import('../pages/notifications/Notifications.jsx'));
const HowToUse = lazy(() => import('../pages/how-to-use/HowToUse.jsx'));
const MyAccessRequests = lazy(() => import('../pages/access-requests/MyAccessRequests.jsx'));
const AccessRequestsAdmin = lazy(() => import('../pages/access-requests-admin/AccessRequestsAdmin.jsx'));
const WarehouseTransferRequests = lazy(() => import('../pages/warehouse-transfer-requests/WarehouseTransferRequests.jsx'));
const LocationManagement = lazy(() => import('../pages/location-management/LocationManagement.jsx'));
const RoleManagement = lazy(() => import('../pages/role-management/RoleManagement.jsx'));
const CustomerManagement = lazy(() => import('../pages/customer-management/CustomerManagement.jsx'));
const ProximityManagement = lazy(() => import('../pages/proximity-management/ProximityManagement.jsx'));
const CustomerPortal = lazy(() => import('../pages/customer-portal/CustomerPortal.jsx'));
const CustomerLogin = lazy(() => import('../pages/customer-login/CustomerLogin.jsx'));
const CustomerPasswordReset = lazy(() => import('../pages/customer-login/CustomerPasswordReset.jsx'));
const SupplierProducts = lazy(() => import('../pages/order-creation/SupplierProducts.jsx'));
const PersonnelTasks = lazy(() => import('../pages/personnel-mobile/PersonnelTasks.jsx'));
const PersonnelLabels = lazy(() => import('../pages/personnel-mobile/PersonnelLabels.jsx'));
const PersonnelOrder = lazy(() => import('../pages/personnel-mobile/PersonnelOrder.jsx'));
const PersonnelLocation = lazy(() => import('../pages/personnel-mobile/PersonnelLocation.jsx'));
const PersonnelRequest = lazy(() => import('../pages/personnel-mobile/PersonnelRequest.jsx'));
const PersonnelCount = lazy(() => import('../pages/personnel-mobile/PersonnelCount.jsx'));
const PersonnelNotifications = lazy(() => import('../pages/personnel-mobile/PersonnelNotifications.jsx'));
const PrivacyPolicy = lazy(() => import('../pages/privacy-policy/PrivacyPolicy.jsx'));

const withRouteSuspense = (node) => (
  <Suspense fallback={<PageLoading />}>
    {node}
  </Suspense>
);

function RoleHomeRedirect() {
  const { user } = useAuth();
  if (user?.role === 'cashier') return <Navigate to="/kasa" replace />;
  if (user?.role === 'depo_personeli') return <Navigate to="/depo-transfer-talepleri?fullscreen=1" replace />;
  if (user?.role === 'user') return <Navigate to="/urunler" replace />;
  return <Navigate to="/anasayfa" replace />;
}

export const router = createBrowserRouter([
  {
    element: <RootWrapper />,
    children: [
      {
        path: '/giris',
        element: <Login />,
        errorElement: <RouteError />,
      },
      {
        path: '/gizlilik-politikasi',
        element: withRouteSuspense(<PrivacyPolicy />),
        errorElement: <RouteError />,
      },
      {
        path: '/login',
        element: <Navigate to="/giris" replace />,
        errorElement: <RouteError />,
      },
      {
        path: '/musteri',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/login',
        element: withRouteSuspense(<CustomerLogin />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/sifre-sifirla',
        element: withRouteSuspense(<CustomerPasswordReset />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/sepet',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/ara',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/kategori/:slug',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/urun/:id',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/favorilerim',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/alisveris-listem',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/kampanyalar',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/hesabim',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/hediye-kartlari',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/gecmis-siparisler',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/magaza-calisma-saatleri',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/ayarlar',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/bildirim-tercihleri',
        element: <Navigate to="/musteri/ayarlar" replace />,
        errorElement: <RouteError />,
      },
      {
        path: '/musteri/populer-urunler',
        element: withRouteSuspense(<CustomerPortal />),
        errorElement: <RouteError />,
      },
      {
        path: '/personel/login',
        element: <PersonnelLogin />,
        errorElement: <RouteError />,
      },
      {
        path: '/personel',
        element: (
          <PersonnelProtectedRoute>
            {withRouteSuspense(<PersonnelShell />)}
          </PersonnelProtectedRoute>
        ),
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            element: withRouteSuspense(<PersonnelMobile />),
          },
          {
            path: 'bildirimler',
            element: withRouteSuspense(<PersonnelNotifications />),
          },
          {
            path: 'gorevler',
            element: withRouteSuspense(<PersonnelTasks />),
          },
          {
            path: 'gorevler/:id',
            element: withRouteSuspense(<PersonnelTasks />),
          },
          {
            path: 'etiket-yonetimi',
            element: withRouteSuspense(<PersonnelLabels />),
          },
          {
            path: 'siparis-olustur',
            element: withRouteSuspense(<PersonnelOrder />),
          },
          {
            path: 'siparis',
            element: <Navigate to="/personel/siparis-olustur" replace />,
          },
          {
            path: 'lokasyon-yonetimi',
            element: withRouteSuspense(<PersonnelLocation />),
          },
          {
            path: 'lokasyon',
            element: <Navigate to="/personel/lokasyon-yonetimi" replace />,
          },
          {
            path: 'lokasyon-yonetimi/:id',
            element: withRouteSuspense(<PersonnelLocation />),
          },
          {
            path: 'sayim',
            element: withRouteSuspense(<PersonnelCount />),
          },
          {
            path: 'reyon-besleme',
            element: withRouteSuspense(<PersonnelRequest />),
          },
          {
            path: 'reyon-talep',
            element: <Navigate to="/personel/reyon-besleme" replace />,
          },
          {
            path: '*',
            element: <Navigate to="/personel" replace />,
          },
        ],
      },
      {
        path: '/',
        element: (
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        ),
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            element: <RoleHomeRedirect />,
          },
          {
            path: 'anasayfa',
            element: withRouteSuspense(<Dashboard />),
          },
          {
            path: 'genel-bakis',
            element: <Navigate to="/anasayfa" replace />,
          },
          {
            path: 'dashboard',
            element: <Navigate to="/anasayfa" replace />,
          },
          {
            path: 'urunler',
            element: withRouteSuspense(<Products />),
          },
          {
            path: 'kategoriler',
            element: withRouteSuspense(<Categories />),
          },
          {
            path: 'tedarikciler',
            element: withRouteSuspense(<Suppliers />),
          },
          {
            path: 'eslesmeler',
            element: withRouteSuspense(<Suppliers mode="matches" />),
          },
          {
            path: 'stok-islemleri',
            element: withRouteSuspense(<StockMovements />),
          },
          {
            path: 'skt-takibi',
            element: withRouteSuspense(<StockExpiryTracking />),
          },
          {
            path: 'stok-hareketleri',
            element: <Navigate to="/stok-islemleri" replace />,
          },
          {
            path: 'lokasyon-yonetimi',
            element: withRouteSuspense(<LocationManagement />),
          },
          {
            path: 'reyonlar',
            element: <Navigate to="/lokasyon-yonetimi" replace />,
          },
          {
            path: 'reyonlar/:id',
            element: <Navigate to="/lokasyon-yonetimi" replace />,
          },
          {
            path: 'depo-yonetimi',
            element: <Navigate to="/lokasyon-yonetimi" replace />,
          },
          {
            path: 'depo-transfer-talepleri',
            element: withRouteSuspense(<WarehouseTransferRequests />),
          },
          {
            path: 'gorev-planlama',
            element: withRouteSuspense(<Tasks />),
          },
          {
            path: 'bildirimler',
            element: withRouteSuspense(<Notifications />),
          },
          {
            path: 'nasil-kullanilir',
            element: withRouteSuspense(<HowToUse />),
          },
          {
            path: 'erisim-taleplerim',
            element: withRouteSuspense(<MyAccessRequests />),
          },
          {
            path: 'erisim-talepleri',
            element: withRouteSuspense(<AccessRequestsAdmin />),
          },
          {
            path: 'operasyon-gorevleri',
            element: <Navigate to="/gorev-planlama" replace />,
          },
          {
            path: 'gorevler',
            element: <Navigate to="/gorev-planlama" replace />,
          },
          {
            path: 'barkod-islemleri',
            element: withRouteSuspense(<BarcodeOperations />),
          },
          {
            path: 'barkod',
            element: <Navigate to="/barkod-islemleri" replace />,
          },
          {
            path: 'etiket-yonetimi',
            element: withRouteSuspense(<ESLManagement />),
          },
          {
            path: 'etiket-guncelle',
            element: <Navigate to="/etiket-yonetimi" replace />,
          },
          {
            path: 'raporlar',
            element: withRouteSuspense(<Reports />),
          },
          {
            path: 'fiyat-talep-analizi',
            element: withRouteSuspense(<PricingAnalysis />),
          },
          {
            path: 'kampanya-yonetimi',
            element: withRouteSuspense(<CampaignManagement />),
          },
          {
            path: 'fiyat-analizi',
            element: <Navigate to="/fiyat-talep-analizi" replace />,
          },
          {
            path: 'siparis-onerileri',
            element: withRouteSuspense(<PurchaseSuggestions />),
          },
          {
            path: 'siparis-takibi',
            element: withRouteSuspense(<PurchaseOrders />),
          },
          {
            path: 'satin-alma-siparisleri',
            element: <Navigate to="/siparis-takibi" replace />,
          },
          {
            path: 'siparis-olustur',
            element: withRouteSuspense(<SupplierProducts initialView="compare" />),
          },
          {
            path: 'tedarikci-urunleri',
            element: withRouteSuspense(<SupplierProducts />),
          },
          {
            path: 'katalog',
            element: <Navigate to="/siparis-olustur?catalog=1" replace />,
          },
          {
            path: 'personel-yonetimi',
            element: withRouteSuspense(<Users />),
          },
          {
            path: 'musteri-yonetimi',
            element: withRouteSuspense(<CustomerManagement />),
          },
          {
            path: 'proximity-yonetimi',
            element: withRouteSuspense(<ProximityManagement />),
          },
          {
            path: 'rol-yonetimi',
            element: withRouteSuspense(<RoleManagement />),
          },
          {
            path: 'kullanicilar',
            element: <Navigate to="/personel-yonetimi" replace />,
          },
          {
            path: 'kullanici-yonetimi',
            element: <Navigate to="/personel-yonetimi" replace />,
          },
          {
            path: 'sistem-ayarlari',
            element: withRouteSuspense(<Settings />),
          },
          {
            path: 'ayarlar',
            element: <Navigate to="/sistem-ayarlari" replace />,
          },
          {
            path: 'pos-kasa',
            element: withRouteSuspense(<POSHub />),
          },
          {
            path: 'kasa-merkezi',
            element: <Navigate to="/pos-kasa" replace />,
          },
        ],
      },
      {
        path: '/kasa',
        element: (
          <ProtectedRoute>
            {withRouteSuspense(<POSGate />)}
          </ProtectedRoute>
        ),
        errorElement: <RouteError />,
      },
      {
        path: '*',
        element: <Navigate to="/anasayfa" replace />,
      },
    ]
  }
]);
