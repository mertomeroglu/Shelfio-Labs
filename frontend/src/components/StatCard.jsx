export default function StatCard({ title, value, hint, tone = 'default' }) {
  return (
    <article className={`stat-card ${tone}`}>
      <span className="stat-label">{title}</span>
      <strong className="stat-value">{value}</strong>
      <p className="stat-hint">{hint}</p>
    </article>
  );
}
