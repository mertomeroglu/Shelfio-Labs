import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CustomerCartQuickScanModal from './CustomerCartQuickScanModal.jsx';

const baseProps = {
  open: true,
  status: 'scanning',
  error: '',
  product: null,
  lastCode: '',
  manualQuery: '',
  searchResults: [],
  onManualQueryChange: vi.fn(),
  onManualSearch: vi.fn(),
  onSelectResult: vi.fn(),
  onAdd: vi.fn(),
  onSkip: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
};

describe('CustomerCartQuickScanModal', () => {
  it('does not render while closed', () => {
    render(<CustomerCartQuickScanModal {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a found product and forwards add/skip actions', () => {
    const onAdd = vi.fn();
    const onSkip = vi.fn();
    render(
      <CustomerCartQuickScanModal
        {...baseProps}
        status="product-found"
        product={{
          id: 'p1',
          name: 'Filtre Kahve',
          barcode: '869123',
          unit: 'adet',
          price: 80,
          originalPrice: 100,
          hasActiveDiscount: true,
          activeCampaign: { name: 'Hafta Sonu' },
        }}
        onAdd={onAdd}
        onSkip={onSkip}
      />
    );

    expect(screen.getByText('Filtre Kahve')).toBeInTheDocument();
    expect(screen.getByText('Hafta Sonu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ekle/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Geç' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('shows the scanned code and retries after a lookup miss', () => {
    const onRetry = vi.fn();
    render(
      <CustomerCartQuickScanModal
        {...baseProps}
        status="product-not-found"
        error="Bu barkodla eşleşen ürün bulunamadı."
        lastCode="869999"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Aranan değer: 869999')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Dene/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('submits manual search and allows choosing among multiple results', () => {
    const onManualSearch = vi.fn();
    const onSelectResult = vi.fn();
    const result = { id: 'p2', name: 'Türk Kahvesi', sku: 'TK-1', unit: 'adet', price: 120 };
    render(
      <CustomerCartQuickScanModal
        {...baseProps}
        status="search-results"
        manualQuery="kahve"
        searchResults={[result, { id: 'p3', name: 'Hazır Kahve', price: 90 }]}
        onManualSearch={onManualSearch}
        onSelectResult={onSelectResult}
      />
    );

    fireEvent.submit(screen.getByRole('searchbox').closest('form'));
    expect(onManualSearch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Türk Kahvesi/i }));
    expect(onSelectResult).toHaveBeenCalledWith(result);
  });
});
