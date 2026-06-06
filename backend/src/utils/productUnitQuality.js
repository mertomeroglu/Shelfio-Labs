import { normalizeUnit } from './unitSystem.js';

const lowerTr = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');
const compact = (value) => lowerTr(value).replace(/\s+/g, ' ');
const textOf = (product = {}) => compact([
  product.name,
  product.productName,
  product.brand,
  product.etiket,
  product.categoryName,
  product.category,
].filter(Boolean).join(' '));

const hasAny = (text, terms = []) => terms.some((term) => text.includes(term));
const matchesAny = (text, patterns = []) => patterns.some((pattern) => pattern.test(text));
const hasToken = (text, token) => new RegExp(`(^|\\s)${token}(\\s|$)`, 'i').test(text);

const FRESH_WEIGHT_TAGS = new Set(['meyve', 'sebze', 'yeşillik, ot', 'yesillik, ot', 'taze meyve', 'taze sebze']);
const ADET_TAGS = new Set([
  'kırtasiye, ofis', 'kirtasiye, ofis', 'tekstil, giyim', 'bebek tekstil',
  'küçük elektronik', 'kucuk elektronik', 'kablo, şarj', 'kablo, sarj',
  'aydınlatma', 'aydinlatma', 'hobi, eğlence', 'hobi, eglence',
  'oyuncak', 'makyaj', 'bebek ürünleri', 'bebek urunleri',
  'mutfak, sofra', 'temizlik gereçleri', 'temizlik gerecleri',
  'pil, batarya',
]);
const PERSONAL_CARE_TAGS = new Set(['ağız bakım', 'agiz bakim', 'duş, vücut bakım', 'dus, vucut bakim', 'cilt bakım', 'cilt bakim', 'saç bakım', 'sac bakim', 'deodorant, parfüm', 'deodorant, parfum', 'makyaj']);
const PACKAGE_TAGS = new Set([
  'atıştırmalık', 'atistirmalik', 'bisküvi, kraker, kek', 'biskuvi, kraker, kek',
  'çikolata, gofret', 'cikolata, gofret', 'şekerleme, sakız', 'sekerleme, sakiz',
  'bakliyat, makarna', 'baharat, tuz', 'çorba, bulyon', 'corba, bulyon',
  'işlenmiş et, şarküteri', 'islenmis et, sarkuteri', 'pasta, tatlı', 'pasta, tatli',
  'dondurulmuş gıda', 'dondurulmus gida', 'hazır yemek', 'hazir yemek',
  'bebek maması', 'bebek mamasi', 'çay, kahve', 'cay, kahve',
  'peçete, mendil', 'pecete, mendil', 'ıslak mendil', 'islak mendil',
  'bebek bezi', 'kahvaltılık gevrek', 'kahvaltilik gevrek',
  'peynir, tereyağı', 'peynir, tereyagi', 'beyaz peynir', 'süzme peynir',
  'suzme peynir', 'üçgen eritme peynir', 'ucgen eritme peynir',
  'taze peynir', 'krem peynir', 'tereyağı, margarin, krema',
  'tereyagi, margarin, krema', 'tavuk', 'balık, deniz ürünleri', 'balik, deniz urunleri',
]);

const unitResult = (unit, source, confidence = 'high', issueType = 'product_type_base_unit_conflict') => ({
  unit,
  source,
  confidence,
  issueType,
});

const tagOf = (product = {}) => compact(product.etiket || product.tagId || product.selectedTagId || product.categoryName || product.category || '');

export function resolveProductBaseUnit(product = {}) {
  const name = compact(product.name || product.productName || '');
  const text = textOf(product);
  const tag = tagOf(product);
  const currentUnit = normalizeUnit(product.unit, product.etiket || product.categoryName || product.category);

  if (hasAny(text, ['kurusu', 'kurutulmuş', 'kurutulmus'])) {
    return unitResult('Paket', 'name:kurutulmus_urun');
  }

  if (FRESH_WEIGHT_TAGS.has(tag)) {
    return unitResult('Kg', 'tag:fresh_weight', 'high', 'fresh_weight_unit');
  }

  if (hasAny(text, ['bardak', 'tabak', 'fincan', 'takımı', 'takimi'])
    || (hasAny(text, ['ofis seti', 'kent ofis seti']))
    || ((tag === 'mutfak, sofra' || tag === 'mutfak, sofra') && hasAny(text, ['seti', 'tepsi', 'tava']))) {
    if (!hasAny(name, ['poşet', 'poset', 'demlik']) && !hasAny(name, ['bardakta'])) {
      return unitResult('Adet', 'name:mutfak_sofra_tekil');
    }
  }
  if (hasAny(name, ['poşet çay', 'poset cay', 'demlik poşet', 'demlik poset', 'bar poşet', 'bar poset', 'sallama çay', 'sallama cay', 'çaykur', 'caykur', 'ofçay', 'ofcay', "3'in1", '3in1', 'kentcafe'])
    || ((hasToken(name, 'çay') || hasToken(name, 'cay') || hasAny(name, ['çayı', 'cayi'])) && !hasAny(name, ['bard', 'tabak', 'fincan', 'takım', 'takim', 'set']))) {
    return unitResult('Paket', 'name:cay_paket');
  }
  if (hasAny(text, ['helva'])) {
    return unitResult('Paket', 'name:helva_paket');
  }
  if (hasAny(name, ['yumurtalık', 'yumurtalik', 'yumurta tava', 'yumurta fırça', 'yumurta firca'])) {
    return unitResult('Adet', 'name:egg_related_non_food');
  }
  if (hasAny(name, ['kinder joy', 'kinder sürpriz', 'kinder surpriz', 'sürpriz yumurta', 'surpiz yumurta'])) {
    return unitResult('Adet', 'name:single_chocolate_egg');
  }
  if (hasAny(name, ['yumurta']) && !hasAny(name, ['yumurtali', 'yumurtalı'])) {
    return unitResult('Viyol', 'name:retail_egg_pack');
  }
  if (hasAny(text, ['ayçiçek yağ', 'aycicek yag', 'zeytinyağ', 'zeytinyag', 'zeytin yağ', 'zeytin yag', 'sıvı yağ', 'sivi yag', 'sıvıyağ', 'siviyag'])) {
    if (hasAny(text, ['teneke', 'kutu', 'tnk'])) return unitResult('Kutu', 'name:yag_teneke');
    if (hasAny(text, ['bidon']) || matchesAny(text, [/\b[345]\s*l\b/])) return unitResult('Bidon', 'name:yag_bidon');
    return unitResult('Şişe', 'name:yag_sise');
  }
  if (hasAny(text, ['zeytin']) && !hasAny(text, ['zeytin yağ', 'zeytin yag', 'zeytinyağ', 'zeytinyag'])) {
    if (hasAny(text, ['kavanoz', 'cam'])) return unitResult('Kavanoz', 'name:zeytin_kavanoz');
    if (hasAny(text, ['teneke', 'kutu'])) return unitResult('Kutu', 'name:zeytin_kutu');
    return unitResult('Paket', 'name:zeytin_paket');
  }

  if (hasAny(text, ['dondurma']) && hasAny(text, ['kornet', 'külah', 'kulah', 'kullah'])) {
    return unitResult('Paket', 'name:dondurma_aksesuar_paket');
  }
  const hasIceCreamVolume = matchesAny(text, [/\b(1500|1200|1000|925|900|850|750|500)\s*(ml|gr|g)?\b/, /\b[12]\s*l\b/]);
  const isIceCreamProduct = hasAny(text, ['dondurma', 'algida', 'magnum', 'cornetto']) || (hasAny(text, ['carte d']) && hasIceCreamVolume);
  if (isIceCreamProduct) {
    if (hasAny(text, ['kova'])) return unitResult('Kova', 'name:dondurma_kova');
    if (hasIceCreamVolume) return unitResult('Kutu', 'name:dondurma_kutu');
    return unitResult('Adet', 'name:dondurma_tekil');
  }

  if (hasAny(text, ['süt tozu', 'sut tozu', 'süt dilimi', 'sut dilimi', 'süt burger', 'sut burger']) || hasAny(text, ['sütlü', 'sutlu'])) {
    return unitResult('Paket', 'name:sutlu_paketli_gida');
  }
  const isMilkProduct = tag === 'süt, ayran, kefir'
    || tag === 'sut, ayran, kefir'
    || matchesAny(name, [/(^|\s)(ayran|kefir)(\s|$)/, /(pınar|pinar|sek|şek|sek|içim|icim)\s+(süt|sut)(\s|$)/, /(^|\s)(süt|sut)\s+1\/[15](\s|$)/]);
  if (isMilkProduct) {
    if (hasAny(text, ['bardak', 'cup'])) return unitResult('Kap', 'name:sut_ayran_kap');
    if (hasAny(text, ['şişe', 'sise', 'cam', 'pet'])) return unitResult('Şişe', 'name:sut_ayran_sise');
    return unitResult('Kutu', 'name:sut_ayran_kutu');
  }

  const isBeverage = hasAny(text, ['maden suyu', 'meyve suyu', 'mey suyu', 'nektar', 'ice tea', 'limonata', 'enerji içecek', 'enerji icecek', 'red bull', 'monster', 'cappy', 'dimes', 'meyöz', 'meyoz'])
    || ['su', 'gazlı içecek', 'gazli icecek', 'meyve suyu, soğuk içecek', 'meyve suyu, soguk icecek'].includes(tag)
    || ['su', 'soda', 'kola', 'gazoz', 'fanta', 'sprite'].some((token) => hasToken(text, token));
  if (isBeverage) {
    if (matchesAny(name, [/\b\d+([,.]\d+)?\s*(g|gr|kg)\b/, /x\d+([,.]\d+)?\s*g\b/]) && !matchesAny(name, [/\b\d+([,.]\d+)?\s*(ml|l)\b/])) return unitResult('Paket', 'name:kuru_icecek_paket');
    if (hasAny(text, ['kutu', 'teneke', 'tetra']) || matchesAny(text, [/\b1\/[15]\b/])) return unitResult('Kutu', 'name:icecek_kutu');
    return unitResult('Şişe', 'name:icecek_sise');
  }

  if ((/\bbal\b/.test(text) && !hasAny(text, ['balık', 'balik', 'ton bal', 'hay bal'])) || hasAny(text, ['reçel', 'recel', 'tahin', 'pekmez', 'fındık krem', 'findik krem', 'fıstık ezme', 'fistik ezme', 'nutella', 'sarelle'])) {
    return unitResult('Kavanoz', 'name:kavanoz_kahvaltilik');
  }
  if (hasAny(text, ['yoğurt', 'yogurt']) && !PERSONAL_CARE_TAGS.has(tag)) {
    if (hasAny(text, ['kova']) || matchesAny(text, [/\b[235]\s*kg\b/])) return unitResult('Kova', 'name:yogurt_kova');
    return unitResult('Kap', 'name:yogurt_kap');
  }

  if (hasAny(text, ['konserve', 'ton balığı', 'ton baligi', 'salça', 'salca'])) {
    if (hasAny(text, ['kavanoz', 'cam'])) return unitResult('Kavanoz', 'name:konserve_kavanoz');
    return unitResult('Kutu', 'name:konserve_kutu');
  }

  const personalCareTag = PERSONAL_CARE_TAGS.has(tag);
  if (hasAny(text, ['diş macunu', 'dis macunu']) || (personalCareTag && hasAny(text, ['krem ', 'kremi', 'merhem']))) {
    return unitResult('Tüp', 'name:tup_kisisel_bakim');
  }
  if (hasAny(text, ['diş fırçası', 'dis fircasi', 'tarak', 'jilet'])) {
    return unitResult('Adet', 'name:tekil_kisisel_bakim');
  }
  if (hasAny(text, ['şampuan', 'sampuan', 'duş jeli', 'dus jeli', 'losyon', 'kolonya', 'deodorant', 'parfüm', 'parfum', 'sprey', 'sıvı sabun', 'sivi sabun'])) {
    return unitResult('Şişe', 'name:sivi_kisisel_bakim');
  }
  if (hasAny(text, ['sabun'])) {
    if (hasAny(text, ['granül', 'granul', 'matik', 'torba'])) return unitResult('Paket', 'name:sabun_paket');
    return unitResult(matchesAny(text, [/\b\d+\s*li\b/, /\b\d+\s*lü\b/, /\b\d+\s*lu\b/]) ? 'Paket' : 'Adet', 'name:kati_sabun');
  }

  if (hasAny(name, ['deterjan', 'yumuşatıcı', 'yumusatici', 'çamaşır suyu', 'camasir suyu', 'bulaşık', 'bulasik', 'yüzey temizleyici', 'yuzey temizleyici', 'yağ çözücü', 'yag cozucu', 'kir çözücü', 'kir cozucu'])) {
    if (hasAny(name, ['tablet', 'kapsül', 'kapsul', 'toz', 'tuz', 'blok', 'tel', 'ovma'])) return unitResult('Paket', 'name:temizlik_kati');
    if (hasAny(text, ['bidon']) || matchesAny(text, [/\b[345]\s*l\b/])) return unitResult('Bidon', 'name:temizlik_bidon');
    return unitResult('Şişe', 'name:temizlik_sivi');
  }
  if (hasAny(text, ['çöp torbası', 'cop torbasi', 'buzdolabı poşeti', 'buzdolabi poseti', 'poşet', 'poset'])) {
    return unitResult('Paket', 'name:poset_paket');
  }
  if (hasAny(text, ['bebek bezi', 'bebek bez', 'kulot', 'külot', 'yüzücü', 'yuzucu', 'emici', 'tem bezi', 'temiz bezi', 'ağda bezi', 'agda bezi'])) {
    return unitResult('Paket', 'name:bez_paket');
  }
  if (hasAny(text, ['evy baby', 'canbebe', 'prima', 'molfix']) && hasAny(text, ['paket', 'junior', 'maxi', 'mini', 'beden'])) {
    return unitResult('Paket', 'name:bebek_bezi_paket');
  }
  if (hasAny(text, ['tuvalet kağıdı', 'tuvalet kagidi', 'kağıt havlu', 'kagit havlu', 'havlu kağıt', 'havlu kagit', 'peçete', 'pecete', 'mendil', 'ıslak mendil', 'islak mendil'])) {
    return unitResult('Paket', 'name:kagit_paket');
  }
  if (hasAny(text, ['folyo', 'streç', 'strec', 'pişirme kağıdı', 'pisirme kagidi'])) {
    return unitResult('Rulo', 'name:rulo_mutfak');
  }

  if (hasAny(text, ['cips', 'kraker', 'bisküvi', 'biskuvi', 'gofret', 'çikolata', 'cikolata', 'şekerleme', 'sekerleme', 'sakız', 'sakiz', 'kuruyemiş', 'kuruyemis', 'makarna', 'erişte', 'eriste', 'bulgur', 'pirinç', 'pirinc', 'mercimek', 'fasulye', 'un ', 'şeker ', 'seker ', 'kahve', 'çay ', 'cay ', 'mama', 'salam', 'sosis', 'sucuk', 'peynir', 'tereyağ', 'tereyag', 'margarin', 'tavuk'])) {
    return unitResult('Paket', 'name:paketli_gida');
  }
  if (hasAny(text, ['ekmek', 'simit', 'pide', 'poğaça', 'pogaca', 'açma', 'acma'])) {
    return unitResult('Adet', 'name:unlu_mamul_tekil');
  }

  if (ADET_TAGS.has(tag)) {
    return unitResult('Adet', 'tag:tekil_kategori', 'medium', 'category_base_unit_conflict');
  }
  if (PACKAGE_TAGS.has(tag)) {
    return unitResult('Paket', 'tag:paketli_kategori', 'medium', 'category_base_unit_conflict');
  }
  if (tag === 'gazlı içecek' || tag === 'gazli icecek' || tag === 'su') {
    return unitResult('Şişe', 'tag:icecek', 'medium', 'beverage_unit_conflict');
  }
  if (tag === 'meyve suyu, soğuk içecek' || tag === 'meyve suyu, soguk icecek') {
    return unitResult('Kutu', 'tag:meyve_suyu', 'medium', 'beverage_unit_conflict');
  }
  if (tag === 'duş, vücut bakım' || tag === 'dus, vucut bakim' || tag === 'cilt bakım' || tag === 'cilt bakim' || tag === 'saç bakım' || tag === 'sac bakim' || tag === 'deodorant, parfüm' || tag === 'deodorant, parfum') {
    return unitResult('Şişe', 'tag:kisisel_bakim', 'medium', 'category_base_unit_conflict');
  }
  if (tag === 'çamaşır bakım' || tag === 'camasir bakim' || tag === 'bulaşık' || tag === 'bulasik' || tag === 'yüzey, banyo, wc' || tag === 'yuzey, banyo, wc' || tag === 'oda kokusu') {
    if (matchesAny(name, [/\b\d+([,.]\d+)?\s*(g|gr|kg)\b/]) && !hasAny(name, ['sıvı', 'sivi', 'ml'])) return unitResult('Paket', 'tag:temizlik_toz_paket', 'medium', 'category_base_unit_conflict');
    return unitResult('Şişe', 'tag:temizlik', 'medium', 'category_base_unit_conflict');
  }
  if (tag === 'bal, reçel, tahin' || tag === 'bal, recel, tahin' || tag === 'kahvaltılık ezme, çikolata' || tag === 'kahvaltilik ezme, cikolata') {
    return unitResult('Kavanoz', 'tag:kahvaltilik_kavanoz', 'medium', 'category_base_unit_conflict');
  }
  if (tag === 'yoğurt' || tag === 'yogurt') {
    return unitResult('Kap', 'tag:yogurt', 'medium', 'category_base_unit_conflict');
  }
  if (tag === 'yağ' || tag === 'yag') {
    return unitResult('Şişe', 'tag:yag', 'medium', 'category_base_unit_conflict');
  }

  return unitResult(currentUnit, 'existing_or_canonical', 'keep', 'none');
}

export function classifyProductUnit(product = {}) {
  const oldUnit = normalizeUnit(product.unit, product.etiket || product.categoryName || product.category);
  const result = resolveProductBaseUnit({ ...product, unit: oldUnit });
  const isMismatch = result.unit !== oldUnit;
  const isCasePackAsBase = oldUnit === 'Koli' && result.unit !== 'Koli';
  const isKgOutsideFresh = oldUnit === 'Kg' && result.unit !== 'Kg';

  return {
    ...result,
    oldUnit,
    newUnit: result.unit,
    isMismatch,
    isSuspicious: isMismatch || isCasePackAsBase || isKgOutsideFresh,
    isCasePackAsBase,
    isKgOutsideFresh,
  };
}
