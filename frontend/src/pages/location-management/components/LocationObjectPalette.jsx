import React from 'react';
import { Package, Inbox, Warehouse, LogIn, LogOut, ShoppingCart, MoveHorizontal, MapPin, Snowflake, Star, Wrench, Square, Settings } from 'lucide-react';

const PALETTE_ITEMS = [
  { type: 'section', label: 'Reyon', Icon: Package, color: '#E0E7FF' },
  { type: 'shelf', label: 'Raf', Icon: Inbox, color: '#F1F5F9' },
  { type: 'warehouse_location', label: 'Depo Hücresi', Icon: Warehouse, color: '#CCFBF1' },
  { type: 'warehouse_door', label: 'Depo Kapısı', Icon: LogIn, color: '#E2E8F0' },
  { type: 'cashier', label: 'Kasa', Icon: ShoppingCart, color: '#DCFCE7' },
  { type: 'entrance', label: 'Giriş', Icon: LogIn, color: '#D1FAE5' },
  { type: 'exit', label: 'Çıkış', Icon: LogOut, color: '#FFE4E6' },
  { type: 'aisle', label: 'Koridor', Icon: MoveHorizontal, color: 'rgba(248, 250, 252, 0.4)' },
  { type: 'zone', label: 'Bölge', Icon: MapPin, color: '#FFEDD5' },
  { type: 'cold_cabinet', label: 'Soğuk Dolap', Icon: Snowflake, color: '#E0F2FE' },
  { type: 'campaign_stand', label: 'Kampanya Standı', Icon: Star, color: '#F3E8FF' },
  { type: 'service_area', label: 'Servis Alanı', Icon: Wrench, color: '#FEF3C7' },
  { type: 'empty_area', label: 'Boş Alan', Icon: Square, color: '#F3F4F6' },
  { type: 'custom', label: 'Özel Alan', Icon: Settings, color: '#F5F3FF' },
];

export default function LocationObjectPalette({ onAddObject }) {
  return (
    <aside className="lm-layout-palette">
      <header className="lm-layout-palette-header">
        <h4>Obje Paleti</h4>
        <p>Plana eklemek için öğelere tıklayın</p>
      </header>
      <div className="lm-layout-palette-list">
        {PALETTE_ITEMS.map((item) => (
          <button
            key={item.type}
            type="button"
            className="lm-layout-palette-item"
            onClick={() => onAddObject(item.type)}
            style={{
              borderLeft: `5px solid ${item.color.startsWith('rgba') ? '#cbd5e1' : item.color}`,
            }}
          >
            <span className="lm-layout-palette-symbol" style={{ display: 'flex', alignItems: 'center', color: '#64748b' }}>
              <item.Icon size={16} />
            </span>
            <span className="lm-layout-palette-label">{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
