// Character-level diff used by the virtual grid. Kept as a tiny, dependency-free
// module so the LCS can be unit-tested from Node without a DOM.
//
// It returns a flat, adjacent-grouped operation list:
//   [{ type: 'same' | 'del' | 'ins', text: '...' }, ...]
// `same` + `del` reconstructs the old string; `same` + `ins` reconstructs the new.
export function diffChars(before, after) {
  const A = [...String(before ?? '')];
  const B = [...String(after ?? '')];
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p += 1;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s += 1;
  const n = A.length - p - s;
  const m = B.length - p - s;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = A[p + i] === B[p + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  const add = (type, text) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  if (p) add('same', A.slice(0, p).join(''));
  for (let i = 0, j = 0; i < n || j < m; ) {
    if (i < n && j < m && A[p + i] === B[p + j]) {
      add('same', A[p + i]);
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) {
      add('del', A[p + i]);
      i += 1;
    } else {
      add('ins', B[p + j]);
      j += 1;
    }
  }
  if (s) add('same', A.slice(A.length - s).join(''));
  return ops;
}
