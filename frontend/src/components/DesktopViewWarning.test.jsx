import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DesktopViewWarning from './DesktopViewWarning.jsx';

describe('DesktopViewWarning Component', () => {
  const originalInnerWidth = window.innerWidth;
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('navigator', {
      userAgent: originalUserAgent,
      configurable: true,
    });
    // Set standard desktop dimensions by default
    window.innerWidth = 1024;
    fireEvent(window, new Event('resize'));
  });

  afterEach(() => {
    window.innerWidth = originalInnerWidth;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderWithRouter = (initialEntries = ['/anasayfa']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<DesktopViewWarning />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('does not render warning on desktop (large screen, desktop User-Agent)', () => {
    window.innerWidth = 1024;
    renderWithRouter();
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('renders warning when viewport is narrow (<= 768px)', () => {
    window.innerWidth = 768;
    renderWithRouter();
    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
    expect(
      screen.getByText(/Shelfio yönetim paneli geniş ekranlarda daha verimli çalışır/i)
    ).toBeInTheDocument();
  });

  it('renders warning when User-Agent is mobile, even on large viewport', () => {
    window.innerWidth = 1024;
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    renderWithRouter();
    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
  });

  it('does not render warning on excluded customer routes (/musteri/*)', () => {
    window.innerWidth = 375; // mobile
    renderWithRouter(['/musteri/sepet']);
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('does not render warning on excluded personnel routes (/personel/*)', () => {
    window.innerWidth = 375; // mobile
    renderWithRouter(['/personel/gorevler']);
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('does not render warning on excluded hesap-sil route', () => {
    window.innerWidth = 375; // mobile
    renderWithRouter(['/hesap-sil']);
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('does not render warning on excluded gizlilik-politikasi route', () => {
    window.innerWidth = 375; // mobile
    renderWithRouter(['/gizlilik-politikasi']);
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('does not render warning on login screens (/giris, /login)', () => {
    window.innerWidth = 375; // mobile
    renderWithRouter(['/giris']);
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('dismisses warning and sets localStorage when "Anladım" is clicked', () => {
    window.innerWidth = 375;
    renderWithRouter();

    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
    
    const dismissButton = screen.getByRole('button', { name: 'Anladım' });
    fireEvent.click(dismissButton);

    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
    expect(localStorage.getItem('shelfio-desktop-warning-dismissed')).toBeTruthy();
  });

  it('dismisses warning and sets localStorage when "Devam Et" is clicked', () => {
    window.innerWidth = 375;
    renderWithRouter();

    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
    
    const continueButton = screen.getByRole('button', { name: 'Devam Et' });
    fireEvent.click(continueButton);

    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
    expect(localStorage.getItem('shelfio-desktop-warning-dismissed')).toBeTruthy();
  });

  it('dismisses warning and sets localStorage when close X icon is clicked', () => {
    window.innerWidth = 375;
    renderWithRouter();

    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
    
    const closeButton = screen.getByRole('button', { name: 'Kapat' });
    fireEvent.click(closeButton);

    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
    expect(localStorage.getItem('shelfio-desktop-warning-dismissed')).toBeTruthy();
  });

  it('hides warning if dismissed within last 24 hours', () => {
    window.innerWidth = 375;
    const pastTime = Date.now() - (12 * 60 * 60 * 1000); // 12 hours ago
    localStorage.setItem('shelfio-desktop-warning-dismissed', String(pastTime));

    renderWithRouter();
    expect(screen.queryByText('Masaüstü görünüm önerilir')).not.toBeInTheDocument();
  });

  it('shows warning again if dismissed more than 24 hours ago', () => {
    window.innerWidth = 375;
    const pastTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    localStorage.setItem('shelfio-desktop-warning-dismissed', String(pastTime));

    renderWithRouter();
    expect(screen.getByText('Masaüstü görünüm önerilir')).toBeInTheDocument();
  });
});
