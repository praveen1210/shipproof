/**
 * Step 1 of triage (§6.3): reduce a raw failure message to a stable skeleton so that the
 * same failure in different runs produces the same signature.
 */

const MAX_INPUT = 4000;

/** First line that looks like an exception / error header, minus the stack. */
export function headline(raw: string): string {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isStackFrame(l));
  return lines.slice(0, 3).join(' ');
}

export function isStackFrame(line: string): boolean {
  return (
    /^at\s+[\w$.<>]+\s*\(/.test(line) || // Java / JS "at foo.bar(File.java:12)"
    /^at\s+\S+:\d+:\d+$/.test(line) || // JS "at file.js:1:2"
    /^at\s+(async\s+)?[\w$.<>]+\s+\(/.test(line) ||
    /^at\s+(async\s+)?\S+\s*\(.*:\d+:\d+\)$/.test(line) ||
    /^\.\.\.\s*\d+\s+more$/.test(line) ||
    /^File ".*", line \d+/.test(line)
  );
}

/** Extracts the exception type: `org.openqa.selenium.NoSuchElementException` → `NoSuchElementException`. */
export function exceptionType(raw: string): string {
  const text = raw.slice(0, MAX_INPUT);
  const m =
    text.match(/\b(?:[a-z_$][\w$]*\.)*([A-Z][\w$]*(?:Exception|Error|Failure|Violation))\b/) ??
    text.match(/\b(E[A-Z]{4,}(?:RESET|REFUSED|NOTFOUND|TIMEDOUT|PIPE)?)\b/) ??
    text.match(/\b(TimeoutError|AssertionError|Error)\b/);
  return m ? m[1] : 'Error';
}

export function normalise(raw: string | undefined): string {
  if (!raw) return '';
  let s = headline(raw.slice(0, MAX_INPUT));

  s = s
    // ISO timestamps / dates / clock times
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g, '<ts>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?\b/g, '<time>')
    // UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    // Selenium session ids and other long hex ids
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<hex>')
    // URLs keep host-less shape
    .replace(/https?:\/\/[^\s'")<>]+/gi, '<url>')
    // Temp / absolute file paths
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.\-@]+){2,}[\\/]?/g, '<path>')
    // host:port and ports
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>')
    .replace(/(?<=[\w>]):\d{2,5}\b/g, ':<port>')
    // quoted dynamic values: keep short identifier-like strings, which are often locators
    .replace(/"([^"]{0,200})"/g, (_m, inner: string) => `"${maskQuoted(inner)}"`)
    .replace(/'([^']{0,200})'/g, (_m, inner: string) => `'${maskQuoted(inner)}'`)
    // numbers > 3 digits
    .replace(/\b\d{4,}(\.\d+)?\b/g, '<n>')
    // durations like 30000ms / 12.5s
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|seconds)\b/gi, '<dur>')
    .replace(/\s+/g, ' ')
    .trim();

  return s.slice(0, 500);
}

/** A quoted value is kept if it looks like a selector/identifier, masked if it looks like data. */
function maskQuoted(inner: string): string {
  if (/^[#.\[/]|^\/\/|^[a-z]+=|getBy|data-test|aria-|xpath|css=/i.test(inner)) return inner; // locator
  if (/^\d+(\.\d+)?$/.test(inner)) return '<n>';
  if (inner.length > 40) return '<str>';
  if (/\d{3,}|@|\s{2,}/.test(inner)) return '<str>';
  return inner;
}

/** Tokens used for "possible duplicate" text search (§6.4). */
export function skeletonTokens(skeleton: string): string[] {
  return Array.from(
    new Set(
      skeleton
        .replace(/<[a-z]+>/g, ' ')
        .split(/[^A-Za-z0-9_#\-]+/)
        .filter((t) => t.length >= 4),
    ),
  );
}
