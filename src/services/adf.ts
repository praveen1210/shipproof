import type { AdfNode } from './acParser';

/**
 * Small Markdown → ADF converter for comments and bug descriptions. Supports headings, bullet and
 * numbered lists, tables, code fences, **bold**, `code` and links: what ShipProof and the agent write.
 */
export function markdownToAdf(md: string): AdfNode {
  const lines = md.replace(/\r/g, '').split('\n');
  const content: AdfNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      content.push({
        type: 'codeBlock',
        attrs: fence[1] ? { language: fence[1] } : {},
        content: code.length ? [{ type: 'text', text: code.join('\n') }] : [],
      });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: inline(h[2]) });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      content.push({
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: rows.map((cells, r) => ({
          type: 'tableRow',
          content: cells.map((c) => ({
            type: r === 0 ? 'tableHeader' : 'tableCell',
            attrs: {},
            content: [{ type: 'paragraph', content: inline(c) }],
          })),
        })),
      });
      continue;
    }
    const listMatch = line.match(/^\s*([-*]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: AdfNode[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(m[2]) }] });
        i++;
      }
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++]);
    const nodes: AdfNode[] = [];
    para.forEach((p, idx) => {
      if (idx > 0) nodes.push({ type: 'hardBreak' });
      nodes.push(...inline(p));
    });
    content.push({ type: 'paragraph', content: nodes });
  }
  return { type: 'doc', content };
}

/** Jira expects `{ version: 1, type: 'doc', content }` at the top level. */
export function adfDoc(md: string): Record<string, unknown> {
  const doc = markdownToAdf(md);
  return { version: 1, type: 'doc', content: doc.content ?? [] };
}

export function inline(text: string): AdfNode[] {
  const out: AdfNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ type: 'text', text: tok.slice(2, -2), marks: [{ type: 'strong' }] } as AdfNode);
    else if (tok.startsWith('`')) out.push({ type: 'text', text: tok.slice(1, -1), marks: [{ type: 'code' }] } as AdfNode);
    else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push({ type: 'text', text: lm[1], marks: [{ type: 'link', attrs: { href: lm[2] } }] } as AdfNode);
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => n.text !== '');
}
