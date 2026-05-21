export const CAMPAIGN_TEMPLATE_LIBRARY = {
  weekend_sale: {
    id: 'weekend_sale',
    label: 'Hafta Sonu İndirimi',
    draft: {
      name: 'Hafta Sonu İndirimi',
      type: 'general',
      discountRate: '15',
      priority: 4,
      triggerSalesSpeed: 'any',
      triggerTrendDirection: 'any',
      minOverStockRatio: '1.2',
    },
  },
  stock_clearance: {
    id: 'stock_clearance',
    label: 'Stok Temizleme',
    draft: {
      name: 'Stok Temizleme',
      type: 'category',
      discountRate: '20',
      priority: 8,
      triggerSalesSpeed: 'slow',
      triggerTrendDirection: 'down',
      minOverStockRatio: '1.5',
    },
  },
  new_product_boost: {
    id: 'new_product_boost',
    label: 'Yeni Ürün Destek Kampanyası',
    draft: {
      name: 'Yeni Ürün Destek Kampanyası',
      type: 'general',
      discountRate: '10',
      priority: 3,
      triggerSalesSpeed: 'normal',
      triggerTrendDirection: 'flat',
      minOverStockRatio: '1.1',
    },
  },
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const mapPricingRowsForCampaigns = (analysis = {}) => {
  const sections = analysis?.sections || {};
  const rows = [
    ...safeArray(sections.fastSellingProducts),
    ...safeArray(sections.slowAndExpiryRiskProducts),
    ...safeArray(sections.dynamicDiscountSuggestions),
    ...safeArray(sections.stockRunoutAnalysis),
    ...safeArray(sections.automaticOrderSuggestions),
    ...safeArray(sections.riskScorePanel),
    ...safeArray(sections.expirationRisk),
    ...safeArray(sections.dynamicPricing),
    ...safeArray(sections.fastMoving),
    ...safeArray(sections.slowMoving),
    ...safeArray(sections.competitorMismatch),
  ];

  const uniq = new Map();
  rows.forEach((item, index) => {
    const id = String(item?.productId || item?.id || `row-${index}`);
    if (uniq.has(id)) return;

    const currentPrice = toNumber(item?.currentPrice ?? item?.unitPrice ?? item?.referencePrice, 0);
    const cost = toNumber(item?.cost ?? item?.costPrice ?? item?.purchasePrice ?? item?.supplierPrice, 0);
    const stock = toNumber(item?.currentStock ?? item?.totalStock ?? item?.stockLevel ?? item?.stock, 0);
    const salesVelocity = toNumber(item?.avgDailySales ?? item?.salesVelocity ?? item?.dailySalesRate, 0);
    const daysToExpiry = item?.daysToExpiry == null ? null : toNumber(item.daysToExpiry, null);
    const suggestedDiscount = clamp(toNumber(item?.discountSuggestion?.discountRate ?? item?.suggestedDiscountRate, 0), 0, 80);

    uniq.set(id, {
      id,
      productId: id,
      productName: String(item?.productName || item?.name || 'Bilinmeyen ürün'),
      category: String(item?.category || item?.categoryName || '-'),
      brand: String(item?.brand || item?.brandName || item?.supplierName || '-'),
      supplierName: String(item?.supplierName || '-'),
      stockLevel: stock,
      salesVelocity,
      daysToExpiry,
      currentPrice,
      cost,
      currentMarginPercent: currentPrice > 0 ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(1)) : null,
      suggestedDiscount,
      riskLevel: String(item?.riskLevel || item?.risk || 'medium').toLowerCase(),
    });
  });

  return [...uniq.values()];
};

const sortByAscending = (rows = [], selector) => [...rows].sort((left, right) => selector(left) - selector(right));

const sortByDescending = (rows = [], selector) => [...rows].sort((left, right) => selector(right) - selector(left));

const uniqueProductIds = (rows = []) => [...new Set(rows.map((row) => String(row?.productId || row?.id || '')).filter(Boolean))];

const uniqueNames = (rows = [], key) => [...new Set(rows.map((row) => String(row?.[key] || '').trim()).filter((value) => value && value !== '-'))];

const buildSignalBullets = ({
  rows = [],
  salesLine = 'Satış hızı trendi analiz edildi.',
  stockLine = 'Stok yoğunluğu kampanya kapsamına dahil edildi.',
  extraLine = 'Mevcut kampanya çakışmaları kontrol edildi.',
} = {}) => {
  const avgVelocity = rows.length ? Number((rows.reduce((sum, row) => sum + toNumber(row.salesVelocity, 0), 0) / rows.length).toFixed(1)) : 0;
  const avgStock = rows.length ? Number((rows.reduce((sum, row) => sum + toNumber(row.stockLevel, 0), 0) / rows.length).toFixed(1)) : 0;
  const minExpiry = rows
    .map((row) => row?.daysToExpiry)
    .filter((value) => value != null)
    .reduce((min, value) => (min == null ? value : Math.min(min, value)), null);

  return [
    `${salesLine} Ortalama günlük satış: ${avgVelocity || 0}.`,
    `${stockLine} Ortalama stok seviyesi: ${avgStock || 0}.`,
    minExpiry == null ? 'SKT baskısı bulunmayan ürünler de kapsama dahil edildi.' : `En yakın SKT baskısı ${minExpiry} gün seviyesinde ölçüldü.`,
    extraLine,
  ];
};

const buildPlaybookSteps = (...items) => items.filter(Boolean);

const buildCategoryFocus = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = String(row?.category || '').trim();
    if (!key || key === '-') return;
    const current = grouped.get(key) || { name: key, count: 0, rows: [] };
    current.count += 1;
    current.rows.push(row);
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) => right.count - left.count)[0] || null;
};

const buildBrandFocus = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = String(row?.brand || row?.supplierName || '').trim();
    if (!key || key === '-') return;
    const current = grouped.get(key) || { name: key, count: 0, rows: [] };
    current.count += 1;
    current.rows.push(row);
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) => right.count - left.count)[0] || null;
};

export const buildCampaignSuggestions = ({ pricingRows = [], purchaseSuggestions = [], campaigns = [], giftCards = [] } = {}) => {
  const rows = safeArray(pricingRows);
  const orderRows = safeArray(purchaseSuggestions);
  const existingNames = new Set(safeArray(campaigns).map((item) => String(item?.name || '').toLowerCase()));
  const activeGiftCards = safeArray(giftCards).filter((card) => card?.isActive !== false);

  const slowMoving = rows.filter((row) => toNumber(row.salesVelocity, 99) <= 1.2);
  const slowSelection = (slowMoving.length ? slowMoving : sortByAscending(rows, (row) => toNumber(row.salesVelocity, 99))).slice(0, Math.max(3, Math.min(8, rows.length || 3)));

  const nearExpiry = rows.filter((row) => row.daysToExpiry != null && toNumber(row.daysToExpiry, 999) <= 10);
  const nearExpirySelection = (nearExpiry.length ? nearExpiry : sortByAscending(rows.filter((row) => row.daysToExpiry != null), (row) => toNumber(row.daysToExpiry, 999)) || slowSelection).slice(0, Math.max(3, Math.min(8, rows.length || 3)));

  const overstocked = rows.filter((row) => toNumber(row.stockLevel, 0) >= 35 && toNumber(row.salesVelocity, 99) <= 2);
  const overstockSelection = (overstocked.length ? overstocked : sortByDescending(rows, (row) => toNumber(row.stockLevel, 0))).slice(0, Math.max(3, Math.min(10, rows.length || 3)));

  const categoryFocus = buildCategoryFocus(overstockSelection.length ? overstockSelection : rows);
  const brandFocus = buildBrandFocus(slowSelection.length ? slowSelection : rows);

  const giftCardFocusRows = (rows.length ? sortByDescending(rows, (row) => toNumber(row.currentMarginPercent, 0)) : []).slice(0, Math.max(3, Math.min(6, rows.length || 3)));
  const reorderPressure = orderRows.filter((row) => toNumber(row?.currentStock, 0) > 20 && toNumber(row?.avgDailySales, 0) <= 1.2);
  const reorderSelection = reorderPressure.slice(0, Math.max(3, Math.min(6, reorderPressure.length || 3)));

  const suggestions = [
    {
      id: 'slow-moving',
      title: `${slowSelection.length || 3} yavaş satan ürün için indirim kampanyası`,
      reason: 'Bu ürünlerde satış hızı düşük ve stok yükü artıyor. Kontrollü indirim ile devir hızını artırmak mümkün.',
      affectedProductCount: slowSelection.length || 3,
      recommendedDiscount: 18,
      type: 'product',
      productIds: uniqueProductIds(slowSelection),
      categoryNames: uniqueNames(slowSelection, 'category'),
      brandNames: uniqueNames(slowSelection, 'brand'),
      priority: slowSelection.length > 6 ? 'high' : 'medium',
      impactSummary: 'Yavaş dönen ürünlerde görünürlüğü artırır, stok baskısını azaltır ve raf verimini iyileştirir.',
      riskSummary: 'Marjı zaten düşük ürünlerde agresif indirim kârlılığı gereksiz biçimde aşağı çekebilir.',
      signalBullets: buildSignalBullets({
        rows: slowSelection,
        salesLine: 'Yavaş satış eğilimleri seçildi.',
        stockLine: 'Raf ve depo stoku baskısı ölçüldü.',
      }),
      playbookSteps: buildPlaybookSteps(
        'Önce ilk 5 üründe kısa süreli test kampanyası açın.',
        'Kampanya başlangıcında stok ve marj eşiklerini yeniden kontrol edin.',
        'İlk 48 saatte dönüşüm zayıfsa indirim oranını yeniden kalibre edin.',
      ),
    },
    {
      id: 'near-expiry',
      title: `${nearExpirySelection.length || 3} üründe SKT odaklı hızlı kampanya`,
      reason: 'Son kullanma tarihi yaklaşan ürünlerde hızlı kampanya aksiyonu fire riskini düşürür.',
      affectedProductCount: nearExpirySelection.length || 3,
      recommendedDiscount: 22,
      type: 'product',
      productIds: uniqueProductIds(nearExpirySelection),
      categoryNames: uniqueNames(nearExpirySelection, 'category'),
      brandNames: uniqueNames(nearExpirySelection, 'brand'),
      priority: nearExpirySelection.some((row) => toNumber(row.daysToExpiry, 999) <= 3) ? 'critical' : 'high',
      impactSummary: 'Fire riskini azaltır, stok kaybını düşürür ve kısa vadeli ciro kazanımı yaratabilir.',
      riskSummary: 'İndirim oranı gereğinden yüksek olursa marj kaybı artabilir ve ürün erken tükenebilir.',
      signalBullets: buildSignalBullets({
        rows: nearExpirySelection,
        salesLine: 'SKT baskısı yüksek ürünler önceliklendirildi.',
        stockLine: 'Depoda bekleyen hassas stok dikkate alındı.',
        extraLine: 'Hızlı aksiyon penceresi ve raf görünürlüğü birlikte değerlendirildi.',
      }),
      playbookSteps: buildPlaybookSteps(
        'Kampanyayı 3-5 günlük kısa bir pencereyle başlatın.',
        'Raf önü görünürlüğünü artırın ve satış ekibini bilgilendirin.',
        'Gerekirse kampanyayı kategori yerine seçili ürünlerle daraltın.',
      ),
    },
    {
      id: 'overstock',
      title: `${overstockSelection.length || 3} ürün için stok eritme kampanyası`,
      reason: 'Stok seviyesi mevcut satış hızına göre yüksek. Stok eritme kampanyası nakit akışını rahatlatabilir.',
      affectedProductCount: overstockSelection.length || 3,
      recommendedDiscount: 15,
      type: 'category',
      productIds: uniqueProductIds(overstockSelection),
      categoryNames: uniqueNames(overstockSelection, 'category'),
      brandNames: uniqueNames(overstockSelection, 'brand'),
      priority: overstockSelection.length > 6 ? 'high' : 'medium',
      impactSummary: 'Fazla stoklu ürünlerde devir süresini kısaltır ve depodaki bekleme yükünü azaltır.',
      riskSummary: 'Kategori çok geniş seçilirse ihtiyacı olmayan ürünler de indirime girerek gereksiz marj kaybı yaratabilir.',
      signalBullets: buildSignalBullets({
        rows: overstockSelection,
        salesLine: 'Satış hızına göre yavaşlayan stok havuzu seçildi.',
        stockLine: 'Aşırı stok yoğunluğu ve bekleme süresi ölçüldü.',
      }),
      playbookSteps: buildPlaybookSteps(
        'En yoğun stoklu kategoriyi dar hedefle başlatın.',
        'İndirim oranını mağaza trafiğine göre 15-20 bandında tutun.',
        'Kampanya sonunda kalan stok için ikinci dalga kararını ölçün.',
      ),
    },
    {
      id: 'category-focus',
      title: categoryFocus ? `${categoryFocus.name} kategorisi için odak kampanyası` : 'Kategori odaklı dönüşüm kampanyası',
      reason: 'Benzer risk sinyalleri aynı kategoride yoğunlaşıyor. Tek aksiyonla daha hızlı kampanya yönetimi yapılabilir.',
      affectedProductCount: categoryFocus?.count || Math.max(3, rows.length || 3),
      recommendedDiscount: 14,
      type: 'category',
      productIds: uniqueProductIds(categoryFocus?.rows || overstockSelection),
      categoryNames: categoryFocus ? [categoryFocus.name] : uniqueNames(overstockSelection, 'category').slice(0, 1),
      brandNames: uniqueNames(categoryFocus?.rows || overstockSelection, 'brand'),
      priority: 'medium',
      impactSummary: 'Kategori seviyesinde görünürlük ve dönüşüm artışı sağlayarak operasyon yükünü azaltır.',
      riskSummary: 'Kategori kapsamı geniş tutulursa gerçek ihtiyacı olmayan ürünler de kampanyaya dahil olabilir.',
      signalBullets: buildSignalBullets({
        rows: categoryFocus?.rows || overstockSelection,
        salesLine: 'Kategori bazında tekrar eden sinyaller gruplanarak analiz edildi.',
        stockLine: 'Kategori içi stok dengesizliği ve satış trendi birlikte okundu.',
      }),
      playbookSteps: buildPlaybookSteps(
        'Kapsamı tek kategoriyle başlatın ve alt kategori ayrımını kontrol edin.',
        'Raf iletişimini kategori başlıklarıyla destekleyin.',
        'İlk hafta sonunda kategori bazlı satış uplift raporu alın.',
      ),
    },
    {
      id: 'brand-focus',
      title: brandFocus ? `${brandFocus.name} markası için görünürlük kampanyası` : 'Marka odaklı kampanya fırsatı',
      reason: 'Aynı marka altında biriken zayıf performanslı ürünler ortak görünürlük mesajıyla daha kolay desteklenebilir.',
      affectedProductCount: brandFocus?.count || Math.max(3, rows.length || 3),
      recommendedDiscount: 11,
      type: 'brand',
      productIds: uniqueProductIds(brandFocus?.rows || slowSelection),
      categoryNames: uniqueNames(brandFocus?.rows || slowSelection, 'category'),
      brandNames: brandFocus ? [brandFocus.name] : uniqueNames(slowSelection, 'brand').slice(0, 1),
      priority: 'medium',
      impactSummary: 'Marka görünürlüğünü güçlendirir ve seçili ürünlerde sepet dönüşümünü destekler.',
      riskSummary: 'Aynı kampanyaya farklı fiyat hassasiyetindeki ürünler girerse aksiyon etkisi dağılabilir.',
      signalBullets: buildSignalBullets({
        rows: brandFocus?.rows || slowSelection,
        salesLine: 'Marka bazında tekrar eden satış yavaşlaması izlendi.',
        stockLine: 'Marka içi stok baskısı ve raf yoğunluğu karşılaştırıldı.',
      }),
      playbookSteps: buildPlaybookSteps(
        'Önce tek marka ve sınırlı süre ile pilot açın.',
        'Marka tedarikçisiyle görünürlük desteği varsa kampanya ile eşleyin.',
        'Fiyat duyarlılığı yüksek ürünleri aynı kampanyadan gerekirse çıkarın.',
      ),
    },
    {
      id: 'gift-card-trigger',
      title: activeGiftCards.length ? 'Hediye kartı tetiklemeli sepet büyütme kampanyası' : 'Hediye kartı destekli geri dönüş kampanyası',
      reason: 'Hediye kartı ödülü, kampanya etkisini tek seferlik satıştan tekrar ziyaret davranışına taşıyabilir.',
      affectedProductCount: giftCardFocusRows.length || Math.max(3, rows.length || 3),
      recommendedDiscount: 8,
      type: 'general',
      productIds: uniqueProductIds(giftCardFocusRows),
      categoryNames: uniqueNames(giftCardFocusRows, 'category'),
      brandNames: uniqueNames(giftCardFocusRows, 'brand'),
      priority: activeGiftCards.length ? 'high' : 'medium',
      giftCardRewardEnabled: activeGiftCards.length > 0,
      giftCardRewardCode: String(activeGiftCards[0]?.code || '').trim().toUpperCase(),
      impactSummary: 'Sepet eşiği aşan müşterilerde tekrar ziyaret ve bağlılık davranışını destekler.',
      riskSummary: 'Ödül seviyesi düşük kalırsa kart tetikleyicisi beklenen dönüşü sağlamayabilir.',
      signalBullets: buildSignalBullets({
        rows: giftCardFocusRows,
        salesLine: 'Sepet büyütmeye uygun marj havuzu analiz edildi.',
        stockLine: 'Kampanyayı taşıyabilecek ürün havuzu ve stok yeterliliği kontrol edildi.',
        extraLine: activeGiftCards.length ? `Kullanılabilir hediye kartı kodu ${String(activeGiftCards[0]?.code || '').trim().toUpperCase()} ile eşleştirildi.` : 'Aktif hediye kartı bulunmadığında kampanya taslağı ödül kartı olmadan hazırlanır.',
      }),
      playbookSteps: buildPlaybookSteps(
        'Sepet eşiği ve ödül kartı kodunu kampanya açmadan önce netleştirin.',
        'Hedef ürün grubunu yüksek marjlı veya tamamlayıcı ürünlerden seçin.',
        'Atama akışını müşteri ekranında aynı gün test edin.',
      ),
    },
    {
      id: 'reorder-alternative',
      title: `${reorderSelection.length || 3} ürün için sipariş yerine kampanya alternatifi`,
      reason: 'Yeni sipariş vermeden önce mevcut stoğu kampanya ile eritmek daha güvenli bir alternatif olabilir.',
      affectedProductCount: reorderSelection.length || 3,
      recommendedDiscount: 12,
      type: 'product',
      productIds: reorderSelection.map((row) => String(row?.productId || row?.id || '')).filter(Boolean),
      priority: reorderSelection.length > 0 ? 'high' : 'low',
      impactSummary: 'Yeni sipariş baskısını azaltır ve mevcut stoğun satışa dönüşmesini hızlandırır.',
      riskSummary: 'Kampanya beklenen satış hızını yaratmazsa sipariş ihtiyacı kısa süre sonra tekrar gündeme gelebilir.',
      signalBullets: [
        `Bekleyen sipariş baskısı taşıyan ${reorderSelection.length || 3} ürün incelendi.`,
        'Stok devri, günlük satış hızı ve bekleyen stok yükü birlikte karşılaştırıldı.',
        'Sipariş maliyeti yerine kampanya ile çözüm üretme ihtimali değerlendirildi.',
      ],
      playbookSteps: buildPlaybookSteps(
        'Önce en yüksek stok yükü olan ürünlerde deneyin.',
        'Kampanya sonrası yeniden sipariş kararını ertesi gün revize edin.',
      ),
    },
  ]
    .filter((item) => !existingNames.has(item.title.toLowerCase()));

  return suggestions;
};

export const calculateCampaignImpact = ({
  discountRate = 0,
  productCount = 0,
  durationDays = 7,
  avgPrice = 100,
  avgCost = 62,
  baselineDailySales = 1,
  avgStockLevel = 30,
  avgDaysToExpiry = null,
} = {}) => {
  const safeDiscount = clamp(toNumber(discountRate, 0), 0, 80);
  const safeProducts = Math.max(1, toNumber(productCount, 1));
  const safeDuration = Math.max(1, toNumber(durationDays, 7));
  const safePrice = Math.max(1, toNumber(avgPrice, 100));
  const safeCost = Math.max(0, Math.min(toNumber(avgCost, safePrice * 0.62), safePrice * 0.98));
  const safeDailySales = Math.max(0, toNumber(baselineDailySales, 0));
  const safeStock = Math.max(0, toNumber(avgStockLevel, 0));

  const avgExpiryDays = avgDaysToExpiry == null ? null : toNumber(avgDaysToExpiry, null);
  const expiryPressure = avgExpiryDays == null ?
    0
    : clamp((14 - avgExpiryDays) / 14, 0, 1); // 0..1 (14 günden yakınsa baskı artar)

  // Satış elastikiyeti
  // - Düşük satış hızında indirim etkisi daha görünür
  // - SKT yaklaşınca indirim etkisi artar
  const velocityFactor = safeDailySales <= 0.4 ? 1.35 : safeDailySales <= 1.2 ? 1.15 : 1.0;
  const elasticity = clamp(0.85 + (safeDiscount / 100) * 0.9, 0.85, 1.8) * velocityFactor * (1 + (expiryPressure * 0.55));

  // Kampanya satış artışı (yumuşak artış, gerçekçi tavan)
  const rawBoost = (safeDiscount / 100) * elasticity;
  const salesBoostCapped = clamp(rawBoost, 0, 1.2); // max %120 artış

  // Stok ve süre kısıtları ile kampanya satışını sınırlama
  const campaignDailySales = safeDailySales * (1 + salesBoostCapped);
  const maxSellablePerProduct = Math.max(0, safeStock); // stok başına ürün
  const maxDailySellable = safeDuration > 0 ? maxSellablePerProduct / safeDuration : maxSellablePerProduct;
  const realisticDailySales = Math.min(campaignDailySales, maxDailySellable > 0 ? maxDailySellable : campaignDailySales);

  const baseDailySales = safeDailySales;
  const baseSalesUnits = baseDailySales * safeDuration;
  const campaignSalesUnits = realisticDailySales * safeDuration;

  const baseRevenuePerProduct = baseSalesUnits * safePrice;
  const campaignPrice = safePrice * (1 - safeDiscount / 100);
  const campaignRevenuePerProduct = campaignSalesUnits * campaignPrice;

  const revenueChange = Number(((campaignRevenuePerProduct - baseRevenuePerProduct) * safeProducts).toFixed(2));
  const salesIncreasePct = baseSalesUnits > 0 ?
    Number((((campaignSalesUnits - baseSalesUnits) / baseSalesUnits) * 100).toFixed(1))
    : Number((Math.min(120, salesBoostCapped * 100)).toFixed(1));

  // Ciro etkisi yanında stok eritme ve risk azaltma metrikleri
  const stockSellThrough = safeStock > 0 ? clamp(campaignSalesUnits / safeStock, 0, 1) : 0;
  const stockDepletionDays = realisticDailySales > 0 ? Number((safeStock / realisticDailySales).toFixed(1)) : Number.POSITIVE_INFINITY;

  // Risk azaltma: SKT baskısı ve stok eritme oranına bağlı
  const riskReductionScore = Number((clamp((expiryPressure * 0.65) + (stockSellThrough * 0.35), 0, 1) * 100).toFixed(1));

  // Stok eritme etkisi: kampanya ile ekstra satılan birim oranı
  const extraUnits = Math.max(0, campaignSalesUnits - baseSalesUnits);
  const stockBurnScore = safeStock > 0 ? Number((clamp(extraUnits / safeStock, 0, 1) * 100).toFixed(1)) : 0;

  // Kar/Marj: kampanya fiyatı maliyetin altına inerse negatif etki
  const baseMargin = Math.max(safePrice - safeCost, 0);
  const campaignMargin = campaignPrice - safeCost;
  const baseProfitPerProduct = baseSalesUnits * baseMargin;
  const campaignProfitPerProduct = campaignSalesUnits * campaignMargin;
  const marginImpact = baseProfitPerProduct !== 0 ?
    Number((((campaignProfitPerProduct - baseProfitPerProduct) / Math.abs(baseProfitPerProduct)) * 100).toFixed(1))
    : Number(((campaignMargin >= 0 ? 1 : -1) * safeDiscount * 0.8).toFixed(1));

  return {
    salesIncreasePct,
    revenueChange,
    marginImpact,
    stockDepletionDays: Number.isFinite(stockDepletionDays) ? stockDepletionDays : safeDuration,
    stockBurnScore,
    riskReductionScore,
  };
};

export const buildCategoryInsights = (pricingRows = []) => {
  const grouped = new Map();
  safeArray(pricingRows).forEach((row) => {
    const category = String(row?.category || 'Diğer');
    const current = grouped.get(category) || {
      category,
      stockLevel: 0,
      salesVelocity: 0,
      rowCount: 0,
      turnoverRate: 0,
      recommendation: '',
      suggestedDiscount: 0,
    };

    current.stockLevel += toNumber(row?.stockLevel, 0);
    current.salesVelocity += toNumber(row?.salesVelocity, 0);
    current.rowCount += 1;
    grouped.set(category, current);
  });

  return [...grouped.values()].map((item) => {
    const avgSales = item.rowCount > 0 ? item.salesVelocity / item.rowCount : 0;
    const turnoverRate = item.stockLevel > 0 ? Number((avgSales / item.stockLevel).toFixed(3)) : 0;
    const overstocked = item.stockLevel >= 80 && avgSales < 2;
    const suggestedDiscount = overstocked ? 15 : avgSales < 1 ? 12 : 8;

    return {
      ...item,
      salesVelocity: Number(avgSales.toFixed(2)),
      turnoverRate,
      recommendation: overstocked ?
        'Bu kategori fazla stoklu, %15 indirim önerilir.'
        : 'Kategori dengeli, hafif kampanya ile desteklenebilir.',
      suggestedDiscount,
    };
  });
};

export const evaluateDynamicRule = (rule = {}, product = {}) => {
  const salesBelow = toNumber(rule.salesBelow, 9999);
  const stockAbove = toNumber(rule.stockAbove, -1);
  const expiryBelow = toNumber(rule.expiryBelow, 9999);

  const sales = toNumber(product.salesVelocity, toNumber(product.avgDailySales, 0));
  const stock = toNumber(product.stockLevel, toNumber(product.currentStock, 0));
  const expiry = toNumber(product.daysToExpiry, 9999);

  return sales < salesBelow && stock > stockAbove && expiry < expiryBelow;
};

export const previewDynamicRuleImpact = ({ rule = {}, pricingRows = [] } = {}) => {
  const affectedRows = safeArray(pricingRows).filter((row) => evaluateDynamicRule(rule, row));
  return {
    affectedCount: affectedRows.length,
    affectedProductIds: affectedRows.map((row) => row.productId),
  };
};

export const evaluateAutomationTriggerConditions = ({ trigger = {}, metrics = {} } = {}) => {
  const checks = {
    lowSalesVelocity: toNumber(metrics.salesVelocity, 0) <= toNumber(trigger.lowSalesVelocityThreshold, 1),
    highStock: toNumber(metrics.stockLevel, 0) >= toNumber(trigger.highStockThreshold, 40),
    approachingExpiration: toNumber(metrics.daysToExpiry, 999) <= toNumber(trigger.expirationThreshold, 10),
    priceDropOpportunity: toNumber(metrics.marginPercent, 0) >= toNumber(trigger.minMarginForDrop, 20),
  };

  return {
    ...checks,
    triggered: Object.values(checks).some(Boolean),
  };
};

export const applyBulkCampaignAction = ({ campaigns = [], selectedIds = [], action = '', payload = {} } = {}) => {
  const selected = new Set(safeArray(selectedIds));
  if (!selected.size) return safeArray(campaigns);

  return safeArray(campaigns).map((item) => {
    if (!selected.has(item.id)) return item;

    if (action === 'activate') {
      return { ...item, isActive: true, status: 'active' };
    }

    if (action === 'deactivate') {
      return { ...item, isActive: false, status: 'paused' };
    }

    if (action === 'edit-discount') {
      return { ...item, discountRate: clamp(toNumber(payload.discountRate, item.discountRate), 1, 80) };
    }

    if (action === 'assign-campaign-type') {
      return { ...item, type: String(payload.type || item.type || 'general') };
    }

    return item;
  });
};

export const buildCampaignEmptyState = ({ campaigns = [], suggestions = [], tab = 'all' } = {}) => {
  const hasCampaign = safeArray(campaigns).length > 0;
  const eligible = safeArray(suggestions).reduce((sum, item) => sum + toNumber(item.affectedProductCount, 0), 0);

  if (!hasCampaign && eligible > 0) {
    return {
      title: 'Aktif kampanya yok, ancak uygun ürünler bulundu',
      description: `${eligible} ürün kampanya için uygun görünüyor. Önerilen kampanyalardan birini başlatabilirsiniz.`,
      cta: 'Genel sekmesinden yeni kampanya oluşturun.',
    };
  }

  if (tab === 'automation') {
    return {
      title: 'Henüz otomasyon kuralı tanımlanmadı',
      description: 'Tetikleyici ve aksiyon tanımlayarak kampanya otomasyonunu başlatın.',
      cta: 'Yukarıdaki formu kullanarak ilk kuralınızı ekleyin.',
    };
  }

  return {
    title: 'Filtreye uygun kayıt yok',
    description: 'Seçili filtre kombinasyonu için kampanya bulunamadı.',
    cta: 'Filtreleri temizleyerek tüm kampanyaları görüntüleyin.',
  };
};

export const deriveGiftCardAnalytics = ({ giftCards = [], campaigns = [] } = {}) => {
  const cards = safeArray(giftCards);
  const linked = safeArray(campaigns).filter((item) => item.giftCardRewardEnabled === true).length;

  const activeCards = cards.filter((item) => item.isActive !== false);
  const redemptionRate = cards.length > 0 ?
    Number(((activeCards.length / cards.length) * 100).toFixed(1))
    : 0;

  const averageBasketImpact = cards.length > 0 ?
    Number((cards.reduce((sum, item) => sum + toNumber(item.value, 0), 0) / cards.length).toFixed(1))
    : 0;

  return {
    redemptionRate,
    averageBasketImpact,
    linkedCampaignCount: linked,
  };
};

export const mergeCrossModuleIntelligence = ({ pricingRows = [], purchaseSuggestions = [] } = {}) => {
  const pricing = safeArray(pricingRows);
  const orderRows = safeArray(purchaseSuggestions);

  const highStockIds = new Set(pricing.filter((item) => toNumber(item.stockLevel, 0) >= 40).map((item) => item.productId));
  const slowIds = new Set(pricing.filter((item) => toNumber(item.salesVelocity, 0) <= 1).map((item) => item.productId));

  const signals = orderRows
    .filter((row) => highStockIds.has(String(row?.productId || row?.id || '')))
    .map((row) => ({
      productId: String(row?.productId || row?.id || ''),
      productName: String(row?.productName || 'Bilinmeyen ürün'),
      message: 'Stok yüksek görünüyor: yeniden sipariş yerine kampanya + fiyat stratejisi önerilir.',
      type: 'campaign-instead-of-reorder',
    }));

  pricing
    .filter((row) => slowIds.has(row.productId))
    .slice(0, 10)
    .forEach((row) => {
      signals.push({
        productId: row.productId,
        productName: row.productName,
        message: 'Yavaş ürün: fiyat optimizasyonu ile kampanya stratejisi birlikte çalıştırılmalı.',
        type: 'price-plus-campaign',
      });
    });

  return signals;
};
