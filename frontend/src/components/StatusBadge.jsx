const inferTone = (tone, children) => {
  const label = String(children ?? '').trim().toLowerCase();

  if (label === 'aktif') {
    return 'success';
  }

  if (label === 'pasif') {
    return 'neutral';
  }

  if (label === 'kritik') {
    return 'danger';
  }

  if (label.includes('düşük')) {
    return 'warning';
  }

  if (label.includes('normal')) {
    return 'info';
  }

  return tone || 'neutral';
};

export default function StatusBadge({ tone = 'neutral', children }) {
  const resolvedTone = inferTone(tone, children);
  return <span className={`badge ${resolvedTone}`}>{children}</span>;
}

