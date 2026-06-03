// Output comparison. Online judges normalize whitespace so that trailing
// spaces/newlines don't cause spurious failures, while still being strict about
// the actual token sequence. We:
//   - strip trailing whitespace on each line
//   - drop trailing blank lines
//   - compare the results exactly
export function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

// Numeric tolerance for float outputs. Distinct integers differ by >= 1, far
// above these thresholds, so integer/exact problems are unaffected.
const EPS_ABS = 1e-9;
const EPS_REL = 1e-6;

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    const diff = Math.abs(na - nb);
    return diff <= EPS_ABS || diff <= EPS_REL * Math.max(Math.abs(na), Math.abs(nb));
  }
  return false;
}

export function outputsMatch(actual: string, expected: string): boolean {
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) return true;

  // Line-aware, token-wise comparison: line count must match (formatting is
  // still meaningful), but intra-line spacing is ignored and numeric tokens are
  // compared with a small tolerance so float answers don't fail spuriously.
  const linesA = a.split('\n');
  const linesE = e.split('\n');
  if (linesA.length !== linesE.length) return false;

  for (let i = 0; i < linesA.length; i++) {
    const ta = linesA[i].split(/\s+/).filter(Boolean);
    const te = linesE[i].split(/\s+/).filter(Boolean);
    if (ta.length !== te.length) return false;
    for (let j = 0; j < ta.length; j++) {
      if (!tokensMatch(ta[j], te[j])) return false;
    }
  }
  return true;
}
