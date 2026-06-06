import { formatNumber } from '../../../services/formatters.js';

export function PaginationControls({ page, pageSize, total, onPageChange, label }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? ((safePage - 1) * pageSize) + 1 : 0;
  const end = total ? Math.min(safePage * pageSize, total) : 0;

  if (!total) return null;

  return (
    <div className="ps-pagination" aria-label={label}>
      <span className="ps-pagination-summary">Sayfa {safePage} / {totalPages} - {start}-{end} / {formatNumber(total)} kayıt</span>
      <div className="ps-pagination-actions">
        <button className="ghost-button ps-btn ps-pagination-btn is-prev" type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1}>Önceki</button>
        <button className="primary-button ps-btn ps-pagination-btn is-next" type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages}>Sonraki</button>
      </div>
    </div>
  );
}

export function MinimalPaginationControls({ page, pageSize, total, onPageChange, label }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? ((safePage - 1) * pageSize) + 1 : 0;
  const end = total ? Math.min(safePage * pageSize, total) : 0;

  if (!total) return null;

  return (
    <div className="ps-pagination ps-pagination--minimal" aria-label={label}>
      <span className="ps-pagination-summary">{formatNumber(total)} kayıttan {start}-{end} arası</span>
      <button className="ghost-button ps-btn ps-pagination-btn is-prev" type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1}>Önceki</button>
      <span className="ps-pagination-page">Sayfa {safePage} / {totalPages}</span>
      <button className="primary-button ps-btn ps-pagination-btn is-next" type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages}>Sonraki</button>
    </div>
  );
}
