# BunSciEditor

A lightweight Win32 text editor built with [Bun](https://bun.sh) FFI and [Scintilla](https://www.scintilla.org/), written entirely in JavaScript. No Electron, no Node.js — just Bun calling Win32 APIs directly.

## Features

<div-h2>

- Syntax highlighting via Scintilla/Lexilla for 20+ languages
- Code folding with box-style fold markers
- Line numbers and margin
- Multiple themes (Light, Dracula, One Dark, Solarized Light)
- Configurable font face and size
- Word wrap toggle
- Plugin system with event hooks and menu extension
- Bundleable to a single `dist/editor.js` via Bun's bundler

</div-h2>

## Requirements

<div-h2>

- [Bun](https://bun.sh) for Windows (`C:\TEMP\bun\bin\bun.exe`)
- `Scintilla.dll` and `Lexilla.dll` in the project root (from the [Scintilla release](https://www.scintilla.org/ScintillaDownload.html))

</div-h2>

## Usage

<div-h2>

```sh
# Open a file
bun.exe editor.js path/to/file.js

# Open with no file (blank document)
bun.exe editor.js
```

### Build a bundled single-file distribution

```sh
bun.exe run build
# Output: dist/editor.js
```

</div-h2>

## Keyboard Shortcuts

<div-h2>

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New file |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl++` / `Ctrl+-` | Increase / decrease font size |

</div-h2>

## Supported Languages

<div-h2>

JavaScript, TypeScript, JSX/TSX, C, C++, Python, JSON, Markdown, CSS, HTML, XML, Bash, Batch, SQL, YAML, Lua, Ruby, Rust

</div-h2>

## Themes

<div-h2>

- Light (Default)
- Dark (Dracula)
- Dark (One Dark)
- Solarized Light

Switch via **View → Theme**.

</div-h2>

## Configuration

<div-h2>

Settings are persisted in `config.ini` next to the executable:

```ini
[editor]
theme=Dark (Dracula)
fontsize=13
fontface=Cascadia Code
wordwrap=false
```

</div-h2>

## Project Structure

<div-h2>

```
editor.js          Main editor — Win32 window, Scintilla setup, menu, event loop
plugin-api.js      Plugin host — PluginAPI class, EventEmitter, plugin loader
win32/
  pointers.ts      ffiPtr, pointerToBigInt helpers
  strings.ts       encodeWide (UTF-16LE buffer encoding)
  wndclass.ts      packWndClassEx struct helper
@bun-win32/        Lazy-loaded Win32 DLL bindings (user32, kernel32, comdlg32)
plugins/           Drop .js files here — loaded automatically on startup
docs/
  design.md        Architecture decisions, known issues, bug history
  plugin-guide.md  Plugin authoring reference
```

</div-h2>

## Plugins

<div-h2>

Drop a `.js` file in the `plugins/` folder. It is loaded automatically at startup.

```js
export default function(api) {
  api.addMenuItem('Insert Date', () => {
    api.sci.replaceSelection(new Date().toISOString());
  });
}
```

See [docs/plugin-guide.md](docs/plugin-guide.md) for the full API reference.

### Bundled plugins

| Plugin | Description |
|---|---|
| `word-count.js` | Shows line / word / character count |
| `json_formatter.js` | Stringify, Compact, and To JSONL operations on JSON |
| `selection-highlight.js` | Highlights all occurrences of the current selection |
| `search.js` | Find and replace |
| `hello.js` | Minimal example plugin |

</div-h2>

## Architecture Notes

<div-h2>

- All Win32 calls go through Bun FFI (`bun:ffi`) — no native addons
- Scintilla is embedded as a DLL; its window class is registered as a side effect of `LoadLibraryW`
- SCNotification structs are read directly from `lParam` via `toArrayBuffer` at known x64 offsets
- Plugin events (`open`, `save`, `change`, `cursorMove`) are dispatched through a shared `EventEmitter`

See [docs/design.md](docs/design.md) for full technical details.

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
