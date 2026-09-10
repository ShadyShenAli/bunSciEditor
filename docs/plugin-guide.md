# BunSciEditor — Plugin Authoring Guide

## Overview

<div-h2>

Plugins are plain JavaScript ES modules dropped into the `plugins/` folder. Each plugin exports a single default function that receives a `PluginAPI` instance. Plugins are loaded once at startup, alphabetically by filename.

```js
#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  // set up menu items, event listeners, etc.
}
```

The plugin's menu label is derived from its filename: `my_plugin.js` → `My plugin`.

- **Single item plugins** appear directly in the Plugins menu
- **Multi-item plugins** get a submenu named after the plugin file

</div-h2>

## Plugin API Reference

<div-h2>

### api.sci — Scintilla Helpers

<div-h3>

All text and editor operations go through `api.sci`. You never need raw Scintilla message numbers for common tasks (but `api._rawSend()` is available as an escape hatch).

#### Text Content

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `getText()` | `string` | Full document text |
| `setText(s)` | `void` | Replace entire document |
| `getLine(n)` | `string` | Text of line `n` (0-based), includes newline |
| `getLineCount()` | `number` | Total number of lines |
| `getTextLength()` | `number` | Document byte length |

</div-h4>

#### Selection and Cursor

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `getSelText()` | `string` | Currently selected text (empty if no selection) |
| `replaceSelection(s)` | `void` | Replace the current selection with `s` |
| `getSelectionStart()` | `number` | Start of selection (document position) |
| `getSelectionEnd()` | `number` | End of selection (document position) |
| `getCurrentPos()` | `number` | Current caret position |
| `getCurrentLine()` | `number` | Line number of the caret (0-based) |
| `gotoLine(n)` | `void` | Move caret to start of line `n` |
| `gotoPos(pos)` | `void` | Move caret to document position `pos` |

</div-h4>

#### Lines and Indentation

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `lineFromPosition(pos)` | `number` | Line number for a document position |
| `positionFromLine(n)` | `number` | Document position of the start of line `n` |
| `getLineIndentation(n)` | `number` | Number of indent spaces on line `n` |

</div-h4>

#### Search

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `findNext(needle, fromPos?, toPos?, flags?)` | `{start,end}` or `null` | Find first match of `needle` starting at `fromPos` (default 0). `toPos=-1` means end of document. |
| `findAll(needle, flags?)` | `[{start,end}, ...]` | All matches of `needle` in the document |

**Search flags** — combine with bitwise OR or use `api.SCFIND`:

| Constant | Value | Meaning |
|----------|-------|---------|
| `api.SCFIND.MATCHCASE` | `0x4` | Case-sensitive match |
| `api.SCFIND.WHOLEWORD` | `0x2` | Whole-word match only |
| `api.SCFIND.REGEXP` | `0x800000` | `needle` is a regular expression |

Example:
```js
const hits = api.sci.findAll('TODO', api.SCFIND.MATCHCASE | api.SCFIND.WHOLEWORD);
```

</div-h4>

#### Words

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `getWordAt(pos)` | `string` | The word token at document position `pos` |

</div-h4>

#### Read-only Mode

<div-h4>

| Method | Returns | Description |
|--------|---------|-------------|
| `getReadOnly()` | `boolean` | Whether the document is read-only |
| `setReadOnly(flag)` | `void` | Enable/disable read-only mode |

</div-h4>

#### Indicators (Decorations)

<div-h4>

Indicators are overlaid decorations (underlines, boxes, highlights) that don't modify document text. Use indicator slots 0–31 (avoid 0–7 which Scintilla uses internally; prefer 8–31 for plugins).

| Method | Description |
|--------|-------------|
| `setIndicatorStyle(id, style)` | Set the visual style. Common styles: `0`=plain underline, `1`=squiggle, `6`=dotted, `8`=straight box, `16`=full background fill |
| `setIndicatorFore(id, colorRef)` | Set color as Win32 `COLORREF` (`0x00BBGGRR`) |
| `setIndicatorAlpha(id, alpha)` | Transparency 0–255 (only applies to fill-based styles) |
| `setIndicatorUnder(id, under)` | `true` = draw behind text |
| `fillIndicator(id, start, length)` | Mark a range with indicator `id` |
| `clearIndicator(id)` | Remove all instances of indicator `id` from the document |

Example — yellow box highlight:
```js
const INDIC = 8;
api.sci.setIndicatorStyle(INDIC, 8);          // INDIC_STRAIGHTBOX
api.sci.setIndicatorFore(INDIC, 0x0000FFFF);  // yellow COLORREF
api.sci.setIndicatorAlpha(INDIC, 80);
api.sci.setIndicatorUnder(INDIC, true);

const hits = api.sci.findAll('hello');
for (const { start, end } of hits)
  api.sci.fillIndicator(INDIC, start, end - start);
```

</div-h4>

</div-h3>

### api.editor — Editor State

<div-h3>

Read-only properties reflecting current editor state:

| Property | Type | Description |
|----------|------|-------------|
| `api.editor.path` | `string \| null` | Current open file path, `null` if unsaved |
| `api.editor.dirty` | `boolean` | Whether there are unsaved changes |
| `api.editor.theme` | `string` | Active theme name (e.g. `'Dracula'`) |
| `api.editor.fontSize` | `number` | Current font size in points |

</div-h3>

### api.addMenuItem — Register a Menu Item

<div-h3>

```js
api.addMenuItem(label, callback, shortcut?)
```

- `label` — display name in the Plugins menu (or submenu)
- `callback` — `function()` invoked when selected
- `shortcut` — optional keyboard shortcut string, e.g. `'Ctrl+Shift+J'`

Supported modifier names: `Ctrl`, `Shift`, `Alt`. Key names: letters A–Z, digits 0–9, `F1`–`F12`, `Tab`, `Return`, `Escape`, `Space`, `Delete`, `Insert`, `Home`, `End`, `Left`, `Right`, `Up`, `Down`.

```js
api.addMenuItem('Format JSON', () => {
  // ...
}, 'Ctrl+Shift+F');
```

</div-h3>

### api.on / api.off — Event Listeners

<div-h3>

```js
api.on(event, handler)
api.off(event, handler)
```

Available events:

| Event | When fired | Handler signature |
|-------|------------|-------------------|
| `'change'` | Document content changed | `()` |
| `'cursorMove'` | Caret moved or selection changed | `()` |
| `'fileOpen'` | A file was opened | `(path: string)` |
| `'fileSave'` | A file was saved | `(path: string)` |
| `'themeChange'` | Theme switched | `(themeName: string)` |

</div-h3>

### Dialog Helpers

<div-h3>

All dialogs are modal and block until the user responds.

| Method | Returns | Description |
|--------|---------|-------------|
| `api.alert(msg)` | `void` | Show a message box with an OK button |
| `api.confirm(msg)` | `boolean` | Yes/No dialog; returns `true` for Yes |
| `api.prompt(msg, defaultValue?)` | `string \| null` | Text input dialog; `null` if cancelled |
| `api.showPicker(title, items, multi?)` | `string[] \| null` | Fuzzy-search picker list; `null` if cancelled |

**showPicker** — `items` is an array of strings. The user types to fuzzy-filter and presses Enter to confirm. Returns an array of selected strings (multiple if `multi=true`).

```js
const choice = await api.showPicker('Go to section', ['Introduction', 'Architecture', 'Plugins']);
if (choice) api.alert('You chose: ' + choice[0]);
```

</div-h3>

### api._rawSend — Escape Hatch

<div-h3>

Sends a raw Scintilla message to the editor window. Use this when `api.sci` doesn't expose the message you need.

```js
const SCI_ZOOMIN = 2373;
api._rawSend(SCI_ZOOMIN, 0, 0);
```

</div-h3>

</div-h2>

## Plugin Examples

<div-h2>

### Minimal plugin — insert timestamp

<div-h3>

```js
#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  api.addMenuItem('Insert timestamp', () => {
    api.sci.replaceSelection(new Date().toISOString());
  }, 'Ctrl+Shift+T');
}
```

</div-h3>

### Multi-item plugin — case conversion

<div-h3>

```js
#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  function transform(fn) {
    const sel = api.sci.getSelText();
    if (sel.length === 0) { api.alert('Select some text first'); return; }
    api.sci.replaceSelection(fn(sel));
  }

  api.addMenuItem('UPPERCASE', () => transform(s => s.toUpperCase()));
  api.addMenuItem('lowercase', () => transform(s => s.toLowerCase()));
  api.addMenuItem('Title Case', () => transform(s =>
    s.replace(/\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
  ));
}
```

</div-h3>

### Event-driven plugin — word count in title

<div-h3>

```js
#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  function update() {
    const words = api.sci.getText().trim().split(/\s+/).filter(Boolean).length;
    // NOTE: title update requires _rawSend
    // api.setTitle not available — use a menu item to show count instead
    api.addMenuItem('Word count', () => api.alert(`${words} words`));
  }
  api.on('change', update);
}
```

</div-h3>

### Selection highlight plugin

<div-h3>

Highlights all occurrences of the current selection (≥2 chars) with a yellow box indicator. Clears automatically on deselect or document change.

```js
#!/c/TEMP/bun/bin/bun.exe
const INDIC_ID          = 8;
const INDIC_STRAIGHTBOX = 8;
const YELLOW            = 0x0000FFFF; // COLORREF R=255 G=255 B=0

export default function(api) {
  let lastSel    = '';
  let indicSetup = false;

  function setupIndicator() {
    if (indicSetup) return;
    indicSetup = true;
    api.sci.setIndicatorStyle(INDIC_ID, INDIC_STRAIGHTBOX);
    api.sci.setIndicatorFore(INDIC_ID, YELLOW);
    api.sci.setIndicatorAlpha(INDIC_ID, 80);
    api.sci.setIndicatorUnder(INDIC_ID, true);
  }

  function clearHighlights() {
    api.sci.clearIndicator(INDIC_ID);
  }

  function highlightAll(word) {
    setupIndicator();
    const matches = api.sci.findAll(word, api.SCFIND.MATCHCASE);
    for (const { start, end } of matches) {
      api.sci.fillIndicator(INDIC_ID, start, end - start);
    }
  }

  api.on('cursorMove', () => {
    const trimmed = api.sci.getSelText().replace(/[\r\n]/g, '');
    if (trimmed === lastSel) return;
    lastSel = trimmed;
    clearHighlights();
    if (trimmed.length >= 2) highlightAll(trimmed);
  });

  api.on('change', () => {
    lastSel = '';
    clearHighlights();
  });
}
```

Key points:
- `lastSel` guard prevents redundant redraws on every cursor movement when selection hasn't changed.
- Indicator setup is deferred to the first highlight to avoid unnecessary Scintilla calls on startup.
- `cursorMove` fires on every `SCN_UPDATEUI` — keep the handler fast.
- `change` clears highlights so stale ranges don't persist after edits.

</div-h3>

</div-h2>

## Gotchas and Known Limitations

<div-h2>

### SCI_GETSELTEXT returns byte count excluding null terminator

<div-h3>

`api.sci.getSelText()` is correct — don't recalculate from `SCI_GETSELTEXT` directly. If you call `_rawSend(SCI_GETSELTEXT, 0, ptr(buf))`, the return value is the byte count of the content **without** the trailing `\0`. Use `buf.toString('utf8', 0, len)` — NOT `len - 1`.

</div-h3>

### ptr() and GC — always use named variables

<div-h3>

When calling `_rawSend` with a struct pointer, always assign the `Buffer` to a named variable **before** passing `ptr(buf)`. Inline buffers inside the `ptr()` call will be garbage collected before `SendMessageW` reads the memory.

```js
// WRONG — buffer may be GC'd before SendMessageW reads it
api._rawSend(SCI_SETPROPERTY, ptr(Buffer.from('fold\0')), BigInt(ptr(Buffer.from('1\0'))));

// CORRECT
const key = Buffer.from('fold\0', 'utf8');
const val = Buffer.from('1\0', 'utf8');
api._rawSend(SCI_SETPROPERTY, ptr(key), BigInt(ptr(val)));
```

</div-h3>

### getSelText() in event handlers — call only once

<div-h3>

`getSelText()` allocates a buffer and calls `SCI_GETSELTEXT` twice. If the selection might change between calls (e.g., if your callback calls something that triggers another notification), cache the value:

```js
api.on('cursorMove', () => {
  const sel = api.sci.getSelText(); // call once, reuse
  doSomethingWith(sel);
  doSomethingElseWith(sel);
});
```

</div-h3>

### Plugins share indicator slots — avoid collisions

<div-h3>

Scintilla has indicator slots 0–31. Scintilla itself uses 0–7. Each plugin should use a distinct slot from 8–31. There is currently no registry — coordinate manually if you're running multiple plugins that use indicators.

</div-h3>

### COLORREF format — BGR not RGB

<div-h3>

Win32 `COLORREF` is `0x00BBGGRR` — blue and red are swapped vs typical HTML color order. For example:
- Red: `0x000000FF`
- Green: `0x0000FF00`
- Blue: `0x00FF0000`
- Yellow: `0x0000FFFF`

</div-h3>

### No dynamic menu changes after startup

<div-h3>

`api.addMenuItem()` is only effective during the plugin's init function call. Adding menu items in event handlers or callbacks will not work — the menu is built once from all registered items after all plugins have loaded.

</div-h3>

### Plugin files must be valid ES modules

<div-h3>

The `plugins/` directory is scanned for `*.js` files. Each must have a `default` export that is a function. Files that throw on import or don't export a function are skipped with a console warning. No hot-reload — restart the editor to pick up changes.

</div-h3>

</div-h2>

<style>
  * {
    margin-top : 5px !important;
    margin-bottom: 2px !important;
  }

  h1 {
    text-align: center;
  }
  div-h2, div-h3, div-h4{
    display: block;
    margin-left: 20px;
  }

  h3:before {
    content: "§ " !important;
    display: inline !important;
  }

  h4:before {
    content: "§§ " !important;
    display: inline !important;
  }

  details {
  border-left: 5px solid #DDD;
  padding-left: 10px;
  }
</style>
