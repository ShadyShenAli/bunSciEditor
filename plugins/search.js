#!/c/TEMP/bun/bin/bun.exe
export default function(api) {

  function unescapeRepl(repl) {
    return repl.replace(/\\([ntr\\])/g, (_, c) =>
      c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\');
  }

  function unescapePattern(pat) {
    return pat.replace(/\\([ntr\\])/g, (_, c) =>
      c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\');
  }

  // Given full document text, build a line-start offset table
  function lineTable(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++)
      if (text[i] === '\n') starts.push(i + 1);
    return starts;
  }

  function lineOf(starts, pos) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo; // 0-based
  }

  // Build excerpt around a match, tagging match in ꒰꒱ and groups in ⌞⌝
  function excerptMatch(line0, col0, text, m) {
    const CTX  = 10;
    const start = Math.max(0, m.index - CTX);
    const end   = Math.min(text.length, m.index + m[0].length + CTX);
    const pre   = start > 0 ? '…' : '';
    const suf   = end < text.length ? '…' : '';
    let inner = m[0].replace(/\n/g, '↵');
    if (m.length > 1) {
      for (let g = m.length - 1; g >= 1; g--) {
        if (m[g] === undefined) continue;
        const rel = inner.indexOf(m[g]);
        if (rel >= 0)
          inner = inner.slice(0, rel) + '⌞' + m[g] + '⌝' + inner.slice(rel + m[g].length);
      }
    }
    const ctx = pre + text.slice(start, m.index).replace(/\n/g, '↵') + '꒰' + inner + '꒱' + text.slice(m.index + m[0].length, end).replace(/\n/g, '↵') + suf;
    return (line0 + 1) + ',' + (col0 + 1) + ': ' + ctx;
  }

  // Find all matches in full text, return array of { line0, col0, m, snippet }
  function findAllMatches(text, pattern) {
    const p = unescapePattern(pattern);
    let re;
    try { re = new RegExp(p, 'gms'); } catch { return null; }
    const starts  = lineTable(text);
    const padWidth = String(starts.length).length;
    const matches  = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const line0 = lineOf(starts, m.index);
      const col0  = m.index - starts[line0];
      matches.push({ line0, col0, m, padWidth });
      if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on zero-width match
    }
    return matches;
  }

  function matchToItem(match) {
    const { line0, col0, m } = match;
    return excerptMatch(line0, col0, m.input, m);
  }

  function matchToReplItem(match, pattern, repl) {
    const { line0, padWidth, m } = match;
    try {
      const r = unescapeRepl(repl);
      const substituted = r.replace(/\$(\d+|&)/g, (_, ref) => {
        if (ref === '&') return m[0];
        const n = parseInt(ref, 10);
        return (n < m.length ? m[n] : '') || '';
      });
      return String(line0 + 1).padStart(padWidth) + ' | ' + '꒰' + m[0].replace(/\n/g, '↵') + '꒱ → ⌞' + substituted.replace(/\n/g, '↵') + '⌝';
    } catch { return '(error)'; }
  }

  // ── Search Lines ────────────────────────────────────────────────────────────
  api.addMenuItem('Search Lines...', 'Ctrl+F', () => {
    let text = null;
    let lastMatches = [];
    const chosen = api.showPickerDynamic(
      'Search  (type regex, \\n \\r \\t supported)',
      filter => {
        if (!filter) return [];
        if (!text) text = api.sci.getText();
        const matches = findAllMatches(text, filter);
        if (!matches) return ['(invalid regex)'];
        if (matches.length === 0) return ['(no matches)'];
        lastMatches = matches;
        return matches.map(matchToItem);
      }
    );
    if (!chosen || chosen.startsWith('(')) return;
    const idx = lastMatches.findIndex(match => matchToItem(match) === chosen);
    if (idx >= 0) {
      const m = lastMatches[idx].m;
      const bytePos = Buffer.byteLength(m.input.slice(0, m.index), 'utf8');
      api.sci.setSelection(bytePos, bytePos);
    } else {
      const lineNum = parseInt(chosen, 10);
      if (!isNaN(lineNum) && lineNum >= 1) api.sci.gotoLine(lineNum - 1);
    }
  });

  // ── Replace All ─────────────────────────────────────────────────────────────
  api.addMenuItem('Replace All...', 'Ctrl+H', () => {
    let pattern = '';

    while (true) {
      // ── Screen 1: find ────────────────────────────────────────────────────
      let text = api.sci.getText();
      let matches = [];
      const picked = api.showPickerDynamic(
        'Find (type regex, \\n \\r \\t supported) — Enter/OK to replace',
        filter => {
          pattern = filter;
          if (!filter) return [];
          text = api.sci.getText();
          matches = findAllMatches(text, filter) || [];
          if (matches.length === 0) return ['(no matches)'];
          return matches.map(matchToItem);
        },
        pattern
      );
      if (!picked || picked.startsWith('(')) { if (!picked) return; continue; }

      const pickedLine = parseInt(picked, 10);
      if (!isNaN(pickedLine) && pickedLine >= 1) api.sci.gotoLine(pickedLine - 1);

      if (!pattern) { api.alert('No pattern entered.'); continue; }
      if (matches.length === 0) { api.alert('No matches found.'); continue; }

      // ── Screen 2: replace ─────────────────────────────────────────────────
      while (true) {
        let replacement = '';
        const confirmed = api.showPickerDynamic(
          'Replace /' + pattern + '/  (' + matches.length + ' match(es)) — type replacement, Enter/OK to apply',
          repl => {
            replacement = repl;
            return matches.map(match => matchToReplItem(match, pattern, repl));
          }
        );
        if (!confirmed) {
          if (api.confirm('Go back to find step?')) break;
          return;
        }

        const p        = unescapePattern(pattern);
        const finalRepl = unescapeRepl(replacement);
        const replaced  = text.replace(new RegExp(p, 'gms'), finalRepl);
        const pos = api.sci.getCursorPos();
        api.sci.setText(replaced);
        api.sci.setSelection(Math.min(pos, replaced.length), Math.min(pos, replaced.length));
        api.alert('Done — ' + matches.length + ' match(es) replaced.');
        return;
      }
    }
  });

}
