/**
 * Acceptance-criteria extraction (§6.6): the section under a line matching
 * /acceptance criteria|^ACs?\b/i until the next heading. Each bullet, numbered item or
 * Given/When/Then block is one AC. With no such section we fall back to the description and flag it.
 */

// Minimal ADF node shape: enough to walk Jira descriptions without pulling in ADF typings.
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

/** ADF → plain text lines. Headings become "# text", list items "- text". */
export function adfToText(doc: AdfNode | string | null | undefined): string {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  const lines: string[] = [];
  const inline = (n: AdfNode): string =>
    n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('');

  const walk = (n: AdfNode, listDepth: number, ordered: boolean, index: { i: number }) => {
    switch (n.type) {
      case 'heading':
        lines.push(`# ${inline(n).trim()}`);
        return;
      case 'paragraph':
        if (listDepth === 0) lines.push(...inline(n).split('\n'));
        else lines.push(`${'  '.repeat(listDepth - 1)}${ordered ? `${index.i}.` : '-'} ${inline(n).replace(/\n/g, ' ').trim()}`);
        return;
      case 'bulletList':
      case 'orderedList': {
        const idx = { i: 0 };
        for (const item of n.content ?? []) {
          idx.i++;
          for (const c of item.content ?? []) walk(c, listDepth + 1, n.type === 'orderedList', idx);
        }
        return;
      }
      case 'codeBlock':
        lines.push(...inline(n).split('\n'));
        return;
      case 'rule':
        lines.push('---');
        return;
      default:
        for (const c of n.content ?? []) walk(c, listDepth, ordered, index);
    }
  };
  walk(doc, 0, false, { i: 0 });
  return lines.join('\n');
}

export interface AcExtraction {
  acs: string[];
  source: 'section' | 'description' | 'none';
  /** Shown to the user/agent when we had to fall back. */
  warning?: string;
}

const AC_HEADING = /acceptance criteria|^\W*ACs?\b/i;
const BULLET = /^\s*(?:[-*•+]|\d+[.)]|\[[ x]\])\s+(.*)$/i;
const GHERKIN_START = /^\s*(Given|Scenario)\b/i;
const GHERKIN_CONT = /^\s*(When|Then|And|But)\b/i;

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s/.test(line) || /^h[1-6]\.\s/i.test(line.trim());
}

export function extractAcceptanceCriteria(description: AdfNode | string | null | undefined): AcExtraction {
  const text = adfToText(description);
  const lines = text.split('\n');
  const start = lines.findIndex((l) => AC_HEADING.test(l.replace(/^\s*(#{1,6}|h[1-6]\.)\s*/i, '').trim()));

  if (start >= 0) {
    const body: string[] = [];
    // text on the heading line after a colon counts, e.g. "AC: user can log in"
    const inlineRest = lines[start].split(/:\s*/).slice(1).join(': ').trim();
    if (inlineRest) body.push(inlineRest);
    for (const l of lines.slice(start + 1)) {
      if (isHeading(l)) break;
      body.push(l);
    }
    const acs = splitAcs(body);
    if (acs.length) return { acs, source: 'section' };
  }

  const fallback = splitAcs(lines.filter((l) => !isHeading(l)));
  if (fallback.length) {
    return {
      acs: fallback,
      source: 'description',
      warning: 'No "Acceptance criteria" section found: ACs were inferred from the whole description.',
    };
  }
  return { acs: [], source: 'none', warning: 'The issue has no description to extract acceptance criteria from.' };
}

export function splitAcs(lines: string[]): string[] {
  const acs: string[] = [];
  let gherkin: string[] | null = null;
  const flush = () => {
    if (gherkin && gherkin.length) acs.push(gherkin.join(' '));
    gherkin = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === '---') {
      flush();
      continue;
    }
    const bullet = line.match(BULLET);
    const content = (bullet ? bullet[1] : line).trim();
    if (GHERKIN_START.test(content)) {
      flush();
      gherkin = [content];
    } else if (GHERKIN_CONT.test(content) && gherkin) {
      gherkin.push(content);
    } else if (bullet) {
      flush();
      acs.push(content);
    } else if (gherkin) {
      gherkin.push(content);
    } else if (content.length > 15 && /[a-z]/i.test(content)) {
      // a plain sentence in the AC section is an AC on its own
      acs.push(content);
    }
  }
  flush();
  return acs.map((a) => a.replace(/\s+/g, ' ')).filter((a) => a.length > 2);
}

const STOP = new Set(
  'a an the and or but to of in on for with as at by is are be can should must will user users i my me we our it its this that when then given from into able so has have see sees'.split(
    ' ',
  ),
);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/@[a-z]+-\d+/g, ' ')
      .split(/[^a-z0-9]+/)
      .map((t) => t.replace(/(ing|ed|es|s)$/, ''))
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export interface AcCoverage {
  ac: string;
  coveredBy: string[];
  covered: boolean;
}

/**
 * Lexical first pass at AC → scenario coverage. Deliberately conservative: the agent reviews the
 * result and is told this is a heuristic, so it never claims coverage it can't explain.
 */
export function matchCoverage(acs: string[], scenarioNames: string[], threshold = 0.34): AcCoverage[] {
  const scen = scenarioNames.map((n) => ({ n, t: tokens(n) }));
  return acs.map((ac) => {
    const at = tokens(ac);
    const coveredBy = scen
      .filter(({ t }) => {
        if (!at.size || !t.size) return false;
        const shared = [...at].filter((x) => t.has(x)).length;
        return shared >= 2 || shared / Math.min(at.size, t.size) >= threshold;
      })
      .map(({ n }) => n);
    return { ac, coveredBy, covered: coveredBy.length > 0 };
  });
}
