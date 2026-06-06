import { Megaphone } from 'lucide-react';

const CampaignActionCandidatesTable = ({
  title,
  description,
  icon: SectionIcon = Megaphone,
  total,
  rows,
  pagination,
  columns,
  tableClassName = '',
  rowClassName,
  emptyTitle,
  emptyDescription,
}) => (
  <section className="campaign-table-card campaign-insight-standard-section">
    <div className="campaign-table-card-head">
      <div className="campaign-table-card-head-main">
        <span className="campaign-table-card-icon" aria-hidden="true"><SectionIcon size={16} /></span>
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      {pagination}
    </div>
    {total ? (
      <div className="table-wrapper campaign-insight-table-wrap">
        <table className={`data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-suggestion-table ${tableClassName}`.trim()}>
          <thead><tr>{columns.map((column) => <th key={column.key} className={column.className || ''}>{column.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={typeof rowClassName === 'function' ? rowClassName(row) : ''}>
                {columns.map((column) => <td key={column.key} className={column.className || ''}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="campaign-empty-state-box campaign-empty-state-box--compact" role="status">
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
    )}
  </section>
);

export default CampaignActionCandidatesTable;
