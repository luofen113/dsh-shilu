/**
 * 口径对账尺 —— 插件代码里的常量 vs README 与《DSH实录》里写的数字。
 *
 * 缘起：2026-09-14 夜《建言书》之忧「凡例终究会与 md 漂移」。实测：dsh-chronicle 并未
 * 硬编码实录凡例（17 条模式全 0 命中），但它确有**自己的技术口径常量**（上限、条数、
 * 扫描字数、stateVersion），同一数字在**三处**有副本：代码 / README / 实录。
 * 眼下相符是「人勤」，不是「机制」；此尺即把那点人勤换成一跑即知。
 *
 * 用法（无参数即用本机默认路径）：
 *   node rule-drift-check.mjs
 *   node rule-drift-check.mjs <插件目录> <DSH实录.md 路径>
 *
 * 判定：凡 README「声称值」与「代码值」不符者标 ❌ —— 那便是漂移已生，须即刻同改两处。
 */
import fs from 'node:fs';

const srcDir = process.argv[2] || 'F:\\AI\\DSH\\大肥鱼\\06-插件补丁\\dsh-chronicle';
const shiluPath = process.argv[3] || 'F:\\AI\\DSH\\DSH实录.md';

const code = fs.readFileSync(`${srcDir}\\lib\\projections.js`, 'utf8');
const readme = fs.readFileSync(`${srcDir}\\README.md`, 'utf8');
const shilu = fs.readFileSync(shiluPath, 'utf8');

// ── 代码里真正当规则的常量 ──
const consts = {};
for (const m of code.matchAll(/const\s+(MAX_[A-Z_]+|RESULT_SCAN|stateVersion)\s*=\s*(\d+)/g)) {
  consts[m[1]] = Number(m[2]);
}
const svMatches = [...code.matchAll(/stateVersion:\s*(\d+)/g)].map((m) => Number(m[1]));
consts.stateVersion = svMatches.length ? Math.max(...svMatches) : null;

console.log('【代码常量】');
console.log(consts);
console.log('');

// ── README 里声称的数字 ──
const claims = [
  ['MAX_ENTITIES', 2000, /2000 实体/],
  ['MAX_EVIDENCE', 6, /× 6 证据/],
  ['MAX_TOPICS', 40, /40 专题/],
  ['MAX_LIST', 24, /× 24 列表项/],
  ['RESULT_SCAN', 4000, /前 4000 字/],
];
console.log('【README 声称 vs 代码】');
let drift = 0;
for (const [k, v, re] of claims) {
  const said = re.test(readme);
  const agree = said && consts[k] === v;
  if (said && !agree) drift += 1;
  console.log(
    `  ${k.padEnd(14)} 代码=${String(consts[k]).padEnd(5)} README 说=${said ? String(v).padEnd(5) : '未提   '} ${
      agree ? '✅ 一致' : said ? '❌ 不符' : '— 未提'
    }`,
  );
}
console.log('');

const readmeVer = [...readme.matchAll(/stateVersion[^\n]{0,40}?(\d+)/g)].map((m) => m[1]);
console.log(`【README 提到的 stateVersion 数字】${readmeVer.length ? readmeVer.join(', ') : '（未写死具体号 —— 明智）'}`);
console.log(`【代码里 stateVersion】${consts.stateVersion}`);
console.log('');

console.log('【《DSH实录》里的相关表述】');
const probes = [
  ['上限三百 / 300 上限', /上限\s*三?百|三百之限|上限 300/],
  ['上限 1200 / 2000', /1200|2000/],
  ['列表 24 条', /24 条|二十四条/],
  ['40 专题 / 最近四十条', /最近四十条|40 条|四十条/],
  ['4000 字', /4000 字|四千字/],
  ['stateVersion 2 → 5', /stateVersion[\s\S]{0,30}2\s*→\s*\*?\*?5/],
];
for (const [label, re] of probes) console.log(`  ${label.padEnd(22)} ${re.test(shilu) ? '实录有提' : '实录未提'}`);

console.log('');
console.log('【口径副本清点】');
console.log(`  代码（lib/projections.js）常量 ${Object.keys(consts).length} 个`);
console.log(`  README.md 折叠规则一节：${/### 折叠规则/.test(readme) ? '有' : '无'}`);
console.log(`  README.md 实现约束一节：${/实现约束/.test(readme) ? '有' : '无'}`);
console.log(`  实录卷三短札提及口径：${/档案投影升 v5|实体多|stateVersion/.test(shilu) ? '有' : '无'}`);

console.log('');
if (drift === 0) {
  console.log('✅ 口径未漂移：README 声称值逐条与代码相符。');
  process.exit(0);
} else {
  console.log(`❌ 口径已漂移 ${drift} 处 —— 即刻同改代码与 README（并视情改实录）。`);
  process.exit(1);
}
