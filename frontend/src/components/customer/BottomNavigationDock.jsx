export default function BottomNavigationDock({ tabs, activeTab, onChange, badgesByKey = {} }) {
  return (
    <nav className="bottom-navigation-dock" aria-label="Müşteri alt navigasyon">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const badgeCount = Number(badgesByKey?.[tab.key] || 0);
        return (
          <button
            key={tab.key}
            type="button"
            className={`${activeTab === tab.key ? 'is-active' : ''} ${tab.key === 'cart' ? 'is-cart-tab' : ''}`.trim()}
            onClick={() => onChange(tab.key)}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            aria-label={tab.label}
          >
            <span className="bottom-navigation-dock__icon-wrap">
              <Icon size={20} />
              {badgeCount > 0 ? <span className="bottom-navigation-dock__badge">{badgeCount}</span> : null}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
