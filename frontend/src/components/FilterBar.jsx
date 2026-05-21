export default function FilterBar({ children, actions, className = '' }) {
  return (
    <div className={`filter-bar ${className}`.trim()}>
      <div className="filter-bar-fields">{children}</div>
      {actions ? <div className="filter-actions">{actions}</div> : null}
    </div>
  );
}
