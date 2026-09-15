/**
 * dsh-shilu 自验（四项）—— 测**部署副本**（profile\node_modules\dsh-shilu），非工作区源码。
 *
 * 用法（PowerShell）：
 *   node test-shilu.mjs            四项全跑
 *   SHILU_RULE=<坏凡例> node test-shilu.mjs broken   只跑「故障态」（须另开进程，因 RULE_PATH 于导入时定）
 *
 * 尺子性质：本文件只**调用**插件，不复制其逻辑 —— 验的是部署那一份。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEPLOY = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-shilu', 'lib');
const CHRONICLE = 'F:\\AI\\DSH\\DSH实录.md';
const asUrl = (p) => `file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}`;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}${extra ? ' —— ' + extra : ''}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? ' —— ' + extra : ''}`); }
};

const mode = process.argv[2] ?? 'all';

// ── 乙、故障态：坏凡例 → 单元不启用 + 告警（不抛） ──
if (mode === 'broken') {
  console.log('【乙】凡例故障态（SHILU_RULE 指向坏凡例）');
  console.log('  坏凡例 = ' + process.env.SHILU_RULE);
  const mod = await import(asUrl(path.join(DEPLOY, 'index.js')));
  ok(typeof mod.apply === 'function', '模块可导入（apply 在）');
  let threw = null;
  const registered = [];
  const ctx = { tools: { register: (t) => registered.push(t?.name ?? '?') } };
  try { mod.apply(ctx); } catch (e) { threw = e; }
  ok(threw === null, 'apply 未抛异常（dsh web 不会因此拒启）', threw ? String(threw.message).slice(0, 80) : '');
  ok(registered.length === 0, '未注册任何工具（单元不启用）', `注册数=${registered.length}`);
  process.exit(fail ? 1 : 0);
}

// ── 甲、凡例正常读 ──
console.log('【甲】凡例读取与解析');
const rule = await import(asUrl(path.join(DEPLOY, 'rule.js')));
const r = rule.loadRule();
ok(r.ok === true, 'loadRule 成功', r.ok ? r.path : r.error);
if (r.ok) {
  for (const key of ['calendar', 'record_policy', 'event_schema', 'materials', 'handnote', 'verification']) {
    ok(key in r.data, `凡例含 ${key} 一节`);
  }
  ok(r.data?.calendar?.day_formula === '(jdn + 49) % 60', '干支公式如凡例所载', String(r.data?.calendar?.day_formula));
  ok(Array.isArray(r.data?.calendar?.check_vectors) && r.data.calendar.check_vectors.length === 6, '六条自检向量俱在');
  ok(r.data?.handnote?.append_only === true, '卷三为「只增不改」');
}
// 坏凡例之「行号」——用副本模拟，验报错含行号
const badPath = path.join(os.tmpdir(), 'shilu-bad-rule.md');
fs.writeFileSync(badPath, '# 试\n\n```yaml\ncalendar:\n  era_name: 景和\n   bad_indent: [1, 2\n```\n', 'utf8');
const rb = rule.loadRule(badPath);
ok(rb.ok === false, '坏凡例被判失败', rb.ok ? '竟通过了' : rb.error);
ok(/:\d+/.test(rb.error ?? ''), '报错写明行号', (rb.error ?? '').slice(0, 90));

// ── 丙、素材对账 ──
console.log('【丙】素材生成与会话事实对账');
const mat = await import(asUrl(path.join(DEPLOY, 'materials.js')));
ok(mat.ganzhiOf('2026-09-14') === '辛卯', '干支 9-14 = 辛卯（与实录所系相符）', mat.ganzhiOf('2026-09-14'));
ok(mat.ganzhiOf('2026-09-15') === '壬辰', '干支 9-15 = 壬辰');
const m14 = mat.buildMaterials('2026-09-14');
ok(m14.sessions >= 2, `9-14 会话数 ≥ 2（一日多会话）`, `实际 ${m14.sessions}`);
ok(m14.events >= 100, '9-14 事件数 ≥ 100', `${m14.events}`);
ok(m14.toolCalls >= 10, '9-14 工具调用 ≥ 10', `${m14.toolCalls}`);
ok(m14.text.includes('主上：'), '摘要含「主上」之言');
ok(/session|会话/.test(m14.text), '摘要含会话节');
ok(m14.chars > 500, '摘要非空且成形', `${m14.chars} 字`);
const m15 = mat.buildMaterials('2026-09-15');
ok(m15.sessions >= 1, '9-15（今日）有会话', `会话 ${m15.sessions} · 事件 ${m15.events}`);
const empty = mat.buildMaterials('1999-01-01');
ok(empty.sessions === 0, '无会话之日 ⇒ 0 条（不虚报）');

// ── 丁、卷三试写（副本）+ 真本纹丝不动 ──
console.log('【丁】卷三试写（副本）与真本保全');
const hn = await import(asUrl(path.join(DEPLOY, 'handnote.js')));
ok(hn.hanzi(1) === '一' && hn.hanzi(12) === '十二' && hn.hanzi(21) === '二十一' && hn.hanzi(30) === '三十', '汉字序数 1/12/21/30', `${hn.hanzi(1)}/${hn.hanzi(12)}/${hn.hanzi(21)}/${hn.hanzi(30)}`);
const realHashBefore = sha(CHRONICLE);
const realBytesBefore = fs.statSync(CHRONICLE).size;
const copy = path.join(os.tmpdir(), `shilu-test-实录-${Date.now()}.md`);
fs.copyFileSync(CHRONICLE, copy);
const dry = hn.appendHandnote({ to: '初初', subject: '自验之札', body: '此札只在副本上试写，不入真本。', evidence: ['副本试写'], date: '景元元年九月十五日 自验', dryRun: true, path: copy });
ok(dry.ok === true, 'dryRun 出札', `第 ${dry.no} 札`);
ok(/^### 第.+札 · 小鲸致初初：自验之札/.test(dry.block), '札之标题格式如式', dry.block.split('\n')[0]);
ok(/\*\*.+ · 小鲸书\*\*/.test(dry.block), '署名行如式', dry.block.split('\n')[2]);
const beforeCopy = fs.statSync(copy).size;
const real = hn.appendHandnote({ to: '初初', subject: '自验之札', body: '此札只在副本上试写，不入真本。', evidence: ['副本试写'], date: '景元元年九月十五日 自验', dryRun: false, path: copy });
ok(real.ok === true && real.dryRun === false, '副本写入成功', `+${real.bytes} 字节`);
const copyText = fs.readFileSync(copy, 'utf8');
ok(fs.statSync(copy).size > beforeCopy, '副本确已变长');
ok(copyText.includes('自验之札'), '副本里找得到新札');
const copyLines = copyText.split('\n');
const noteAt = copyLines.findIndex((l) => l.startsWith('### 第') && l.includes('自验之札'));
const shiluAt = copyLines.findIndex((l) => l.startsWith('## 附录'));
ok(noteAt > 0 && noteAt < shiluAt, '新札落在卷三之内、附录之前', `札@${noteAt + 1} < 附录@${shiluAt + 1}`);
ok((copyText.match(/### 第.+札/g) ?? []).length === (fs.readFileSync(CHRONICLE, 'utf8').match(/### 第.+札/g) ?? []).length + 1, '札数恰增一');
ok(sha(CHRONICLE) === realHashBefore && fs.statSync(CHRONICLE).size === realBytesBefore, '**真本一字未动**（哈希与字节数皆同）', `${realHashBefore} / ${realBytesBefore}`);
fs.unlinkSync(copy);
fs.unlinkSync(badPath);

console.log('');
console.log(`【总】✅ ${pass} 项 · ❌ ${fail} 项`);
process.exit(fail ? 1 : 0);
