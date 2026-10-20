/**
 * 行动清单的「纸面版」：在画布上排版成 A4 竖版（1240×1754），再封装成单页 PDF。
 *
 * 小程序里没有浏览器的 window.print()，所以这里手写一个最小 PDF：
 * 把画布导出的 JPEG 作为整页图像嵌进 PDF（无需嵌入字体，中文由画布渲染，预览绝不空白）。
 * 纯函数，不依赖 wx API——画布上下文由调用方传入，便于在 Node 里自测。
 */

/**
 * @param ctx  Canvas 2D 上下文（画布尺寸须为 W×H）
 * @param d    {
 *   title, sub, stats:[{label,value}],
 *   groups:[{toolName, meta, locs:string[], issue, caveat}],
 *   hot:[{name, heat, pop}], emptyText, headline, footer
 * }
 * @param W,H  画布像素尺寸
 */
function drawPlanSheet(ctx, d, W, H) {
  const M = 70;               // 页边距
  const CW = W - M * 2;       // 内容宽度
  let y = 0;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 标题区
  ctx.fillStyle = '#173247';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(d.title, M, M);
  y = M + 58;
  ctx.fillStyle = '#7f9aa9';
  ctx.font = '17px sans-serif';
  ctx.fillText(d.sub, M, y);
  y += 34;
  ctx.strokeStyle = '#dbe8ef';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  y += 26;

  // 概要统计（三列两行）
  if (d.stats && d.stats.length) {
    const colW = CW / 3;
    d.stats.forEach(function (s, i) {
      const cx = M + (i % 3) * colW;
      const cy = y + Math.floor(i / 3) * 74;
      ctx.fillStyle = '#f4f9fc';
      ctx.fillRect(cx + 6, cy, colW - 16, 62);
      ctx.strokeStyle = '#dbe8ef';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 6, cy, colW - 16, 62);
      ctx.fillStyle = '#93a9b5';
      ctx.font = '14px sans-serif';
      ctx.fillText(s.label, cx + 20, cy + 10);
      ctx.fillStyle = '#b4550f';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(String(s.value), cx + 20, cy + 30);
    });
    y += Math.ceil(d.stats.length / 3) * 74 + 14;
  }

  // 结语一句话
  if (d.headline) {
    ctx.fillStyle = '#45606f';
    ctx.font = '16px sans-serif';
    ctx.fillText(d.headline, M, y);
    y += 30;
  }

  // 改造点位
  ctx.fillStyle = '#173247';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('改造点位', M, y);
  y += 36;
  if (!d.groups || !d.groups.length) {
    ctx.fillStyle = '#93a9b5';
    ctx.font = '16px sans-serif';
    ctx.fillText(d.emptyText || '还没有任何改造。', M, y);
    y += 34;
  } else {
    d.groups.forEach(function (g) {
      ctx.fillStyle = '#24445c';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(g.toolName, M, y);
      ctx.fillStyle = '#7f9aa9';
      ctx.font = '14px sans-serif';
      ctx.fillText(g.meta, M + 150, y + 3);
      y += 28;
      ctx.fillStyle = '#45606f';
      ctx.font = '15px sans-serif';
      y = wrapText(ctx, '点位：' + g.locs.join('、'), M + 14, y, CW - 14, 22) + 4;
      ctx.fillStyle = '#93a9b5';
      ctx.font = '13px sans-serif';
      y = wrapText(ctx, '作用：' + g.issue + '。注意：' + g.caveat, M + 14, y, CW - 14, 19) + 12;
    });
  }

  // 仍需重点关注
  ctx.fillStyle = '#173247';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('仍需重点关注的地点', M, y);
  y += 36;
  if (!d.hot || !d.hot.length) {
    ctx.fillStyle = '#93a9b5';
    ctx.font = '16px sans-serif';
    ctx.fillText('当前没有高暴露地块，注意维持养护与补水。', M, y);
    y += 34;
  } else {
    ctx.fillStyle = '#45606f';
    ctx.font = '16px sans-serif';
    d.hot.forEach(function (h) {
      ctx.fillText('• ' + h.name + '　热指数 ' + h.heat + '，户外约 ' + h.pop + ' 人', M + 8, y);
      y += 26;
    });
    y += 8;
  }

  // 页脚
  ctx.fillStyle = '#93a9b5';
  ctx.font = '12px sans-serif';
  wrapText(ctx, d.footer || '', M, H - M - 40, CW, 18);
}

/** 简单换行绘制（按字符宽度），返回下一行的 y。 */
function wrapText(ctx, text, x, y, maxW, lineH) {
  let line = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ctx.measureText(line + ch).width > maxW) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

/**
 * 把整页 JPEG 封装成单页 PDF（A4 竖版 595.28×841.89 pt，图像铺满整页）。
 * @param jpeg   Uint8Array（JPEG 字节）
 * @param pxW,pxH 图片像素尺寸
 * @returns Uint8Array（PDF 字节）
 */
function buildPdf(jpeg, pxW, pxH) {
  const chunks = [];
  let offset = 0;
  const addStr = function (s) {
    chunks.push({ s: s });
    offset += s.length;
  };
  const addRaw = function (b) {
    chunks.push({ b: b });
    offset += b.length;
  };
  const offsets = [0, 0, 0, 0, 0, 0];

  addStr('%PDF-1.4\n');
  offsets[1] = offset;
  addStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = offset;
  addStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = offset;
  addStr('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  offsets[4] = offset;
  addStr('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
  addRaw(jpeg);
  addStr('\nendstream\nendobj\n');
  const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q\n';
  offsets[5] = offset;
  addStr('5 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');

  const xrefPos = offset;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  addStr(xref);
  addStr('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].s ? chunks[i].s.length : chunks[i].b.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.s) {
      for (let k = 0; k < c.s.length; k++) out[o++] = c.s.charCodeAt(k) & 0xff;
    } else {
      out.set(c.b, o);
      o += c.b.length;
    }
  }
  return out;
}

module.exports = { drawPlanSheet: drawPlanSheet, buildPdf: buildPdf };
