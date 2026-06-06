import { useEffect, useRef } from 'react';

// Firmware reference: backend/ESL_firmware/esl_label_firmware.ino
// GxEPD2_290_T94 with display.setRotation(1), rendered as 296 x 128 px.
const DISPLAY_W = 296;
const DISPLAY_H = 128;
const RENDER_SCALE = 3;

const TEMPLATES = {
  standard: 'Standart',
  campaign: 'Fırsat',
  discount: 'İndirim',
};

const font = {
  system: 'Arial, sans-serif',
  mono: 'monospace',
};

function normalizeTrToAscii(value) {
  return String(value || '')
    .replace(/[üÜ]/g, (ch) => (ch === 'Ü' ? 'U' : 'u'))
    .replace(/[şŞ]/g, (ch) => (ch === 'Ş' ? 'S' : 's'))
    .replace(/[ğĞ]/g, (ch) => (ch === 'Ğ' ? 'G' : 'g'))
    .replace(/[ıİ]/g, (ch) => (ch === 'İ' ? 'I' : 'i'))
    .replace(/[öÖ]/g, (ch) => (ch === 'Ö' ? 'O' : 'o'))
    .replace(/[çÇ]/g, (ch) => (ch === 'Ç' ? 'C' : 'c'));
}

function formatFdtDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'Invalid Date') return '';
  const cleaned = raw.replace(/^F\.?\s*D\.?\s*T\.?:?\s*/i, '').trim();
  const ymd = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[3]}.${ymd[2]}.${ymd[1]}`;
  const dmy = cleaned.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (dmy) return `${dmy[1]}.${dmy[2]}.${dmy[3]}`;
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return [
      String(parsed.getDate()).padStart(2, '0'),
      String(parsed.getMonth() + 1).padStart(2, '0'),
      parsed.getFullYear(),
    ].join('.');
  }
  return cleaned;
}

function formatFdtLabel(value) {
  const dateText = formatFdtDate(value);
  return dateText ? `FDT:${dateText}` : '';
}

function splitPrice(value) {
  const numeric = Math.max(0, Number(value) || 0);
  const major = String(Math.floor(numeric));
  const minor = String(Math.round((numeric - Math.floor(numeric)) * 100)).padStart(2, '0').slice(0, 2);
  return { major, minor };
}

function resolveProduct(product) {
  if (!product) {
    return {
      clearMode: false,
      placeholderMode: true,
      name: 'Urun Secilmedi',
      barcode: '',
      salePrice: 0,
      previousSalePrice: 0,
      origin: '-',
      fdt: '',
    };
  }

  const price = Number(product.salePrice ?? product.price ?? product.displayPrice ?? 0) || 0;
  const barcode = String(product.barcode || '0000000000000').trim() || '0000000000000';
  const productName = String(product.name || product.productName || 'Bilinmeyen Urun').trim();
  const normalizedName = normalizeTrToAscii(productName).trim().toUpperCase();
  const clearMode = Boolean(product.clearLabel || product.cleared || product.isCleared)
    || (['URUN SECILMEDI', 'ETIKET TEMIZLENDI', 'BOS ETIKET'].includes(normalizedName)
      && barcode === '0000000000000'
      && price === 0);

  return {
    clearMode,
    placeholderMode: false,
    name: normalizeTrToAscii(productName || 'Bilinmeyen Urun'),
    barcode,
    salePrice: price,
    previousSalePrice: Number(product.previousSalePrice ?? product.previousPrice ?? product.oldPrice ?? 0) || 0,
    hasDiscountPrice: Number(product.previousSalePrice ?? product.previousPrice ?? product.oldPrice ?? 0) > price,
    origin: normalizeTrToAscii(product.origin || 'Turkiye'),
    fdt: formatFdtLabel(product.lastPriceChangeDate || product.lastPriceChangeAt || product.fdt || product.expiryDate || ''),
  };
}

function drawFrame(ctx, x = 0, y = 0, w = DISPLAY_W, h = DISPLAY_H) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) lines.push('');

  const lastIndex = lines.length - 1;
  while (ctx.measureText(lines[lastIndex]).width > maxWidth && lines[lastIndex].length > 0) {
    lines[lastIndex] = lines[lastIndex].slice(0, -1);
  }
  return lines;
}

function drawFlashIcon(ctx, x, y, color = '#ffffff') {
  const cx = x + 8;
  const cy = y + 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
  ctx.moveTo(cx - 1, cy - 6); ctx.lineTo(cx - 1, cy + 6);
  ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx - 6, cy - 1); ctx.lineTo(cx + 6, cy - 1);
  ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4);
  ctx.moveTo(cx - 4, cy - 5); ctx.lineTo(cx + 4, cy + 3);
  ctx.moveTo(cx - 4, cy + 4); ctx.lineTo(cx + 4, cy - 4);
  ctx.moveTo(cx - 5, cy + 4); ctx.lineTo(cx + 3, cy - 4);
  ctx.stroke();
}

function drawDiscountIcon(ctx, x, y, color = '#ffffff') {
  const x0 = x + 1; const y0 = y + 4;
  const x1 = x + 6; const y1 = y + 8;
  const x2 = x + 10; const y2 = y + 6;
  const x3 = x + 16; const y3 = y + 12;
  const tipX = x + 21; const tipY = y + 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let dy = 0; dy <= 1; dy += 1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + dy);
    ctx.lineTo(x1, y1 + dy);
    ctx.lineTo(x2, y2 + dy);
    ctx.lineTo(x3, y3 + dy);
    ctx.lineTo(tipX, tipY + dy);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - 4, tipY - 4);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - 4, tipY + 4);
  ctx.moveTo(tipX - 1, tipY);
  ctx.lineTo(tipX - 5, tipY - 4);
  ctx.moveTo(tipX - 1, tipY);
  ctx.lineTo(tipX - 5, tipY + 4);
  ctx.stroke();
}

function buildEan13Modules(rawCode) {
  const lCode = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const rCode = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const gCode = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const digits = String(rawCode || '').replace(/\D/g, '').slice(0, 13).padEnd(13, '0') || '0000000000000';
  const firstDigit = Number(digits[0]) || 0;
  let modules = '101';

  for (let i = 1; i <= 6; i += 1) {
    const digit = Number(digits[i]) || 0;
    modules += parity[firstDigit][i - 1] === 'G' ? gCode[digit] : lCode[digit];
  }
  modules += '01010';
  for (let i = 7; i <= 12; i += 1) {
    modules += rCode[Number(digits[i]) || 0];
  }
  modules += '101';

  return { digits, modules };
}

function drawBarcode(ctx, rawCode, x, y, width, height) {
  const { digits, modules } = buildEan13Modules(rawCode || '0000000000000');
  const quietPx = 8;
  const total = modules.length;
  const barAreaW = Math.max(total, width - quietPx * 2);
  const startX = x + Math.max(0, Math.floor((width - barAreaW) / 2));

  ctx.fillStyle = '#000000';
  for (let i = 0; i < total; i += 1) {
    if (modules[i] === '1') {
      const bx = startX + Math.floor((i * barAreaW) / total);
      const nextX = startX + Math.floor(((i + 1) * barAreaW) / total);
      ctx.fillRect(bx, y, Math.max(1, nextX - bx), height);
    }
  }

  ctx.font = `6px ${font.mono}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(digits, x + width / 2, y + height + 8);
}

function drawBarcodePlaceholder(ctx, x, y, width, height) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.font = `bold 8px ${font.system}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText('Barkod bekleniyor', x + width / 2, y + Math.floor(height / 2) + 3);
}

function drawPriceBox(ctx, x, y, w, h, price, placeholderMode = false) {
  const { major, minor } = splitPrice(price);
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff';

  ctx.font = `bold 8px ${font.system}`;
  ctx.textAlign = 'center';
  ctx.fillText('KDV Dahil', x + w / 2, y + 12);
  ctx.fillText('KDV Dahil', x + w / 2 + 1, y + 12);

  if (placeholderMode) {
    ctx.font = `bold 24px ${font.system}`;
    ctx.textAlign = 'center';
    ctx.fillText('₺--,--', x + w / 2, y + 39);
    return;
  }

  const priceTop = y + 18;
  const priceAreaH = h - 18;
  ctx.font = `bold 36px ${font.system}`;
  const majorW = ctx.measureText(major).width;
  ctx.font = `bold 13px ${font.system}`;
  const minorText = `,${minor}`;
  const sideW = Math.max(ctx.measureText(minorText).width, ctx.measureText('TL').width);
  const totalW = majorW + 3 + sideW;
  const startX = Math.max(x + 3, x + (w - totalW) / 2);
  const baseline = Math.min(y + h - 5, priceTop + (priceAreaH + 34) / 2);

  ctx.font = `bold 36px ${font.system}`;
  ctx.textAlign = 'left';
  ctx.fillText(major, startX, baseline);
  const rightX = startX + majorW + 3;
  const topOfDigit = baseline - 34;
  ctx.font = `bold 13px ${font.system}`;
  ctx.fillText('TL', rightX, topOfDigit + 13);
  ctx.fillText(minorText, rightX, topOfDigit + 30);
}

function drawSmallPrice(ctx, price, x, baseline) {
  const { major, minor } = splitPrice(price);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = `bold 17px ${font.system}`;
  ctx.fillText(major, x, baseline);
  const majorW = ctx.measureText(major).width;
  ctx.font = `bold 12px ${font.system}`;
  const minorText = `,${minor}`;
  ctx.fillText(minorText, x + majorW + 2, baseline);
  const minorW = ctx.measureText(minorText).width;
  ctx.font = `8px ${font.system}`;
  ctx.fillText('TL', x + majorW + minorW + 6, baseline - 2);
}

function measureSmallPrice(ctx, price) {
  const { major, minor } = splitPrice(price);
  ctx.font = `bold 17px ${font.system}`;
  const majorW = ctx.measureText(major).width;
  ctx.font = `bold 12px ${font.system}`;
  const minorW = ctx.measureText(`,${minor}`).width;
  ctx.font = `8px ${font.system}`;
  return majorW + minorW + ctx.measureText('TL').width + 12;
}

function drawSmallPriceCentered(ctx, price, x, w, baseline) {
  const priceW = measureSmallPrice(ctx, price);
  drawSmallPrice(ctx, price, x + Math.max(0, (w - priceW) / 2), baseline);
}

function drawStandardLabel(ctx, data) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
  drawFrame(ctx);

  const IP = 8;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = `bold 17px ${font.system}`;
  let lines = wrapText(ctx, data.name, DISPLAY_W - IP * 2, 2);
  if (lines.length === 2 && ctx.measureText(data.name).width > (DISPLAY_W - IP * 2) * 2) {
    ctx.font = `bold 13px ${font.system}`;
    lines = wrapText(ctx, data.name, DISPLAY_W - IP * 2, 2);
  }
  const lineH = ctx.font.includes('13px') ? 15 : 20;
  lines.forEach((line, index) => {
    ctx.fillText(line, IP, IP + lineH + index * (lineH + 3));
  });

  const priceW = 130;
  const priceH = 56;
  const priceX = DISPLAY_W - priceW - 4;
  const priceY = DISPLAY_H - priceH - 4;

  const barH = 34;
  const bcX = IP;
  const bcW = priceX - IP - 12;
  const bcY = DISPLAY_H - 4 - barH - 6 - 2;
  const originY = bcY - 11;
  const fdtText = data.placeholderMode ? 'FDT: -' : (data.fdt || 'FDT:../../....');
  const originText = data.placeholderMode ? 'Mensei: -' : `Mensei: ${data.origin}`;

  ctx.font = `8px ${font.system}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(originText, bcX + bcW / 2, originY);
  ctx.fillText(fdtText, priceX + priceW / 2, priceY - 1);

  if (data.placeholderMode) {
    drawBarcodePlaceholder(ctx, bcX, bcY, bcW, barH);
  } else {
    drawBarcode(ctx, data.barcode, bcX, bcY, bcW, barH);
  }
  drawPriceBox(ctx, priceX, priceY, priceW, priceH, data.salePrice, data.placeholderMode);
}

function drawCampaignHeader(ctx, label, iconType) {
  const headerH = 30;
  ctx.fillStyle = '#000000';
  ctx.fillRect(3, 3, DISPLAY_W - 6, headerH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 18px ${font.system}`;
  ctx.textAlign = 'left';
  const textW = ctx.measureText(label).width;
  const tx = (DISPLAY_W - textW) / 2;
  const ty = 3 + (headerH + 16) / 2;
  const iconY = 3 + (headerH - 16) / 2;
  const drawIcon = iconType === 'discount' ? drawDiscountIcon : drawFlashIcon;
  drawIcon(ctx, tx - 28, iconY);
  ctx.fillText(label, tx, ty);
  drawIcon(ctx, tx + textW + 8, iconY);
}

function drawCampaignProductName(ctx, data, y = 49) {
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.font = `bold 13px ${font.system}`;
  const lines = wrapText(ctx, data.name || 'Urun Secilmedi', DISPLAY_W - 20, 2);
  lines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, 10, y + index * 14);
  });
}

function drawCampaignLabel(ctx, data) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
  drawFrame(ctx);
  drawCampaignHeader(ctx, 'FIRSAT', 'flash');
  drawCampaignProductName(ctx, data, 49);

  const boxX = 2;
  const boxW = DISPLAY_W - 4;
  const boxH = 58;
  const boxY = DISPLAY_H - boxH - 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = '#ffffff';

  if (data.placeholderMode) {
    ctx.textAlign = 'center';
    ctx.font = `bold 36px ${font.system}`;
    ctx.fillText('₺--,-- TL', boxX + boxW / 2, boxY + 39);
  } else {
    const { major, minor } = splitPrice(data.salePrice);
    const minorText = `,${minor}`;
    ctx.textAlign = 'left';
    ctx.font = `bold 42px ${font.system}`;
    const majorW = ctx.measureText(major).width;
    ctx.font = `bold 31px ${font.system}`;
    const minorW = ctx.measureText(minorText).width;
    ctx.font = `bold 18px ${font.system}`;
    const tlW = ctx.measureText('TL').width;
    const totalW = majorW + 4 + minorW + 4 + tlW;
    const startX = boxX + (boxW - totalW) / 2;
    const baseY = boxY + (boxH + 36) / 2 - 1;
    ctx.font = `bold 42px ${font.system}`;
    ctx.fillText(major, startX, baseY);
    const rightX = startX + majorW + 4;
    ctx.font = `bold 31px ${font.system}`;
    ctx.fillText(minorText, rightX, baseY);
    ctx.font = `bold 18px ${font.system}`;
    ctx.fillText('TL', rightX + minorW + 4, baseY);
  }

  ctx.font = `8px ${font.system}`;
  ctx.textAlign = 'left';
  ctx.fillText('KDV Dahil', boxX + 5, boxY + boxH - 10);
  ctx.textAlign = 'right';
  ctx.fillText(data.placeholderMode ? 'FDT: -' : data.fdt, boxX + boxW - 5, boxY + 9);
}

function drawDiscountLabel(ctx, data) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
  drawFrame(ctx);
  drawCampaignHeader(ctx, 'indirim', 'discount');
  drawCampaignProductName(ctx, data, 50);

  const boxX = 2;
  const boxW = DISPLAY_W - 4;
  const boxH = 60;
  const boxY = DISPLAY_H - boxH - 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = '#ffffff';

  if (!data.placeholderMode) {
    drawSmallPriceCentered(ctx, data.hasDiscountPrice ? data.previousSalePrice : data.salePrice, boxX + 8, 82, boxY + 37);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(boxX + 8, boxY + 32);
    ctx.lineTo(boxX + 86, boxY + 24);
    ctx.moveTo(boxX + 8, boxY + 33);
    ctx.lineTo(boxX + 86, boxY + 25);
    ctx.stroke();
  }

  if (data.placeholderMode) {
    ctx.textAlign = 'center';
    ctx.font = `bold 36px ${font.system}`;
    ctx.fillText('₺--,-- TL', boxX + boxW / 2, boxY + 42);
  } else {
    const { major, minor } = splitPrice(data.salePrice);
    const minorText = `,${minor}`;
    const newPriceX = boxX + 110;
    const newPriceW = boxW - 116;
    ctx.textAlign = 'left';
    ctx.font = `bold 41px ${font.system}`;
    const majorW = ctx.measureText(major).width;
    ctx.font = `bold 21px ${font.system}`;
    const minorW = ctx.measureText(minorText).width;
    ctx.font = `bold 13px ${font.system}`;
    const tlW = ctx.measureText('TL').width;
    const totalW = majorW + 4 + minorW + 4 + tlW;
    const startX = newPriceX + Math.max(0, (newPriceW - totalW) / 2);
    const baseY = boxY + 47;
    ctx.font = `bold 41px ${font.system}`;
    ctx.fillText(major, startX, baseY);
    const rightX = startX + majorW + 4;
    ctx.font = `bold 21px ${font.system}`;
    ctx.fillText(minorText, rightX, baseY);
    ctx.font = `bold 13px ${font.system}`;
    ctx.fillText('TL', rightX + minorW + 4, baseY);
  }

  ctx.font = `8px ${font.system}`;
  ctx.textAlign = 'left';
  ctx.fillText('KDV Dahil', boxX + 8, boxY + boxH - 7);
  ctx.textAlign = 'right';
  ctx.fillText(data.placeholderMode ? 'FDT: -' : data.fdt, boxX + boxW - 5, boxY + 9);
}

function drawClearedLabel(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
}

export default function ESLPreview({ product, template = 'standard' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = DISPLAY_W * RENDER_SCALE;
    canvas.height = DISPLAY_H * RENDER_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);

    const data = resolveProduct(product);
    const effectiveTemplate = template === 'campaign' || template === 'discount' ? template : 'standard';

    if (data.clearMode) {
      drawClearedLabel(ctx);
    } else if (effectiveTemplate === 'campaign') {
      drawCampaignLabel(ctx, data);
    } else if (effectiveTemplate === 'discount') {
      drawDiscountLabel(ctx, data);
    } else {
      drawStandardLabel(ctx, data);
    }
  }, [product, template]);

  const effectiveTemplate = template === 'campaign' || template === 'discount' ? template : 'standard';

  return (
    <div className="esl-preview-wrapper">
      <div className="esl-preview-device">
        <div className="esl-preview-bezel">
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: 'auto',
              aspectRatio: `${DISPLAY_W} / ${DISPLAY_H}`,
              display: 'block',
            }}
          />
        </div>
        <div className="esl-preview-model-label">ESP32 Lite - 2.9&quot; E-Paper - 296x128</div>
      </div>
      <div className="esl-preview-template-badge">
        {TEMPLATES[effectiveTemplate] || TEMPLATES.standard}
      </div>
    </div>
  );
}
