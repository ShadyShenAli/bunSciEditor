#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  function getInput() {
    const sel = api.sci.getSelText();
    const hasSelection = sel.length > 0;
    return { text: hasSelection ? sel : api.sci.getText(), hasSelection };
  }

  function apply(transformed) {
    const { hasSelection } = getInput();
    if (hasSelection) {
      api.sci.replaceSelection(transformed);
    } else {
      api.sci.setText(transformed);
    }
  }

  function tryParse(text) {
    try { return JSON.parse(text); }
    catch (e) { api.alert('Invalid JSON: ' + e.message); return null; }
  }

  api.addMenuItem('Stringify (pretty)', () => {
    const { text } = getInput();
    const obj = tryParse(text);
    if (obj !== null) apply(JSON.stringify(obj, null, 2));
  });

  api.addMenuItem('Compact', () => {
    const { text } = getInput();
    const obj = tryParse(text);
    if (obj !== null) apply(JSON.stringify(obj));
  });

  api.addMenuItem('To JSONL', () => {
    const input = getInput();
    const obj = tryParse(input.text);
    if (obj === null) return;

    function serialize(val, indent) {
      if (Array.isArray(val)) {
        const allObjects = val.every(r => typeof r === 'object' && r !== null && !Array.isArray(r));
        const pad   = '  '.repeat(indent);
        const inner = '  '.repeat(indent + 1);
        if (allObjects && val.length > 0) {
          return '[\n' + val.map(r => inner + JSON.stringify(r)).join(',\n') + '\n' + pad + ']';
        }
        const items = val.map(r => inner + serialize(r, indent + 1));
        return '[\n' + items.join(',\n') + '\n' + pad + ']';
      }
      if (typeof val === 'object' && val !== null) {
        const pad   = '  '.repeat(indent);
        const inner = '  '.repeat(indent + 1);
        const entries = Object.entries(val).map(([k, v]) =>
          inner + JSON.stringify(k) + ': ' + serialize(v, indent + 1)
        );
        return '{\n' + entries.join(',\n') + '\n' + pad + '}';
      }
      return JSON.stringify(val);
    }

    let result = serialize(obj, 0);
    // Re-apply surrounding indent when operating on a selection
    if (input.hasSelection) {
      const selStart = api.sci.getSelectionStart();
      const line     = api.sci.lineFromPosition(selStart);
      const indent   = api.sci.getLineIndentation(line);
      const pad      = ' '.repeat(indent);
      result = result.split('\n').map((l, i) => i === 0 ? l : pad + l).join('\n');
      api.sci.replaceSelection(result);
    } else {
      api.sci.setText(result);
    }
  });
}
