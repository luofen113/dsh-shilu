/**
 * 验干支公式：(JDN + 49) mod 60，甲子 = 0。
 * 测试向量取《DSH实录》自身既有之日名（独立来源）。
 */
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

/** 儒略日数（Gregorian → JDN，取正午） */
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function ganzhi(y, m, d) {
  const n = (jdn(y, m, d) + 49) % 60;
  return { n, name: GAN[n % 10] + ZHI[n % 12] };
}

// 实录自身所系之日名（卷一卷二既有标题，非鱼自证）
const vectors = [
  ['2026-09-10', '丁亥', 23, '卷一 初十日'],
  ['2026-09-11', '戊子', 24, '卷一 十一日'],
  ['2026-09-12', '己丑', 25, '卷一 十二日'],
  ['2026-09-13', '庚寅', 26, '卷一／卷二 十三日'],
  ['2026-09-14', '辛卯', 27, '卷一／卷二 十四日'],
  ['2026-11-23', '辛丑', 37, '卷二 冬十一月二十三日'],
];

let bad = 0;
console.log('日期        算得    实录所系  序号  合  出处');
for (const [iso, said, saidN, from] of vectors) {
  const [y, m, d] = iso.split('-').map(Number);
  const g = ganzhi(y, m, d);
  const ok = g.name === said && g.n === saidN;
  if (!ok) bad += 1;
  console.log(`${iso}  ${g.name}    ${said}      ${String(g.n).padStart(2)}    ${ok ? '✅' : '❌'}  ${from}`);
}
console.log('');
console.log(`结论：${vectors.length - bad}/${vectors.length} 条吻合${bad ? ' —— 有误，公式不可用' : ' —— 公式可用'}`);
console.log('');
console.log('明日及近日：');
for (const iso of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
  const [y, m, d] = iso.split('-').map(Number);
  const g = ganzhi(y, m, d);
  console.log(`  ${iso} → ${g.name}（序号 ${g.n}）  JDN ${jdn(y, m, d)}`);
}
process.exit(bad ? 1 : 0);
