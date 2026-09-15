/**
 * dsh-shilu —— 实录素材官（宿主半侧）。
 *
 * 注册两个工具：
 *   shilu_materials({date})                           当日素材摘要（一日 · 多会话）
 *   handnote_write({to,subject,body,author,evidence}) 《DSH实录》卷三追加一札 —— **署名为必填**
 *
 * 安全阀（B 路最要紧的一条）：**凡例读不到或 YAML 解析失败 → 本单元不启用 + 告警写明行号**，
 * 绝不阻 `dsh web` 启动。
 *
 * 红线：不产日稿文件 · 不写实录正文 · 不监听 session/event · 不注册投影 · 不代归类。
 *
 * @module dsh-shilu
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { loadRule, RULE_PATH, FALLBACK } from './rule.js';
import { buildMaterials, ganzhiOf } from './materials.js';
import { appendHandnote } from './handnote.js';

export const name = 'shilu';
export const inject = ['tools'];

/** 告警 —— 落 stderr，且尽量让人在启动日志里一眼看见。 */
function warn(msg) {
  process.stderr.write(`[dsh-shilu] ${msg}\n`);
}

/** 探针落盘之处（诊断用，非正事；可径删）。 */
export const PROBE_PATH = path.join(os.homedir(), '.dsh', 'shilu-author-probe.json');

/**
 * 探 `exec` 之真形，成一纸诊断。
 *
 * **v4 精简（2026-09-15 巳时末 · 案子结后收束）**：详细诊断**只落探针文件**，
 * 随工具结果**只回一行摘要** —— 旧版每次落札回传六十余行 JSON（约八百 token），
 * 而病已查明，无须逐次铺陈。
 *
 * 立此之由（2026-09-15，初初报、初初修）：
 *   一报：初初 `dryRun` 实调，署出「**小鲸致小鲸**」—— 旧三路皆空落默认，而**默认值恰是小鲸**，故小鲸自测不可见。
 *   二报：补 `session.header.agentPreset` 一路后**仍署小鲸**，重启确已换代（3904 → 22212）—— 可见非装载之误。
 *   三报：改「失败才写探针」后，真调用**竟未写探针**（写着的是尺子喂 `{}` 那回）—— 可见**探到了非空值**。
 *   四报（定案）：无条件回传 `exec` 真形，一次调用即见 —— 会话头 `agentPreset` = **`whale`**，
 *         而该会话实为 `chuchu` ⇒ **会话头只是「创建时」之快照，非活值**（`settings.yaml` 之
 *         `agent-presets: default: whale` 即其源）。
 *
 * **探针绝不坏正事**：一切包在 try 里，失败即弃。
 *
 * @param exec - 工具执行上下文。
 * @returns 一行摘要（详细在 {@link PROBE_PATH}）。
 */
function diagnoseExec(exec) {
  try {
    const agent = exec?.agent;
    const session = agent?.session;
    const snap = {
      at: new Date().toISOString(),
      execIsUndefined: exec === undefined,
      execKeys: Object.keys(exec ?? {}),
      agentType: typeof agent,
      agentCtor: agent?.constructor?.name ?? null,
      agentKeys: Object.keys(agent ?? {}),
      agentHasSession: agent ? 'session' in agent : null,
      sessionCtor: session?.constructor?.name ?? null,
      sessionKeys: session ? Object.keys(session) : null,
      sessionHasHeader: session ? 'header' in session : null,
      sessionHeaderKeys: session?.header ? Object.keys(session.header) : null,
      p1_session_header_agentPreset: exec?.agent?.session?.header?.agentPreset ?? null,
      p2_agent_agentPreset: exec?.agent?.agentPreset ?? null,
      p3_agent_preset: exec?.agent?.preset ?? null,
      p4_agent_session_agentPreset: exec?.agent?.session?.agentPreset ?? null,
      p5_exec_session_agentPreset: exec?.session?.agentPreset ?? null,
      p6_exec_session_header_agentPreset: exec?.session?.header?.agentPreset ?? null,
    };
    try {
      fs.writeFileSync(PROBE_PATH, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
    } catch {
      // 写不了就算了；摘要仍随结果回传。
    }
    const others = [
      snap.p2_agent_agentPreset,
      snap.p3_agent_preset,
      snap.p4_agent_session_agentPreset,
      snap.p5_exec_session_agentPreset,
      snap.p6_exec_session_header_agentPreset,
    ].filter((v) => v != null);
    return `agent=${snap.agentCtor ?? snap.agentType} · session.header=${String(snap.sessionHasHeader)} · ` +
      `header.agentPreset=${snap.p1_session_header_agentPreset ?? 'null'} · ` +
      `其余候选路=${others.length > 0 ? others.join(',') : '皆空'}`;
  } catch (error) {
    return `诊断失败：${String(error?.message ?? error)}`;
  }
}

/**
 * 取调用者之名（卷三署谁）—— 从执行上下文里尽力探。
 *
 * **署名之正路是调用者自报**（工具参数 `author`，必填）；本函数只作**兜底与对账**。
 * 路径之序（由可信到兜底）：
 *   1. `exec.agent.session.header.agentPreset`（**注意：此为「会话创建时」之快照，非活值**）
 *   2. `exec.agent.agentPreset` / `exec.agent.preset`
 *   3. `exec.agent.session.agentPreset` / `exec.session.agentPreset` / `exec.session.header.agentPreset`
 *   4. 皆空则落默认 `'小鲸'`
 *
 * @param exec - 工具执行上下文。
 * @returns '小鲸' | '初初' | 预设名。
 */
export function authorOf(exec) {
  const preset = exec?.agent?.session?.header?.agentPreset
    ?? exec?.agent?.agentPreset
    ?? exec?.agent?.preset
    ?? exec?.agent?.session?.agentPreset
    ?? exec?.session?.agentPreset
    ?? exec?.session?.header?.agentPreset;
  if (preset === 'chuchu') return '初初';
  if (preset === 'whale') return '小鲸';
  if (typeof preset === 'string' && preset) return preset;
  return '小鲸';
}

/**
 * 插件入口。
 * @param ctx - Cordis 上下文（已按 inject 取到 tools）。
 */
export function apply(ctx) {
  const rule = loadRule(RULE_PATH);
  if (!rule.ok) {
    warn(`凡例解析失败：${rule.error}`);
    warn('→ 本单元不启用（其余功能照常；dsh web 不受影响）。修好凡例后重启即可。');
    return;
  }
  const data = rule.data;
  const handnoteCfg = { ...FALLBACK.handnote, ...(data.handnote ?? {}) };
  warn(`凡例已读：${rule.path}（${Object.keys(data).join(' · ')}）`);

  ctx.tools.register(defineTool({
    name: 'shilu_materials',
    description: '取某一日的**素材摘要**：《DSH实录》是编年体，写「今天做了什么」时先调它。它摊平该日**全部会话**的事实（主上之命、工具调用、触及文件、报错、轮次结局），人可读且带计数。它**不归类**（诏令/章奏/决策之分由你作），也**不写实录**。省略 date 即取今日。',
    parameters: {
      date: { type: 'string', description: '本地日，YYYY-MM-DD；省略则取今日。' },
      maxChars: { type: 'integer', description: '摘要字数上限，默认 24000。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', required: true },
          ganzhi: { type: 'string', required: true },
          sessions: { type: 'integer', required: true },
          events: { type: 'integer', required: true },
          toolCalls: { type: 'integer', required: true },
          failures: { type: 'integer', required: true },
          chars: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args) {
      const date = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
        ? args.date
        : new Date().toISOString().slice(0, 10);
      return Promise.resolve(buildMaterials(date, { maxChars: args.maxChars }));
    },
    presentCall: (args) => ({ card: 'generic', title: `取实录素材 ${args.date ?? '今日'}`, kind: 'other', rawInput: args.date ?? '今日' }),
  }));

  ctx.tools.register(defineTool({
    name: 'handnote_write',
    description: '往《DSH实录》「卷三 · 共用手记」**追加**一札（只增不改，旧札一字不动）。用于二人通信、告假、备案；正文由你写，工具只管编号、格式与落笔。**署名必填**（`author:"初初"` 或 `"小鲸"`）—— 自报家门，不靠猜（自动探测只作兜底与对账）。动真本前可先 dryRun:true 看它将写入什么。',
    parameters: {
      to: { type: 'string', required: true, description: '收者：小鲸 / 初初。' },
      subject: { type: 'string', required: true, description: '题（一句话，写在标题冒号后）。' },
      body: { type: 'string', required: true, description: '正文（markdown；自称与语气照常）。**不要**再写「小鲸：」这类收者行，工具自会加上。' },
      author: { type: 'string', required: true, description: '署谁：初初 / 小鲸。**必填** —— 卷三之「谁致谁」以此为准。' },
      evidence: { type: 'array', items: { type: 'string' }, description: '可查之凭（路径、哈希、命令、行数），至少一条为宜。' },
      date: { type: 'string', description: '署日，如「景和元年九月十五日午时（2026-09-15 11:20）」；省略则取本机当下。' },
      dryRun: { type: 'boolean', description: 'true 则只回将写入之札，不落盘。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          reason: { type: 'string' },
          path: { type: 'string', required: true },
          no: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          dryRun: { type: 'boolean', required: true },
          block: { type: 'string', required: true },
          diagnostics: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `${value.dryRun ? '（试写，未落盘）' : '已写入'} 卷三第 ${value.no} 札 —— ${value.path}${value.dryRun ? '' : `（+${value.bytes} 字节）`}\n\n${value.block}\n\n---\n*exec 诊断（详在 \`~/.dsh/shilu-author-probe.json\`）：${value.diagnostics}*`
          : `未写入：${value.reason}`,
      }],
    },
    execute(args, exec) {
      const now = new Date();
      const date = typeof args.date === 'string' && args.date.trim()
        ? args.date.trim()
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（${ganzhiOf(now.toISOString().slice(0, 10))}）`;
      const selfNamed = typeof args.author === 'string' && args.author.trim() ? args.author.trim() : null;
      return Promise.resolve({
        ...appendHandnote({
          to: args.to,
          subject: args.subject,
          body: args.body,
          evidence: args.evidence,
          date,
          author: selfNamed ?? authorOf(exec),
          dryRun: args.dryRun === true,
          path: handnoteCfg.path,
          anchor: handnoteCfg.section_anchor,
        }),
        diagnostics: diagnoseExec(exec),
      });
    },
    presentCall: (args) => ({ card: 'generic', title: `卷三留札：${args.subject ?? ''}`, kind: 'other', rawInput: args.subject ?? '' }),
  }));
}
