import { Monitor, QrCode, Tag } from 'lucide-react';
import FormModal from './FormModal.jsx';
import ScanInput from './ScanInput.jsx';

const extractSectionNumberFromShelfCode = (shelfCode) => {
  const raw = String(shelfCode || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)/);
  return match?.[1] || null;
};

const resolveReyonNo = (product) => {
  const explicitReyonNo = String(product?.reyonNo || '').trim();
  if (explicitReyonNo) return explicitReyonNo;

  const sectionNo = product?.sectionNumber;
  if (sectionNo !== null && sectionNo !== undefined && String(sectionNo).trim() !== '') {
    return String(sectionNo).trim();
  }

  return extractSectionNumberFromShelfCode(product?.shelfCode);
};

const formatSectionCode = (product) => {
  const reyonNo = resolveReyonNo(product);
  if (!reyonNo) return '-';

  const shelfNo = String(product?.shelfNo || '').trim();
  const shelfLevel = String(product?.shelfLevel || '').trim();

  if (shelfNo && shelfLevel) {
    return `${reyonNo}R${shelfNo}-${shelfLevel}`;
  }

  return `R${reyonNo}`;
};

export default function BarcodeModal({
  isOpen,
  inputValue,
  onInputChange,
  onSubmit,
  loading,
  error,
  product,
  linkedDevice,
  onClose,
  onGoProduct,
  onGoLabel,
}) {
  if (!isOpen) return null;

  return (
    <FormModal
      isOpen={isOpen}
      title="Hızlı Barkod Arama"
      description="Scanner veya manuel giriş ile ürün bulun."
      headerIcon={<QrCode size={17} />}
      modalClassName="barcode-search-modal"
      onClose={onClose}
      confirmOnDirtyClose={false}
    >
      <div className="modal-form modal-structured-form barcode-search-form">
        <div className="modal-form-body-scroll barcode-search-scroll">
          <ScanInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSubmit}
            placeholder="Barkod okutun veya yapıştırın"
            loading={loading}
            autoFocus
            className="barcode-modal-input"
            buttonText="Ürünü Bul"
          />

          {error && <div className="barcode-modal-error">{error}</div>}

          {product && (
            <div className="barcode-modal-product">
              <div className="barcode-modal-product-head">
                <h4>{product.name}</h4>
                <span className="barcode-modal-code">{product.barcode || '-'}</span>
              </div>
              <div className="barcode-modal-grid">
                <div>
                  <span>Fiyat</span>
                  <strong>
                    ₺
                    {(product.salePrice || 0).toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span>Stok</span>
                  <strong>{product.currentStock ?? product.totalStock ?? 0}</strong>
                </div>
                <div>
                  <span>Kategori</span>
                  <strong>{product.categoryName || '-'}</strong>
                </div>
                <div>
                  <span>Tedarikçi</span>
                  <strong>{product.supplierName || '-'}</strong>
                </div>
                <div>
                  <span>Reyon</span>
                  <strong className="barcode-modal-code">{formatSectionCode(product)}</strong>
                </div>
                <div>
                  <span>ESL / Etiket</span>
                  <strong>
                    {linkedDevice ?
                      `${linkedDevice.id} · ${linkedDevice.template || 'standart'}`
                      : 'Atanmadı'}
                  </strong>
                </div>
              </div>

              <div className="barcode-modal-actions">
                <button type="button" className="ghost-button" onClick={onGoProduct}>
                  <Tag size={14} /> Ürüne Git
                </button>
                <button type="button" className="ghost-button" onClick={onGoLabel}>
                  <Monitor size={14} /> Etiket Yönetimi
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </FormModal>
  );
}
