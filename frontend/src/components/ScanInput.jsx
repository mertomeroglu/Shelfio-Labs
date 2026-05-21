import { ScanLine } from 'lucide-react';

export default function ScanInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Barkod okutun veya girin',
  loading = false,
  autoFocus = false,
  className = '',
  buttonText = 'Ara',
}) {
  return (
    <form className={`scan-input-form ${className}`.trim()} onSubmit={onSubmit}>
      <div className="scan-input-wrap">
        <ScanLine size={16} />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
        />
      </div>
      <button type="submit" className="primary-button" disabled={loading || !String(value || '').trim()}>
        {loading ? 'Aranıyor...' : buttonText}
      </button>
    </form>
  );
}


