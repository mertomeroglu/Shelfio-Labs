import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmptyState from './EmptyState.jsx';

export default function DataTable({
  columns,
  rows,
  keyField = 'id',
  isLoading = false,
  emptyMessage = 'Kayıt bulunamadı',
  initialSort = null,
  pageSize = 10,
  topHorizontalScroll = false,
  onRowClick = null,
  isRowSelected = null,
  serverPagination = null,
  onPageChange = null,
  sortConfig: controlledSortConfig = undefined,
  onSortChange = null,
  manualSorting = false,
  compactPagination = false,
  className = '',
  panelClassName = '',
  tableWrapperClassName = '',
  tableClassName = '',
  loadingStateClassName = '',
  emptyStateClassName = '',
}) {
  const [internalSortConfig, setInternalSortConfig] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [pageInputError, setPageInputError] = useState('');
  const [horizontalMeta, setHorizontalMeta] = useState({ maxScroll: 0, scrollLeft: 0 });
  const tableWrapperRef = useRef(null);
  const topScrollRef = useRef(null);
  const isSyncingScrollRef = useRef(false);
  const sortConfig = controlledSortConfig === undefined ? internalSortConfig : controlledSortConfig;
  const isServerPaginated = Boolean(serverPagination);

  const sortedRows = useMemo(() => {
    if (manualSorting) {
      return rows;
    }

    if (!sortConfig?.key) {
      return rows;
    }

    const column = columns.find((item) => item.key === sortConfig.key);
    if (!column) {
      return rows;
    }

    const direction = sortConfig.direction === 'desc' ? -1 : 1;
    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue ? column.sortValue(left) : left[column.key];
      const rightValue = column.sortValue ? column.sortValue(right) : right[column.key];

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'tr') * direction;
    });
  }, [columns, manualSorting, rows, sortConfig]);

  useEffect(() => {
    if (!isServerPaginated) {
      setPage(1);
    }
  }, [isServerPaginated, rows, sortConfig]);

  const totalCount = isServerPaginated ? Number(serverPagination?.total || 0) : sortedRows.length;
  const totalPages = isServerPaginated
    ? Math.max(1, Number(serverPagination?.totalPages || 1))
    : Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = isServerPaginated ? Math.min(Math.max(1, Number(serverPagination?.page || 1)), totalPages) : Math.min(page, totalPages);
  const effectivePageSize = isServerPaginated ? Number(serverPagination?.limit || pageSize) : pageSize;
  const startEntry = totalCount ? (currentPage - 1) * effectivePageSize + 1 : 0;
  const visibleEntryCount = isServerPaginated ? sortedRows.length : Math.min(effectivePageSize, Math.max(totalCount - startEntry + 1, 0));
  const endEntry = totalCount ? Math.min(startEntry + visibleEntryCount - 1, totalCount) : 0;
  const paginatedRows = useMemo(() => {
    if (isServerPaginated) {
      return sortedRows;
    }
    const startIndex = (currentPage - 1) * pageSize;
    return sortedRows.slice(startIndex, startIndex + pageSize);
  }, [currentPage, isServerPaginated, pageSize, sortedRows]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handlePageInputChange = (event) => {
    const { value } = event.target;
    if (value === '') {
      setPageInput('');
      setPageInputError('');
      return;
    }

    if (!/^\d+$/.test(value)) {
      return;
    }

    setPageInput(value.replace(/^0+(?=\d)/, ''));
    setPageInputError('');
  };

  const goToPage = () => {
    const parsedPage = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsedPage)) {
      setPageInputError('Geçerli bir sayfa numarası girin.');
      setPageInput(String(currentPage));
      return;
    }

    const normalizedPage = Math.min(totalPages, Math.max(1, parsedPage));
    if (normalizedPage !== parsedPage) {
      setPageInputError(`Sayfa aralığı: 1 - ${totalPages}`);
    } else {
      setPageInputError('');
    }

    if (normalizedPage !== currentPage) {
      if (isServerPaginated) {
        onPageChange?.(normalizedPage);
      } else {
        setPage(normalizedPage);
      }
    }

    if (normalizedPage === currentPage && isServerPaginated) {
      onPageChange?.(normalizedPage);
    }

    setPageInput(String(normalizedPage));
  };

  const handlePageInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToPage();
    }
  };

  const movePage = (nextPage) => {
    const normalizedPage = Math.min(totalPages, Math.max(1, nextPage));
    if (isServerPaginated) {
      onPageChange?.(normalizedPage);
    } else {
      setPage(normalizedPage);
    }
    setPageInput(String(normalizedPage));
    setPageInputError('');
  };

  const updateHorizontalMeta = useCallback(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    const maxScroll = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    setHorizontalMeta({
      maxScroll,
      scrollLeft: Math.min(maxScroll, wrapper.scrollLeft || 0),
    });
  }, []);

  const syncHorizontalScroll = useCallback((source, target) => {
    if (!source || !target) return;
    if (isSyncingScrollRef.current) return;
    isSyncingScrollRef.current = true;
    target.scrollLeft = source.scrollLeft;
    setHorizontalMeta((current) => ({
      ...current,
      scrollLeft: source.scrollLeft,
    }));
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  const handleWrapperScroll = useCallback(() => {
    syncHorizontalScroll(tableWrapperRef.current, topScrollRef.current);
  }, [syncHorizontalScroll]);

  const handleTopScroll = useCallback(() => {
    syncHorizontalScroll(topScrollRef.current, tableWrapperRef.current);
  }, [syncHorizontalScroll]);

  const scrollHorizontally = useCallback((delta) => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    const next = Math.max(0, Math.min(wrapper.scrollLeft + delta, wrapper.scrollWidth - wrapper.clientWidth));
    wrapper.scrollTo({ left: next, behavior: 'smooth' });
  }, []);

  const handleTopScrollKeyDown = useCallback((event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollHorizontally(220);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollHorizontally(-220);
    }
  }, [scrollHorizontally]);

  useEffect(() => {
    if (!topHorizontalScroll) return;
    updateHorizontalMeta();
    const handleResize = () => updateHorizontalMeta();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [topHorizontalScroll, updateHorizontalMeta]);

  useEffect(() => {
    if (!topHorizontalScroll) return;
    updateHorizontalMeta();
  }, [columns, paginatedRows, sortedRows.length, topHorizontalScroll, updateHorizontalMeta]);

  const handleSort = (column) => {
    if (column.sortable === false) {
      return;
    }

    const resolveNextSort = (current) => {
      if (current?.key === column.key) {
        return {
          key: column.key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }

      return {
        key: column.key,
        direction: 'asc',
      };
    };
    const nextSort = resolveNextSort(sortConfig);
    if (onSortChange) {
      onSortChange(nextSort);
    } else {
      setInternalSortConfig(nextSort);
    }
  };

  const panelClassNames = ['table-panel', className, panelClassName].filter(Boolean).join(' ');

  if (isLoading) {
    return (
      <div className={[panelClassNames, 'loading-state', loadingStateClassName].filter(Boolean).join(' ')}>
        <span className="loader"></span>
        <p>Veriler yükleniyor...</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={[panelClassNames, emptyStateClassName].filter(Boolean).join(' ')}>
        <EmptyState title="Veri yok" description={emptyMessage} />
      </div>
    );
  }

  return (
    <div className={panelClassNames}>
      {topHorizontalScroll && horizontalMeta.maxScroll > 0 ? (
        <div className="table-top-scroll-shell">
          <button
            type="button"
            className="table-top-scroll-arrow"
            onClick={() => scrollHorizontally(-220)}
            disabled={horizontalMeta.scrollLeft <= 0}
            aria-label="Sola kaydır"
          >
            ←
          </button>
          <div
            className="table-top-scroll"
            ref={topScrollRef}
            onScroll={handleTopScroll}
            tabIndex={0}
            onKeyDown={handleTopScrollKeyDown}
            aria-label="Yatay tablo kaydırma"
          >
            <div style={{ width: `${horizontalMeta.maxScroll + 1}px`, height: '1px' }} />
          </div>
          <button
            type="button"
            className="table-top-scroll-arrow"
            onClick={() => scrollHorizontally(220)}
            disabled={horizontalMeta.scrollLeft >= horizontalMeta.maxScroll}
            aria-label="Sağa kaydır"
          >
            →
          </button>
        </div>
      ) : null}
      <div className={['table-wrapper', tableWrapperClassName].filter(Boolean).join(' ')} ref={tableWrapperRef} onScroll={handleWrapperScroll}>
        <table className={['data-table', tableClassName].filter(Boolean).join(' ')}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.className || ''}
                  aria-sort={
                    column.sortable === false ?
                      undefined
                      : sortConfig?.key === column.key ?
                        (sortConfig?.direction === 'desc' ? 'descending' : 'ascending')
                        : 'none'
                  }
                >
                  {(() => {
                    const isSortable = column.sortable !== false;
                    const isActiveSort = sortConfig?.key === column.key;
                    const isDesc = isActiveSort && sortConfig?.direction === 'desc';

                    return (
                  <button
                    type="button"
                    className={`table-sort-button ${isSortable ? '' : 'disabled'} ${isActiveSort ? 'is-active' : ''} ${isDesc ? 'is-desc' : ''} ${isActiveSort && !isDesc ? 'is-asc' : ''}`}
                    onClick={() => handleSort(column)}
                    disabled={!isSortable}
                  >
                    <span>{column.label}</span>
                    {isSortable ? (
                      <span className="table-sort-indicator" aria-hidden="true">
                        <span className={`table-sort-caret table-sort-caret-up ${isActiveSort && !isDesc ? 'is-active' : ''}`}>▲</span>
                        <span className={`table-sort-caret table-sort-caret-down ${isActiveSort && isDesc ? 'is-active' : ''}`}>▼</span>
                      </span>
                    ) : null}
                  </button>
                    );
                  })()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, index) => (
              <tr
                key={row[keyField] || `${row.productId || 'row'}-${index}`}
                className={`${onRowClick ? 'table-row-selectable' : ''} ${isRowSelected?.(row) ? 'table-row-selected' : ''}`.trim()}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.className || ''}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className={`table-pagination ${compactPagination ? 'table-pagination--compact' : ''}`}>
          <div className="table-pagination-summary-block">
            <div className="table-pagination-summary">
              {compactPagination ? (
                <span>Sayfa {currentPage} / {totalPages}</span>
              ) : (
                <>
                  <span>Sayfa</span>
                  <input
                    className="table-page-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onKeyDown={handlePageInputKeyDown}
                    aria-label="Sayfa numarası"
                  />
                  <span>/ {totalPages}</span>
                </>
              )}
              <span className="table-pagination-total">· {startEntry}-{endEntry} / {totalCount} kayıt</span>
            </div>
            {pageInputError ? <p className="table-pagination-error">{pageInputError}</p> : null}
          </div>
          <div className="table-pagination-actions">
            <button className="ghost-button" type="button" onClick={() => movePage(1)} disabled={currentPage === 1}>İlk</button>
            <button className="ghost-button" type="button" onClick={() => movePage(currentPage - 1)} disabled={currentPage === 1}>Önceki</button>
            {compactPagination ? (
              <input
                className="table-page-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pageInput}
                onChange={handlePageInputChange}
                onKeyDown={handlePageInputKeyDown}
                aria-label="Sayfa numarası"
              />
            ) : null}
            <button className="primary-button" type="button" onClick={goToPage}>Git</button>
            <button className="primary-button" type="button" onClick={() => movePage(currentPage + 1)} disabled={currentPage === totalPages}>Sonraki</button>
            <button className="ghost-button" type="button" onClick={() => movePage(totalPages)} disabled={currentPage === totalPages}>Son</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
