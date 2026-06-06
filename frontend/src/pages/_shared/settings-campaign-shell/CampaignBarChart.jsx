import { AlertTriangle, Info, RefreshCw } from 'lucide-react';

const CampaignChartEmpty = ({
  title,
  description,
  showRefresh = false,
  onRefresh,
  refreshing = false,
}) => (
  <div className="campaign-chart-empty" role="status">
    <span className="campaign-chart-empty-icon" aria-hidden="true">
      {showRefresh ? <AlertTriangle size={18} /> : <Info size={18} />}
    </span>
    <strong>{title || 'Gosterilecek kampanya verisi bulunmuyor'}</strong>
    <span>{description || 'Veri olustugunda bu alan otomatik guncellenecek.'}</span>
    {showRefresh ? (
      <button
        type="button"
        className="ghost-button campaign-chart-empty-action"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />
        Yenile
      </button>
    ) : null}
  </div>
);

const CampaignBarChart = ({ rows = [], ariaLabel = 'Kampanya grafigi', formatNumber }) => {
  const normalizedRows = rows.map((item) => ({
    ...item,
    count: Math.max(0, Number(item?.count || 0) || 0),
  }));
  const maxCount = Math.max(1, ...normalizedRows.map((item) => item.count));
  const format = typeof formatNumber === 'function' ? formatNumber : (value) => String(value);

  return (
    <div className="campaign-bar-chart" role="img" aria-label={ariaLabel}>
      {normalizedRows.map((item) => {
        const width = item.count > 0 ? Math.max(8, (item.count / maxCount) * 100) : 0;
        return (
          <div className="campaign-bar-chart-row" key={item.name}>
            <div className="campaign-bar-chart-label">
              <span>{item.name}</span>
              <strong>{format(item.count)}</strong>
            </div>
            <div className="campaign-bar-chart-track" aria-hidden="true">
              <span
                className="campaign-bar-chart-fill"
                style={{
                  '--campaign-chart-bar-width': `${width}%`,
                  '--campaign-chart-bar-color': item.color || '#4f46e5',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export { CampaignBarChart, CampaignChartEmpty };
