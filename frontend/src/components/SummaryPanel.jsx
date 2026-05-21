export default function SummaryPanel({ title, value, caption, tone = 'default' }) {
  return (
    <div className={`summary-panel ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}
