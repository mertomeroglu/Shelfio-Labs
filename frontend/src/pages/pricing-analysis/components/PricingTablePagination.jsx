export default function PricingTablePagination({
  totalRows,
  visibleRangeStart,
  visibleRangeEnd,
  currentPage,
  totalPages,
  onPrevious,
  onNext,
}) {
  if (!totalRows) return null;

  return (
    <div className="pricing-table-pagination pricing-table-pagination--top" aria-label="Sayfalama">
      <div className="pricing-table-pagination-row">
        <span className="pricing-table-pagination-summary">{totalRows} kayıttan {visibleRangeStart}-{visibleRangeEnd} arası</span>
        <button type="button" className="ghost-button pricing-toolbar-button pricing-table-pagination-button" onClick={onPrevious} disabled={currentPage <= 1}>Önceki</button>
        <span className="pricing-table-pagination-page">Sayfa {currentPage} / {totalPages}</span>
        <button type="button" className="primary-button pricing-toolbar-button pricing-table-pagination-button" onClick={onNext} disabled={currentPage >= totalPages}>Sonraki</button>
      </div>
    </div>
  );
}
