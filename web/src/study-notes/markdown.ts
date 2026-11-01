import { visibleText } from '../snapshot-export/layout';
import { noteKinds, type NotesPackage } from './types';
export interface SnapshotAsset {
  entryId: string;
  image: string;
  state: string;
}
export const noteLanguage = (value: 'c' | 'cpp' | null) =>
  value === 'cpp' ? 'C++' : value === 'c' ? 'C' : '语言未确认';
/** User text stays text, including HTML and Markdown links. Code is fenced separately. */
export function markdownText(value: string): string {
  return visibleText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()!#|+\-=]/g, '\\$&');
}
export function fencedCode(source: string, language: 'c' | 'cpp' | 'json' | 'text' = 'text') {
  const ticks = '`'.repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}${language}\n${source}${source.endsWith('\n') ? '' : '\n'}${ticks}\n`;
}
export function noteTitle(value: string) {
  const cleaned = Array.from(value, (character) => {
    const point = character.codePointAt(0)!;
    return point < 32 ||
      (point >= 127 && point <= 159) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
      ? ' '
      : character;
  })
    .join('')
    .trim();
  const title = Array.from(cleaned).slice(0, 80).join('');
  if (!title) throw Error('TITLE_EMPTY');
  return title;
}
export function safeNoteFilename(title: string, at: string, id: string) {
  let stem = Array.from(noteTitle(title))
    .slice(0, 64)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '');
  if (!stem) stem = '笔记';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) || !/^[a-f0-9-]{36}$/i.test(id))
    throw Error('FILENAME_ID');
  return `学习笔记-${stem}-${at.replace(/[-:.]/g, '')}-${id}.zip`;
}
export function notesMarkdown(
  pack: NotesPackage,
  title: string,
  at: string,
  assets: readonly SnapshotAsset[],
): string {
  const ref = (r: { id: string; version: string } | null) =>
    r ? `${r.id}@${r.version}` : '无精确引用';
  const lines = [
    `# ${markdownText(title)}`,
    '',
    `导出时间：${at}；预览时间：${pack.createdAt}；档案时区：${markdownText(pack.timeZone)}。`,
    '',
    `本笔记仅包含显式选择的 ${pack.entries.length} 条内容，不代表全部学习记录。`,
    '',
    `范围：章节 ${markdownText(pack.filter.chapterId || '全部章节')}；日期 ${pack.filter.from || '不限'} 至 ${pack.filter.to || '不限'}；类型 ${pack.filter.types.map((t) => noteKinds[t]).join('、')}。`,
    '',
    '快照是捕获时刻的完整状态副本；教学虚拟地址不是宿主真实地址。当前教材示例不是历史作答；未保存的作答源码不会在此补造。',
    '',
    '本地图片与状态文件随压缩包提供。请完整解压，再用普通 Markdown 阅读器打开“笔记.md”。PNG也携带完整状态数据，分享前请核对。',
    '',
  ];
  for (const [i, entry] of pack.entries.entries()) {
    lines.push(
      `## ${i + 1}. ${markdownText(entry.title)}`,
      '',
      `${noteKinds[entry.kind]} · ${entry.date} · ${noteLanguage(entry.language)}`,
      '',
      `原时间：${entry.occurredAt}；时间语义：${{ event: '真实记录发生时间', 'legacy-summary': '旧聚合摘要最近时间', capture: '捕获时间', 'related-record': '关联记录日期' }[entry.timeMeaning]}。`,
      '',
      markdownText(entry.text),
      '',
      ...entry.warnings.flatMap((w) => [`提示：${markdownText(w)}`, '']),
      `原包：${markdownText(ref(entry.origin.packageRef))}；原内容：${markdownText(ref(entry.origin.subjectRef))}；学习修订：${entry.origin.learningRevision ?? '不适用'}。`,
      '',
    );
    if (entry.currentRef)
      lines.push(`已核对的当前内容：${markdownText(ref(entry.currentRef))}。`, '');
    if (entry.href) lines.push(`平台内来源路径（需在平台中打开）：${markdownText(entry.href)}`, '');
    const r = entry.reference;
    if (r) {
      lines.push(
        `当前教材：${markdownText(r.document)}；位置：${markdownText(r.locator)}。`,
        '',
        `教材包：${markdownText(ref(r.packageRef))}；教材内容：${markdownText(ref(r.subjectRef))}；注册表：${markdownText(ref(r.registryRef))}；内容摘要：${r.contentSha256 ?? '未提供'}。`,
        '',
      );
      if (r.programRef) lines.push(`教材程序：${markdownText(ref(r.programRef))}。`, '');
      if (r.source !== null)
        lines.push(
          `### 当前教材示例 · ${noteLanguage(entry.language)}（非历史作答）`,
          '',
          fencedCode(r.source, entry.language ?? 'text'),
        );
    }
    const s = entry.snapshot;
    if (s) {
      const asset = assets.find((a) => a.entryId === entry.id);
      if (!asset) throw Error('SNAPSHOT_ASSET');
      lines.push(
        `### 捕获快照 · ${noteLanguage(entry.language)}`,
        '',
        `步骤：${s.position.cursor}/${s.position.length}；执行位置：${markdownText(s.position.executed.description)}；高亮原因：${markdownText(s.position.highlighted.reason)}。`,
        '',
        `捕获时间：${s.capturedAt}；快照标识：${s.snapshotId}；源码版本：${markdownText(String(s.source.sourceRevision))}；源码SHA-256：${s.source.sha256}。`,
        '',
        `定义版本：${markdownText(JSON.stringify(s.origin.definitionVersion))}`,
        '',
        '运行语言、引擎及协议：',
        '',
        fencedCode(JSON.stringify(s.runtime, null, 2), 'json'),
        '实际输入：',
        '',
        fencedCode(JSON.stringify(s.input, null, 2), 'json'),
        '截至当前游标的输出：',
        '',
        fencedCode(s.currentState.output, 'text'),
        '### 捕获源码',
        '',
        fencedCode(s.source.text, entry.language ?? 'text'),
        `![捕获时刻的完整状态图片](${asset.image})`,
        '',
        `[完整状态与映射（JSON）](${asset.state})`,
        '',
        '状态文件保留完整当前对象、调用栈、源码映射、游标和实际终止信息；没有整条轨迹。',
        '',
      );
    }
  }
  return lines.join('\n') + '\n';
}
