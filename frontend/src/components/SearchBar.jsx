import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';

export function InputWithIcon({
  icon,
  className = '',
  inputClassName = '',
  children,
  ...inputProps
}) {
  return (
    <div className={`input-with-icon ${className}`.trim()}>
      {icon ? <span className="input-with-icon__icon" aria-hidden="true">{icon}</span> : null}
      <input className={`input-with-icon__field ${inputClassName}`.trim()} {...inputProps} />
      {children}
    </div>
  );
}

export default function SearchBar({ value, onChange, placeholder = 'Ara...', children }) {
  return (
    <div className="toolbar">
      <InputWithIcon
        className="search-field"
        icon={<Search size={16} />}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}

export function SearchableCombobox({
  options = [],
  value = '',
  onChange,
  placeholder = 'Ara...',
  noResultsText = 'Sonuç bulunamadı',
  ariaLabel = 'Seçim alanı',
  disabled = false,
}) {
  const rootRef = useRef(null);
  const dropdownRef = useRef(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  const normalizedOptions = useMemo(() => {
    const seen = new Map();
    return (options || []).map((option, index) => {
      const rawValue = option?.value ?? '';
      const normalizedValue = String(rawValue);
      const currentCount = seen.get(normalizedValue) || 0;
      seen.set(normalizedValue, currentCount + 1);

      return {
        ...option,
        value: normalizedValue,
        _renderKey: currentCount === 0 ? normalizedValue : `${normalizedValue}__${currentCount}__${index}`,
      };
    });
  }, [options]);

  const selectedOption = useMemo(
    () => normalizedOptions.find((option) => option.value === String(value ?? '')) || null,
    [normalizedOptions, value]
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption?.label || '');
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !dropdownRef.current?.contains(event.target)) {
        setIsOpen(false);
        setQuery(selectedOption?.label || '');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [selectedOption]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updateDropdownPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownStyle({
        position: 'fixed',
        top: `${rect.bottom + 6}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      });
    };

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return normalizedOptions;
    }

    return normalizedOptions.filter((option) => {
      const haystack = [option.label, option.secondary, option.searchText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [normalizedOptions, query]);

  const commitSelection = (option) => {
    onChange?.(option?.value || '');
    setQuery(option?.label || '');
    setIsOpen(false);
    setActiveIndex(0);
  };

  const handleInputChange = (event) => {
    setQuery(event.target.value);
    setIsOpen(true);
    setActiveIndex(0);
  };

  const handleKeyDown = (event) => {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(0);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredOptions.length) return;
      setActiveIndex((current) => (current + 1) % filteredOptions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredOptions.length) return;
      setActiveIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (filteredOptions.length) {
        commitSelection(filteredOptions[activeIndex] || filteredOptions[0]);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      setQuery(selectedOption?.label || '');
    }
  };

  const dropdown = isOpen ? (
    <div
      className="searchable-combobox-dropdown searchable-combobox-dropdown-portal"
      ref={dropdownRef}
      style={dropdownStyle || undefined}
      role="listbox"
    >
      {filteredOptions.length ? (
        filteredOptions.map((option, index) => {
          const isSelected = option.value === value;

          return (
            <button
              key={option._renderKey}
              type="button"
              className={`searchable-combobox-option ${index === activeIndex ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitSelection(option)}
              role="option"
              aria-selected={isSelected}
            >
              <span className="searchable-combobox-option-text">
                <span className="searchable-combobox-option-label">{option.label}</span>
                {option.secondary ? <span className="searchable-combobox-option-secondary">{option.secondary}</span> : null}
              </span>
              {isSelected ? <Check size={14} className="searchable-combobox-check" aria-hidden="true" /> : null}
            </button>
          );
        })
      ) : (
        <div className="searchable-combobox-empty">{noResultsText}</div>
      )}
    </div>
  ) : null;

  return (
    <div className={`searchable-combobox ${disabled ? 'is-disabled' : ''}`} ref={rootRef}>
      <div className="searchable-combobox-input-wrap">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
        />
        {query || selectedOption ? (
          <button
            type="button"
            className="searchable-combobox-clear"
            onClick={() => {
              commitSelection(null);
              setQuery('');
            }}
            aria-label="Seçimi temizle"
            disabled={disabled}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {dropdown && typeof document !== 'undefined' ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
