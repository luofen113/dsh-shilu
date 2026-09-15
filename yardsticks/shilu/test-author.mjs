/**
 * dsh-shilu 尺子之四：`authorOf` 署名契约（**因线上真 bug 而立**）。
 *
 * 立尺之由（2026-09-15 初初报）：她以 `dryRun` 实调 `handnote_write`，署出「**小鲸致小鲸**」——
 * 旧探法三路（`agent.preset` / `agent.session.agentPreset` / `session.agentPreset`）本机皆空，
 * 遂落默认 `'小鲸'`，而**默认值恰是小鲸本人**，故小鲸自测永不可见。今补**会话头**一路。
 *
 * 测**部署副本**（`profile\node_modules\dsh-shilu\lib`），非工作区源码 —— 同 `test-shilu.mjs` 之尺路。
 *
 * 用法（PowerShell）：node test-author.mjs
 */
import os from 'node:os';
import path from 'node:path';

const DEPLOY = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-shilu', 'lib');
const asUrl = (p) => `file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}`;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}${extra ? ' —— ' + extra : ''}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? ' —— ' + extra : ''}`); }
};

console.log('【署名契约】authorOf 六路之探（测部署副本）');
const mod = await import(asUrl(path.join(DEPLOY, 'index.js')));
ok(typeof mod.authorOf === 'function', 'authorOf 已导出（尺子得直呼其名）');
const A = typeof mod.authorOf === 'function' ? mod.authorOf : () => null;

// ① 正路：会话头所载之预设
ok(A({ agent: { session: { header: { agentPreset: 'chuchu' } } } }) === '初初', '会话头 chuchu → 初初（本病之正路）');
ok(A({ agent: { session: { header: { agentPreset: 'whale' } } } }) === '小鲸', '会话头 whale → 小鲸');
// ② 旧三路（兼容，勿使旧部署失据）
ok(A({ agent: { preset: 'chuchu' } }) === '初初', '旧路 agent.preset 仍认');
ok(A({ agent: { session: { agentPreset: 'chuchu' } } }) === '初初', '旧路 agent.session.agentPreset 仍认');
ok(A({ session: { agentPreset: 'whale' } }) === '小鲸', '旧路 session.agentPreset 仍认');
// ③ 优先级：头 > 旧路
ok(A({ agent: { preset: 'whale', session: { header: { agentPreset: 'chuchu' } } } }) === '初初', '头优先于旧路（冲突以头为准）');
// ④ 陌生预设名原样返回
ok(A({ agent: { session: { header: { agentPreset: 'someother' } } } }) === 'someother', '陌生预设名原样返回');
// ⑤ 兜底仍在
ok(A({}) === '小鲸', '全空仍落默认小鲸（兜底未失）');
ok(A(undefined) === '小鲸', 'exec 为 undefined 不抛、落默认');

console.log('');
console.log(`【总】✅ ${pass} 项 · ❌ ${fail} 项`);
process.exit(fail ? 1 : 0);
