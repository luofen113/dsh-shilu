/**
 * 读《实录凡例》—— 体例真源（散文 + 内嵌 YAML 块）。
 *
 * 约定：凡例是**人机两读**的一份文件，机器只取其中 ```yaml 围栏块，按序合并成一棵树。
 * 解析失败**不抛**，只回 { ok:false, error } —— 由调用方决定「单元不启用 + 告警」，
 * **绝不阻 dsh web 启动**（这是 B 路最要紧的一条安全阀）。
 *
 * @module dsh-shilu/rule
 */
import fs from 'node:fs';
import YAML from 'yaml';

/** 凡例之路径（可用环境变量 SHILU_RULE 覆盖，便于自验）。 */
export const RULE_PATH = process.env.SHILU_RULE ?? 'F:\\AI\\DSH\\实录凡例.md';

/**
 * 取出文本里全部 ```yaml 围栏块，并记其起始行号。
 * @param text - 文件全文。
 * @returns [{ src, line }]，line 为该块内容首行之行号（1 起）。
 */
export function extractYamlBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = lines[i].trim();
    if (start < 0) {
      if (fence === '```yaml' || fence === '```yml') start = i + 1;
      continue;
    }
    if (fence === '```') {
      blocks.push({ src: lines.slice(start, i).join('\n'), line: start + 1 });
      start = -1;
    }
  }
  return blocks;
}

/**
 * 读并解析凡例。
 * @param file - 凡例路径。
 * @returns {{ ok: true, data: object, path: string }} 或 {{ ok: false, error: string }}。
 */
export function loadRule(file = RULE_PATH) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, error: `读不到凡例 ${file}：${e.message}` };
  }
  const blocks = extractYamlBlocks(text);
  if (blocks.length === 0) return { ok: false, error: `${file} 里没有 \`\`\`yaml 围栏块` };
  const data = {};
  for (const [i, block] of blocks.entries()) {
    let doc;
    try {
      doc = YAML.parse(block.src);
    } catch (e) {
      const rel = e?.linePos?.[0]?.line ?? 0;
      const at = rel > 0 ? block.line + rel - 1 : block.line;
      return { ok: false, error: `${file}:${at} 第 ${i + 1} 个 YAML 块解析失败 —— ${String(e.message).split('\n')[0]}` };
    }
    if (doc && typeof doc === 'object') Object.assign(data, doc);
  }
  return { ok: true, data, path: file };
}

/** 凡例之外壳（取用时的兜底默认值，免得凡例缺节即崩）。 */
export const FALLBACK = {
  calendar: { era_name: '景和', gregorian: 2026 },
  handnote: {
    append_only: true,
    path: process.env.SHILU_CHRONICLE ?? 'F:\\AI\\DSH\\DSH实录.md',
    section_anchor: '## 卷三 · 共用手记',
  },
  materials: { grain: 'day_multi_session' },
};
