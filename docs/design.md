# BunSciEditor — Technical Design Document

## Overview

<div-h2>

BunSciEditor is a native Win32 text editor built entirely in JavaScript using the [Bun](https://bun.sh) runtime and its FFI layer (`bun:ffi`). It embeds [Scintilla](https://www.scintilla.org/) as the editing component (via `Scintilla.dll`) and [Lexilla](https://www.scintilla.org/Lexilla.html) for syntax highlighting (`Lexilla.dll`). No Electron, no web view, no C++ glue — pure JS calling Win32 APIs directly.

**Key characteristics:**
- Single-process, single-window Win32 application
- Scintilla child window fills the entire client area
- Plugins loaded at startup from `plugins/` as ES modules
- Config persisted in `config.ini` (theme, font, font size, word wrap)
- Accelerator table rebuilt at startup to include plugin shortcuts
- Distributable as a standalone `editor.exe` via `bun build --compile`

</div-h2>

## Architecture

<div-h2>

### File Layout

<div-h3>

```
D:\w\
├── editor.js          ← Main entry point: Win32 window, message loop, menus, Scintilla setup
├── plugin-api.js      ← PluginAPI class, EventEmitter, loadPlugins(), dialog helpers
├── plugins/           ← Drop-in plugin directory (*.js, loaded alphabetically)
│   ├── hello.js
│   ├── json_formatter.js
│   ├── search.js
│   ├── selection-highlight.js
│   └── word-count.js
├── win32/             ← Helpers: pointers.ts, strings.ts, wndclass.ts
├── @bun-win32/        ← Typed Win32 FFI bindings (User32, Kernel32, Comdlg32) — npm packages
├── Scintilla.dll      ← Scintilla 5.x editing component
├── Lexilla.dll        ← Lexilla lexer library
├── config.ini         ← Persisted user settings
├── dist/editor.js     ← Bundle output (bun run build)
└── editor.exe         ← Compiled standalone executable (bun run compile)
```

</div-h3>

### editor.js — Main Module

<div-h3>

Responsibilities:
- Register a Win32 window class and create the main `OVERLAPPEDWINDOW`
- Create the Scintilla child window on `WM_CREATE`
- Handle `WM_COMMAND` for all menu actions (File, View, Plugins)
- Handle `WM_NOTIFY` for Scintilla notifications (`SCN_MODIFIED`, `SCN_UPDATEUI`, `SCN_MARGINCLICK`)
- Build and rebuild the menu bar (including the dynamic Plugins submenu)
- Manage themes (4 built-in), font face/size, word wrap, and config persistence
- Forward Scintilla events to `pluginEmitter` (an `EventEmitter` instance)
- Run the Win32 message loop

Key design: the main module constructs `PluginAPI` instances via `makePluginAPI(name)`, which wires `_rawSend`, `_emitter`, `_state`, and `_hMain` onto each instance before handing it to the plugin's init function.

`APP_DIR` is resolved at startup as `dirname(import.meta.path ?? process.execPath)` — `import.meta.path` is defined when interpreted, `undefined` in a compiled exe (where `process.execPath` points to the exe itself). This ensures `config.ini` and `plugins/` are always found next to the running binary.

</div-h3>

### plugin-api.js — Plugin Framework

<div-h3>

Exports:
- `EventEmitter` — minimal pub/sub used internally and by plugins
- `PluginAPI` — the object passed to each plugin's `default` export
- `loadPlugins(dir, makeAPI)` — async loader; reads `plugins/*.js` alphabetically, imports each, calls `init(api)`

`PluginAPI` contains:
- `api.sci` — all Scintilla helpers (text, selection, search, indicators, etc.)
- `api.editor` — read-only editor state (path, dirty flag, theme, font size)
- `api.SCFIND` — search flag constants
- `api.addMenuItem()`, `api.on/off()`, `api.alert/confirm/prompt/showPickerDynamic()`
- `api._rawSend()` — escape hatch for any Scintilla message not wrapped by the API

Dialog utilities (prompt, picker) are implemented using packed `DLGTEMPLATE` buffers passed to `DialogBoxIndirectParamW` — no resource file needed.

</div-h3>

### Plugins — Drop-in ES Modules

<div-h3>

Each plugin is a `.js` file with a default export `function(api) { ... }`. Plugins are loaded once at startup. The plugin's filename (without `.js`, underscores/dashes replaced with spaces) becomes its submenu label in the Plugins menu. Plugins with a single menu item appear directly; plugins with multiple items get a submenu.

</div-h3>

</div-h2>

## Key Technical Decisions

<div-h2>

### Win32 FFI via bun:ffi

<div-h3>

All Win32 calls use `bun:ffi` `dlopen` over `user32.dll`, `kernel32.dll`, `comdlg32.dll`. `@bun-win32` provides pre-typed bindings. `JSCallback` creates native function pointers for `WndProc` and dialog procedures. HWND values are `BigInt` (u64) throughout since Win32 handles are pointer-sized.

</div-h3>

### Scintilla Message Passing

<div-h3>

Scintilla is controlled entirely via `SendMessageW(hSci, SCI_*, wParam, lParam)`. There is no direct Scintilla C API call — everything goes through the window message interface. This keeps the FFI surface minimal (just `SendMessageW`) at the cost of having to pack structs like `Sci_TextToFind` and `Sci_TextRange` manually into `Buffer`s and pass their addresses via `ptr()`.

</div-h3>

### Lexer and Syntax Highlighting

<div-h3>

Lexilla is loaded via `dlopen('./Lexilla.dll')` to call `CreateLexer(name)` which returns an `ILexer5*` pointer. This is passed to Scintilla via `SCI_SETILEXER`. The `cpp` lexer is reused for JS/TS/JSX/TSX/C/C++ files; two keyword sets are configured for JS-specific highlighting (keywords1 = JS syntax, keywords2 = built-ins and globals).

</div-h3>

### Code Folding

<div-h3>

Folding is enabled via the `fold=1` lexer property set through `SCI_SETPROPERTY` before `SCI_COLOURISE`. Margin 2 is configured as a sensitive symbol margin masked to `SC_MASK_FOLDERS` (`0xFE000000` = marker slots 25–31). `SCN_MARGINCLICK` notifications are handled manually in `WM_NOTIFY` to call `SCI_TOGGLEFOLD` on the clicked line (position is extracted from `SCNotification.position` at byte offset 24, then converted to a line via `SCI_LINEFROMPOSITION`).

Fold marker shapes are defined in `applyFoldMarkerColors()` (called after every `SCI_STYLECLEARALL`) using box-style markers: `SC_MARK_BOXPLUS`/`SC_MARK_BOXMINUS` with tree-line connectors.

</div-h3>

### Plugin Menu and Shortcuts

<div-h3>

After all plugins load, `rebuildPluginsMenu()` iterates `pluginAPIs`, creates a top-level `&Plugins` popup menu, and adds per-plugin submenus (or direct items for single-item plugins). Letter accelerators (`&a`, `&b`, ...) are prepended to submenu labels for keyboard navigation.

Plugin shortcuts (e.g. `'Ctrl+F'`) registered via `addMenuItem` are parsed by `parseShortcut()` and injected into the Win32 `ACCEL` table, which is rebuilt via `CreateAcceleratorTableW` after plugins load.

</div-h3>

### Picker Dialog (Fuzzy Search / Dynamic Callback)

<div-h3>

`showPickerDialog` shows a modal dialog with an EDIT control and a LISTBOX. The EDIT is subclassed via `SetWindowLongPtrW`/`JSCallback` to intercept arrow keys and Enter/Esc. It accepts either a static `items` array (built-in fuzzy matching: no `*` = consecutive substring; `*` separates wildcard segments) or a `getItems(filterText) => string[]` callback called on every keystroke.

When a callback is provided the built-in fuzzy matcher is bypassed and filtering is fully delegated to the callback. An optional `initialFilter` string pre-fills the EDIT on `WM_INITDIALOG` and seeds the first call. Exposed on `PluginAPI` as `showPickerDynamic(title, getItems, initialFilter?)`.

</div-h3>

### Current-Line Highlight

<div-h3>

Each theme defines a `caretLineBg` color. `applyThemeStyles()` calls:
```js
sciSend(hwnd, SCI_SETCARETLINEBACK,    t.caretLineBg, 0);  // 2098
sciSend(hwnd, SCI_SETCARETLINEVISIBLE, 1,             0);  // 2097
```
Light themes use a shallow green (`232,248,232`); dark themes use a dark-green-shifted variant. The calls are inside `applyThemeStyles` so the highlight color updates with every theme switch.

</div-h3>

### Search Plugin — Full-Document Regex Search

<div-h3>

The search plugin (`plugins/search.js`) implements two commands:

**Search Lines (Ctrl+F):** `showPickerDynamic` with a callback that runs the typed pattern as a JS regex against the full document text. Each match is shown as `line col | …꒰match꒱…` with ±30 chars of context and capture groups tagged in `⌞⌝`.

**Replace All (Ctrl+H):** Two-screen flow:
1. Screen 1 — same live regex picker; Enter proceeds to screen 2 with the matched set frozen
2. Screen 2 — `showPickerDynamic` where typing the replacement string updates the preview live: each item shows `꒰original꒱ → ⌞substituted⌝`; Enter applies

Cancel on screen 2 offers "Go back to find step?" — yes restores screen 1 with the previous pattern pre-filled.

**Full-document regex engine:** `findAllMatches(text, pattern)` runs `new RegExp(p, 'gms')` (`s` = dotAll) against the full text. Match offsets are converted to line/col via a binary-search line-start table. This supports multi-line patterns (e.g. `\n\n` to find blank lines, `foo\nbar` to match across line boundaries).

**Escape handling:** Both pattern and replacement support `\n`, `\t`, `\r`, `\\` as escape sequences (unescaped before passing to `RegExp`/`.replace()`). Standard regex metacharacters (`\d`, `\w`, `\s`, etc.) are left intact. `$1`, `$2`, `$&` in the replacement use JS `.replace()` semantics.

</div-h3>

</div-h2>

## Issues, Findings, and Solutions

<div-h2>

### SCN_MARGINCLICK wrong code

<div-h3>

**Issue:** Fold margin clicks did nothing. `WM_NOTIFY` handler checked for code `2006` (was assumed from prior references).

**Solution:** The correct value from `Scintilla.h` is `#define SCN_MARGINCLICK 2010`. Verified directly from the Scintilla source tree at `D:\w\scintilla\include\Scintilla.h`.

</div-h3>

### SCNotification struct layout — wrong field offsets

<div-h3>

**Issue:** After receiving `SCN_MARGINCLICK`, the `line` field was always 0. Code was reading from offset 96 (the `line` field which is only valid for `SCN_MODIFIED`).

**Solution:** For `SCN_MARGINCLICK`, the relevant field is `position` (byte offset 24 in the struct), not `line`. Convert position to line number via `SCI_LINEFROMPOSITION` (message 2166).

x64 `SCNotification` layout:
- `nmhdr`: hwndFrom(8) + idFrom(8) + code(4) + pad(4) = 24 bytes
- `position` (Sci_Position = 8 bytes) → offset **24** ← used for MARGINCLICK
- `ch` (int) → 32, `modifiers` → 36, `modificationType` → 40
- `line` (Sci_Position) → offset **96** ← only valid for SCN_MODIFIED

</div-h3>

### Fold marker slot numbers reversed

<div-h3>

**Issue:** Box-style fold markers showed `[+]` on every line — all markers were defined on wrong slots. Original code used slots 25=FOLDEROPEN, 26=FOLDER, etc.

**Solution:** `Scintilla.h` defines:
```
SC_MARKNUM_FOLDEREND     = 25
SC_MARKNUM_FOLDEROPENMID = 26
SC_MARKNUM_FOLDERMIDTAIL = 27
SC_MARKNUM_FOLDERTAIL    = 28
SC_MARKNUM_FOLDERSUB     = 29
SC_MARKNUM_FOLDER        = 30   ← collapsed [+]
SC_MARKNUM_FOLDEROPEN    = 31   ← expanded [-]
```
All seven slots were reassigned to match.

</div-h3>

### SC_MARK_* symbol values wrong

<div-h3>

**Issue:** Custom box markers displayed incorrectly due to wrong `SC_MARK_*` constant values.

**Solution:** Values from `Scintilla.h`:
`VLINE=9, LCORNER=10, TCORNER=11, BOXPLUS=12, BOXPLUSCONNECTED=13, BOXMINUS=14, BOXMINUSCONNECTED=15`

</div-h3>

### SCI_STYLECLEARALL resets marker shapes

<div-h3>

**Issue:** After opening a file, fold icons disappeared. `SCI_STYLECLEARALL` (called on every theme/lexer apply) resets all marker definitions back to Scintilla defaults.

**Solution:** Moved `SCI_MARKERDEFINE` calls into `applyFoldMarkerColors()`, which is called from `applyThemeStyles()` after every `SCI_STYLECLEARALL`. This ensures shapes survive theme switches and file opens.

</div-h3>

### GC of inline Buffer.from() passed to ptr()

<div-h3>

**Issue:** Fold property (`fold=1`) wasn't taking effect. Code used `ptr(Buffer.from('1\0','utf8'))` inline — the buffer was created and immediately eligible for GC before `SendMessageW` could read the pointer.

**Solution:** Assign buffers to named `const` variables before calling `ptr()`:
```js
const kb = Buffer.from('fold\0', 'utf8');
const vb = Buffer.from('1\0', 'utf8');
sciSend(hwnd, SCI_SETPROPERTY, ptr(kb), BigInt(ptr(vb)));
```

</div-h3>

### Missing .js lexer mapping → no fold levels

<div-h3>

**Issue:** Opening `editor.js` showed no fold markers. JavaScript files were not in the `EXT_LEXER` map, so `applyLexer` used the `null` lexer — no fold levels were computed.

**Solution:** Added `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` → `'cpp'` in `EXT_LEXER`. The `cpp` lexer handles JS/TS well with appropriate keyword sets.

</div-h3>

### getSelText() off-by-one

<div-h3>

**Issue:** Selected text was missing its last character when passed to plugins.

**Root cause:** `SCI_GETSELTEXT` with a buffer argument returns the number of bytes written **excluding** the null terminator. Code was using `buf.toString('utf8', 0, len - 1)` — cutting off the last real byte.

**Solution:** Changed to `buf.toString('utf8', 0, len)`.

</div-h3>

### SCI_COLOURISE must run after SCI_SETTEXT

<div-h3>

**Issue:** Fold levels not computed on first file open.

**Analysis:** `SCI_SETTEXT` loads the content, but fold level computation is triggered by `SCI_COLOURISE`. The call order in `applyLexer` is: `SCI_SETILEXER` → `SCI_SETPROPERTY(fold,1)` → `applyThemeStyles` → `SCI_COLOURISE`. Since `SCI_SETTEXT` is called in `cmdOpenPath` *before* `applyLexer`, the colourise pass runs after the text is present — correct.

</div-h3>

### SC_AUTOMATICFOLD_CLICK vs manual SCN_MARGINCLICK

<div-h3>

**Issue:** Enabling `SC_AUTOMATICFOLD_CLICK` (bit 2 of `SCI_SETAUTOMATICFOLD`) was expected to auto-handle fold clicks. It did not work reliably.

**Solution:** Removed `SC_AUTOMATICFOLD_CLICK`. Handle `SCN_MARGINCLICK` manually in `WM_NOTIFY` with the correct struct offsets. Check `margin === 2`, extract `position`, convert to `line`, call `SCI_TOGGLEFOLD`.

</div-h3>

### SCI_SETPROPERTY constant missing

<div-h3>

**Issue:** Editor crashed on file open with `SCI_SETPROPERTY is not defined`.

**Root cause:** `SCI_SETPROPERTY = 4004` was never declared in the constants block — the name was used in `setupFolding` but resolved to `undefined`, causing `SendMessageW` to receive `0` as the message code.

**Solution:** Added `const SCI_SETPROPERTY = 4004` to the Scintilla message constants.

</div-h3>

### applyFoldMarkerColors function declaration dropped

<div-h3>

**Issue:** `bun build` reported `Unexpected }` at the start of `applyFoldMarkerColors`. The function body was present but the `function applyFoldMarkerColors(hwnd) {` declaration line was missing — the body appeared as floating top-level statements after `cmdToggleWrap`.

**Solution:** Re-added the function declaration. Root cause was an incomplete edit that wrote the body without the header.

</div-h3>

### Word wrap menu checkmark not initialized

<div-h3>

**Issue:** The Word Wrap menu item showed no checkmark on startup even when `wordwrap=true` was in `config.ini`.

**Root cause:** `applyWordWrap(hSciWnd)` was called from `WM_CREATE`, but `hMainWnd` was still `0n` at that point — `CreateWindowExW` assigns `hMainWnd` only after it returns, but `WM_CREATE` fires during the call. `GetMenu(0n)` returned null, so `CheckMenuItem` was never called.

**Solution:** Pass `hWnd` (the `WM_CREATE` parameter) explicitly to `applyWordWrap(hSciWnd, hWnd)` and use it in place of `hMainWnd` when non-null:
```js
function applyWordWrap(hwnd, hWin) {
  const hMenuBar = User32.GetMenu(hWin || hMainWnd);
  ...
}
```

</div-h3>

### Horizontal scroll width not tracking content

<div-h3>

**Issue:** Horizontal scrollbar did not extend far enough for very long lines (e.g. minified JSON or JSONL files). The scrollbar appeared but could not scroll to the end of long lines.

**Root cause:** Scintilla's default `ScrollWidth` is a fixed pixel value (2000px). It does not grow automatically.

**Solution:**
```js
sciSend(hSciWnd, SCI_SETSCROLLWIDTH, 1, 0);          // reset to 1px base
sciSend(hSciWnd, SCI_SETSCROLLWIDTHTRACKING, 1, 0);  // auto-expand to widest line
```
`SCI_SETSCROLLWIDTHTRACKING` (message 2516) makes Scintilla continuously update the scroll width as content changes.

</div-h3>

### @bun-win32 deep subpath imports break bun --compile

<div-h3>

**Issue:** `bun build --compile` failed with `Could not resolve: "@bun-win32/user32/index.ts"`.

**Root cause:** Imports used the full subpath `@bun-win32/user32/index.ts`, which bypasses the package's `exports` map. The Bun runtime resolves these leniently; the bundler/compiler enforces the exports map strictly.

**Solution:** Changed all three package imports to bare package names (`@bun-win32/user32`, `@bun-win32/kernel32`, `@bun-win32/comdlg32`) so the `"main": "./index.ts"` entry in each package's `exports` is used.

</div-h3>

### Compiled exe cannot find plugins/ or config.ini

<div-h3>

**Issue:** When running `editor.exe`, plugins were not loaded and config was not read.

**Root cause:** `import.meta.dir` inside a compiled Bun exe returns a virtual bundle path (`B:\~BUN\root\...`), not the filesystem directory of the exe. `plugins/` and `config.ini` were being searched inside the bundle.

**Solution:** Derive `APP_DIR` using:
```js
const APP_DIR = dirname(process.execPath.includes('bun.exe')
  ? import.meta.path
  : process.execPath);
```
When `process.execPath` contains `bun.exe` the script is being interpreted — use `import.meta.path`. Otherwise it is a compiled exe — use `process.execPath` (which is the exe's own path). All file paths (`config.ini`, `plugins/`) are resolved relative to `APP_DIR`.

</div-h3>

### Search cursor placement — character vs byte offset

<div-h3>

**Issue:** After selecting a search result, the cursor landed at the wrong position for documents containing multi-byte characters (accented letters, CJK, emoji).

**Root cause:** `getText()` decodes the Scintilla buffer to a JS string, so `RegExp` match indices (`m.index`) are character offsets. `SCI_SETSEL` expects UTF-8 byte offsets. For ASCII-only content these are equal; for any multi-byte character before the match they diverge.

**Solution:** Convert before calling `setSelection`:
```js
const bytePos = Buffer.byteLength(m.input.slice(0, m.index), 'utf8');
api.sci.setSelection(bytePos, bytePos);
```

</div-h3>

</div-h2>

## Current Features

<div-h2>

- **File operations:** New (Ctrl+N), Open (Ctrl+O), Save (Ctrl+S), Save As (Ctrl+Shift+S), Close
- **Syntax highlighting:** JS/TS, C/C++, Python, JSON, Markdown, CSS, HTML, XML, Bash, Batch, SQL, YAML, Lua, Ruby, Rust
- **Themes:** Light (Default), Dark (Dracula), Dark (One Dark), Solarized Light
- **Font:** Configurable face (ChooseFontW dialog) and size (Ctrl+= / Ctrl+-)
- **Word wrap:** Toggle via View → Word Wrap; state persisted in `config.ini`
- **Current-line highlight:** Shallow green background on the caret line (theme-aware via `SCI_SETCARETLINEBACK`)
- **Code folding:** Box-style markers, click margin to collapse/expand, all fold-capable lexers
- **Horizontal scroll:** Auto-expanding scroll width via `SCI_SETSCROLLWIDTHTRACKING`
- **Plugin system:** Drop-in `plugins/*.js`, per-plugin submenus, keyboard shortcuts, events
- **Bundled plugins:** hello (timestamp/case), word-count, search (regex search + replace, Ctrl+F/Ctrl+H), selection-highlight (yellow indicator), json_formatter (stringify/compact/JSONL)
- **Distribution:** `bun run build` → `dist/editor.js` (bundle); `bun run compile` → `editor.exe` (standalone)

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
