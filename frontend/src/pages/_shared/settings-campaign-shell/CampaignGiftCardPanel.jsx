const CampaignGiftCardKpiRow = ({ assignedGiftCardCount, assignableGiftCardCount, activeGiftCardCount, formatNumber }) => {
  const format = typeof formatNumber === 'function' ? formatNumber : (value) => String(value);

  return (
    <div className="campaign-giftcard-kpi-row" aria-label="Hediye karti KPI Ozet">
      <div><span>Atanan Kart</span><strong>{format(assignedGiftCardCount)}</strong></div>
      <div><span>Atamaya Uygun</span><strong>{format(assignableGiftCardCount)}</strong></div>
      <div><span>Aktif Kart Sayisi</span><strong>{format(activeGiftCardCount)}</strong></div>
    </div>
  );
};

export { CampaignGiftCardKpiRow };
