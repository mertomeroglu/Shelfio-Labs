export default function CustomerAppShell({ header, searchBar, quickActions, children, miniCart, bottomNav }) {
  return (
    <div className="customer-app-shell">
      <div className="customer-app-shell__top">
        {header}
        {searchBar}
        {quickActions}
      </div>
      <div className="customer-app-shell__content">{children}</div>
      {miniCart}
      {bottomNav}
    </div>
  );
}

