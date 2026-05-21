/**
 * Shelfio Canonical Unit System
 * Tüm ürünlerde kullanılabilecek geçerli birimlerin tek kaynağı.
 * Import, create, edit ve catalog işlemlerinde bu set referans alınır.
 */

export const CANONICAL_UNITS = [
  'Adet', 'Paket', 'Şişe', 'Kutu', 'Koli', 'Kg', 'g', 'L', 'ml',
  'Kova', 'Bidon', 'Tüp', 'Viyol', 'Demet', 'Kavanoz', 'Kap', 'Poşet', 'Rulo', 'Tablet',
];

export const CANONICAL_UNITS_LOWER = CANONICAL_UNITS.map((u) => u.toLocaleLowerCase('tr-TR'));

/**
 * Etiket (alt kategori) bazlı önerilen varsayılan birim.
 * Yeni ürün oluşturulurken veya import sırasında kullanılır.
 */
export const ETIKET_DEFAULT_UNIT = {
  'Meyve': 'Kg',
  'Sebze': 'Kg',
  'Taze Meyve': 'Kg',
  'Taze Sebze': 'Kg',
  'Et, Tavuk, Balık': 'Kg',
  'Bisküvi, Kraker, Kek': 'Paket',
  'Çikolata, Gofret': 'Paket',
  'Şekerleme, Sakız': 'Paket',
  'Bakliyat, Makarna': 'Paket',
  'Baharat, Tuz': 'Paket',
  'Çorba, Bulyon': 'Paket',
  'İşlenmiş Et, Şarküteri': 'Paket',
  'Pasta, Tatlı': 'Paket',
  'Dondurulmuş Gıda': 'Paket',
  'Hazır Yemek': 'Paket',
  'Bebek Maması': 'Paket',
  'Çay, Kahve': 'Paket',
  'Peynir, Tereyağı': 'Paket',
  'Tereyağı, Margarin, Krema': 'Paket',
  'Atıştırmalık': 'Paket',
  'Kuruyemiş': 'Paket',
  'Peçete, Mendil': 'Paket',
  'Bebek Bezi': 'Paket',
  'Gazlı İçecek': 'Şişe',
  'Meyve Suyu, Soğuk İçecek': 'Şişe',
  'Yağ': 'Şişe',
  'Duş, Vücut Bakım': 'Şişe',
  'Cilt Bakım': 'Şişe',
  'Saç Bakım': 'Şişe',
  'Deodorant, Parfüm': 'Şişe',
  'Çamaşır Bakım': 'Şişe',
  'Bulaşık': 'Şişe',
  'Yüzey, Banyo, WC': 'Şişe',
  'Oda Kokusu': 'Şişe',
  'Süt, Ayran, Kefir': 'Kutu',
  'Konserve': 'Kutu',
  'Balık, Deniz Ürünleri': 'Kutu',
  'Bal, Reçel, Tahin': 'Kavanoz',
  'Kahvaltılık Ezme, Çikolata': 'Kavanoz',
  'Yoğurt': 'Kap',
  'Yumurta, Zeytin': 'Adet',
  'Kırtasiye, Ofis': 'Adet',
  'Tekstil, Giyim': 'Adet',
  'Mutfak, Sofra': 'Adet',
  'Bebek Ürünleri': 'Adet',
  'Bebek Tekstil': 'Adet',
  'Ağız Bakım': 'Adet',
  'Ekmek, Unlu Mamul': 'Adet',
  'Dondurma': 'Adet',
};

/**
 * Verilen birim değerini canonical sete normalize eder.
 * Eğer unit canonical ise aynen döner.
 * Eğer bilinmeyen ise etiket/kategori bazlı tahmin yapar.
 * @param {string} rawUnit
 * @param {string} [etiket]
 * @returns {string}
 */
export function normalizeUnit(rawUnit, etiket) {
  const trimmed = String(rawUnit || '').trim();
  if (!trimmed) {
    return ETIKET_DEFAULT_UNIT[etiket] || 'Adet';
  }

  // Exact canonical match (case insensitive)
  const lower = trimmed.toLocaleLowerCase('tr-TR');
  const exactIdx = CANONICAL_UNITS_LOWER.indexOf(lower);
  if (exactIdx >= 0) {
    return CANONICAL_UNITS[exactIdx]; // Return properly cased version
  }

  // Common aliases
  const ALIASES = {
    'adet': 'Adet', 'ad': 'Adet', 'pcs': 'Adet', 'piece': 'Adet',
    'paket': 'Paket', 'pk': 'Paket', 'pack': 'Paket', 'pkt': 'Paket',
    'şişe': 'Şişe', 'sise': 'Şişe', 'bottle': 'Şişe', 'pet': 'Şişe', 'btl': 'Şişe',
    'kutu': 'Kutu', 'box': 'Kutu', 'tetra': 'Kutu', 'teneke': 'Kutu',
    'koli': 'Koli', 'krt': 'Koli', 'case': 'Koli', 'carton': 'Koli',
    'kg': 'Kg', 'kilo': 'Kg', 'kilogram': 'Kg',
    'gr': 'g', 'gram': 'g',
    'lt': 'L', 'litre': 'L', 'liter': 'L',
    'kova': 'Kova', 'bucket': 'Kova',
    'bidon': 'Bidon', 'galon': 'Bidon',
    'tüp': 'Tüp', 'tube': 'Tüp', 'tup': 'Tüp',
    'viyol': 'Viyol',
    'demet': 'Demet', 'bunch': 'Demet',
    'kavanoz': 'Kavanoz', 'jar': 'Kavanoz', 'cam': 'Kavanoz',
    'kap': 'Kap', 'cup': 'Kap', 'container': 'Kap',
    'poşet': 'Poşet', 'poset': 'Poşet', 'bag': 'Poşet',
    'rulo': 'Rulo', 'roll': 'Rulo',
    'tablet': 'Tablet', 'tab': 'Tablet',
  };

  if (ALIASES[lower]) return ALIASES[lower];

  // Etiket fallback
  if (etiket && ETIKET_DEFAULT_UNIT[etiket]) {
    return ETIKET_DEFAULT_UNIT[etiket];
  }

  return 'Adet';
}

/**
 * Verilen birimin canonical set'te olup olmadığını kontrol eder.
 * @param {string} unit
 * @returns {boolean}
 */
export function isValidUnit(unit) {
  const lower = String(unit || '').trim().toLocaleLowerCase('tr-TR');
  return CANONICAL_UNITS_LOWER.includes(lower);
}

/**
 * Etiket bazlı önerilen birimleri döner (UI dropdown önerisi için).
 * @param {string} etiket
 * @returns {string[]}
 */
export function suggestUnitsForEtiket(etiket) {
  const primary = ETIKET_DEFAULT_UNIT[etiket];
  if (!primary) return [...CANONICAL_UNITS];

  const suggestions = [primary, ...CANONICAL_UNITS.filter((u) => u !== primary)];
  return suggestions;
}
