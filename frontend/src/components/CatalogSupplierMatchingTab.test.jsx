import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogSupplierMatchingTab from './CatalogSupplierMatchingTab.jsx';

const listCatalogs = vi.fn();

vi.mock('../services/procurementService.js', () => ({
  procurementService: {
    listCatalogs: (...args) => listCatalogs(...args),
  },
}));

const catalog = {
  id: 'catalog-1',
  supplierId: 'supplier-1',
  supplierName: 'Test Tedarikçi',
  catalogName: 'Haziran Kataloğu',
  itemCount: 12,
  totalRowCount: 12,
  status: 'active',
  isActive: true,
  isActiveVersion: true,
  sourceType: 'import',
  sourceLabel: 'Manuel Yükleme',
  verificationStatus: 'verified',
  importStatus: 'completed',
  createdAt: '2026-06-09T10:00:00.000Z',
  uploadedAt: '2026-06-09T10:00:00.000Z',
};

describe('CatalogSupplierMatchingTab catalog list', () => {
  beforeEach(() => {
    listCatalogs.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading instead of the empty state while the first request is pending', async () => {
    vi.useFakeTimers();
    let resolveRequest;
    listCatalogs.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    render(<CatalogSupplierMatchingTab suppliers={[]} products={[]} />);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByText('Veriler yükleniyor...')).toBeInTheDocument();
    expect(screen.queryByText('Katalog bulunamadı.')).not.toBeInTheDocument();

    await act(async () => {
      resolveRequest({ items: [], page: 1, limit: 5, total: 0, totalPages: 1 });
      await Promise.resolve();
    });

    expect(screen.getByText('Katalog bulunamadı.')).toBeInTheDocument();
  });

  it('requests the next catalog page from the backend', async () => {
    listCatalogs.mockImplementation(({ page }) => Promise.resolve({
      items: [{ ...catalog, id: `catalog-${page}`, catalogName: `Katalog ${page}` }],
      page,
      limit: 5,
      total: 26,
      totalPages: 2,
    }));

    render(<CatalogSupplierMatchingTab suppliers={[]} products={[]} />);

    await waitFor(() => expect(screen.getByText('Katalog 1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));

    await waitFor(() => {
      expect(listCatalogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 5 }));
      expect(screen.getByText('Katalog 2')).toBeInTheDocument();
    });
  });
});
