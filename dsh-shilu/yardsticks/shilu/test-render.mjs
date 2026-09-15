/**
 * 验「工具定义之 render 契约」—— 2026-09-15 线上真 bug 之复验。
 *
 * 病：`defineTool` 读的是 **`options.output.render`**；把 render 写在顶层 → `userRender is not a function`
 *     （首次实调 `shilu_materials` 即报此错，工具已注册、渲染失败）。
 * 本方：载入**部署副本**之 index.js，以桩 ctx 收其工具定义，断言 render 在 output 之内、可渲染出文本。
 */
import os from 'node:os';
import path from 'node:path';

const DEPLOY = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-shilu', 'lib', 'index.js');
const url = `file:///${DEPLOY.replace(/\\/g, '/')}`;

let pass = 0;
let fail = 0;
const ok = (c, label, extra = '') => { if (c) { pass += 1; console.log(`  ✅ ${label}${extra ? ' —— ' + extra : ''}`); } else { fail += 1; console.log(`  ❌ ${label}${extra ? ' —— ' + extra : ''}`); } };

const mod = await import(url);
const defs = [];
mod.apply({ tools: { register: (d) => defs.push(d) } });

console.log('【render 契约】部署副本：' + DEPLOY.replace(os.homedir(), '~'));
ok(defs.length === 2, '注册恰两件工具', `实际 ${defs.length}：${defs.map((d) => d.name).join(', ')}`);
for (const d of defs) {
  ok(typeof d.output?.render === 'function', `${d.name}：output.render 是函数`);
  ok(d.output?.schema !== undefined, `${d.name}：output.schema 在`);
  let text = '';
  try {
    const sample = d.name === 'shilu_materials'
      ? { date: '2026-09-15', ganzhi: '壬辰', sessions: 1, events: 2, toolCalls: 3, failures: 0, chars: 4, truncated: false, text: '样本文本' }
      : { ok: true, path: 'F:\\x.md', no: 14, bytes: 9, dryRun: true, block: '### 第十四札' };
    const rendered = d.output.render({}, sample);
    text = Array.isArray(rendered) ? rendered.map((p) => p?.text ?? '').join('') : String(rendered);
  } catch (e) { text = `渲染抛异常：${e.message}`; }
  ok(text.length > 0 && !text.startsWith('渲染抛异常'), `${d.name}：render 真能出文本`, text.slice(0, 40).replace(/\n/g, '⏎'));
}
ok(typeof mod.apply === 'function' && mod.name === 'shilu', 'plugin 之 name/apply 俱在', `name=${mod.name}`);
console.log('');
console.log(`【总】✅ ${pass} 项 · ❌ ${fail} 项`);
process.exit(fail ? 1 : 0);
