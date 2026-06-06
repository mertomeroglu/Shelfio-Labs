import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  window.ResizeObserver = window.ResizeObserver || class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  window.scrollTo = window.scrollTo || (() => {});

  if (typeof window.HTMLMediaElement !== 'undefined') {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: vi.fn(() => Promise.resolve()),
    });

    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
}

