const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getRiskLevel = (score) => {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
};

export const riskScoringService = {
  scoreProduct({ daysToExpiry, totalStock, criticalStock, avgDaily7, salesSpeed, isCriticalStock, overStockRatio, daysToStockout }) {
    let score = 0;
    const factors = [];

    if (daysToExpiry !== null) {
      if (daysToExpiry <= 3) {
        score += 35;
        factors.push('SKT kritik seviyede yakin');
      } else if (daysToExpiry <= 7) {
        score += 24;
        factors.push('SKT yaklasiyor');
      } else if (daysToExpiry <= 14) {
        score += 12;
      }
    }

    if (isCriticalStock) {
      score += 22;
      factors.push('Kritik stok seviyesinin altinda');
    }

    if (daysToStockout !== null && daysToStockout <= 5) {
      score += 18;
      factors.push('Stok hızla tükeniyor');
    } else if (daysToStockout !== null && daysToStockout <= 10) {
      score += 10;
    }

    if (salesSpeed === 'slow') {
      score += 14;
      factors.push('Satış hızı düşük');
    }

    if (overStockRatio >= 1.15) {
      score += 18;
      factors.push('Aşırı stok riski yüksek');
    } else if (overStockRatio >= 0.95) {
      score += 9;
      factors.push('Stok seviyesi yüksek');
    }

    if (avgDaily7 <= 0.25 && totalStock > Math.max(criticalStock * 2, 10)) {
      score += 12;
      factors.push('Satış yok denecek kadar az');
    }

    const finalScore = clamp(Math.round(score), 0, 100);
    return {
      score: finalScore,
      level: getRiskLevel(finalScore),
      factors,
    };
  },
};

