#!/c/TEMP/bun/bin/bun.exe
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer } from 'bun:ffi';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import User32 from '@bun-win32/user32';
import Kernel32 from '@bun-win32/kernel32';
import Comdlg32 from '@bun-win32/comdlg32';
import { ffiPtr } from './win32/pointers.ts';
import { encodeWide } from './win32/strings.ts';
import { packWndClassEx } from './win32/wndclass.ts';
import { pointerToBigInt } from './win32/pointers.ts';
import { PluginAPI, EventEmitter, loadPlugins } from './plugin-api.js';

// Raw user32 for LoadCursorW — the @bun-win32 binding uses FFIType.ptr for lpCursorName
// but MAKEINTRESOURCE values are plain integers, not buffer pointers.
const _user32Raw = dlopen('user32.dll', {
  LoadCursorW: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u64 },
});

// ── Win32 constants ──────────────────────────────────────────────────────────
const CS_HREDRAW          = 0x0002;
const CS_VREDRAW          = 0x0001;
const WS_OVERLAPPEDWINDOW = 0x00CF0000;
const WS_CLIPCHILDREN     = 0x02000000;
const WS_CHILD            = 0x40000000;
const WS_VISIBLE          = 0x10000000;
const WS_VSCROLL          = 0x00200000;
const WS_HSCROLL          = 0x00100000;
const SW_SHOW             = 5;
const PM_REMOVE           = 0x0001;
const WM_CREATE           = 0x0001;
const WM_DESTROY          = 0x0002;
const WM_SIZE             = 0x0005;
const WM_SETFOCUS         = 0x0007;
const WM_CLOSE            = 0x0010;
const WM_QUIT             = 0x0012;
const WM_COMMAND          = 0x0111;
const WM_NOTIFY           = 0x004E;
const CW_USEDEFAULT       = 0x8000_0000;
const IDC_ARROW           = 32512n;
const NULL                = 0n;
const NULL_PTR            = null;
const MF_STRING           = 0x0000;
const MF_POPUP            = 0x0010;
const MF_SEPARATOR        = 0x0800;
const MF_GRAYED           = 0x0001;
const MF_CHECKED          = 0x0008;
const MF_UNCHECKED        = 0x0000;
const MF_BYCOMMAND        = 0x0000;

// ── MSG layout (x64: 48 bytes) ───────────────────────────────────────────────
const MSG_SIZE            = 48;
const MSG_MESSAGE_OFFSET  = 8;

// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 cast to pointer
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4n;

// ── Menu command IDs ─────────────────────────────────────────────────────────
const CMD_NEW       = 100;
const CMD_OPEN      = 101;
const CMD_SAVE      = 102;
const CMD_SAVE_AS   = 103;
const CMD_CLOSE     = 104;
const CMD_FONT_INC  = 105;
const CMD_FONT_DEC  = 106;
const CMD_FONT_FACE = 107;
const CMD_WRAP      = 108;
const CMD_PLUGIN_BASE = 400; // 400..599 reserved for plugin menu items
// Theme command IDs start at 201 — one per theme
const CMD_THEME_BASE = 201;

// ── Accelerator table constants ──────────────────────────────────────────────
// ACCEL struct: fVirt(1) + pad(1) + key(2) + cmd(2) = 6 bytes
const FVIRTKEY  = 0x01;
const FCONTROL  = 0x08;
const ACCEL_SIZE = 6;

// Virtual key codes
const VK_N           = 0x4E;
const VK_O           = 0x4F;
const VK_S           = 0x53;
const VK_OEM_PLUS    = 0xBB; // = / + key
const VK_OEM_MINUS   = 0xBD; // - / _ key
const VK_ADD         = 0x6B; // numpad +
const VK_SUBTRACT    = 0x6D; // numpad -

// ── Scintilla messages ───────────────────────────────────────────────────────
const SCI_SETTEXT         = 2181;
const SCI_GETTEXT         = 2182;
const SCI_GETTEXTLENGTH   = 2183;
const SCI_SETCODEPAGE     = 2037;
const SCI_SETSCROLLWIDTH         = 2274;
const SCI_SETSCROLLWIDTHTRACKING = 2516;
const SCI_SETMARGINTYPEN      = 2240;
const SCI_SETMARGINWIDTHN     = 2242;
const SCI_SETMARGINSENSITIVEN = 2246;
const SCI_SETMARGINMASKN      = 2244;
const SCI_MARKERDEFINE        = 2040;
const SCI_MARKERSETFORE       = 2041;
const SCI_MARKERSETBACK       = 2042;
const SCI_SETPROPERTY         = 4004;
const SCI_TOGGLEFOLD          = 2231;
const SCI_GETFOLDLEVEL        = 2223;
const SCI_LINEFROMPOSITION    = 2166;
const SCI_SETFOLDFLAGS        = 2233;
const SCI_SETAUTOMATICFOLD    = 4221;
const SC_MARGIN_NUMBER        = 1;
const SC_MARGIN_SYMBOL        = 0;
const SC_MASK_FOLDERS         = 0xFE000000;
const SC_FOLDLEVELHEADERFLAG  = 0x2000;
const SC_AUTOMATICFOLD_SHOW   = 1;
const SC_AUTOMATICFOLD_CLICK  = 2;
// Fold marker slot assignments (from SC_MARKNUM_* in Scintilla.h)
const MARKER_FOLDEREND        = 25;
const MARKER_FOLDEROPENMID    = 26;
const MARKER_FOLDERMIDTAIL    = 27;
const MARKER_FOLDERTAIL       = 28;
const MARKER_FOLDERSUB        = 29;
const MARKER_FOLDER           = 30;
const MARKER_FOLDEROPEN       = 31;
// SC_MARK_* symbols (from Scintilla.h)
const SC_MARK_ARROW           = 2;
const SC_MARK_ARROWDOWN       = 6;
const SC_MARK_EMPTY           = 5;
const SC_MARK_VLINE           = 9;
const SC_MARK_LCORNER         = 10;
const SC_MARK_TCORNER         = 11;
const SC_MARK_BOXPLUS         = 12;
const SC_MARK_BOXPLUSCONNECTED  = 13;
const SC_MARK_BOXMINUS        = 14;
const SC_MARK_BOXMINUSCONNECTED = 15;
const SCI_STYLESETSIZE    = 2055;
const SCI_STYLESETFONT    = 2056;
const SCI_STYLESETBOLD    = 2053;
const SCI_TEXTWIDTH       = 2276;
const SCI_SETSAVEPOINT    = 2014;
const SCI_SETILEXER       = 4033;
const SCI_SETKEYWORDS     = 4005;
const SCI_SETWRAPMODE = 2268;
const SC_WRAP_NONE    = 0;
const SC_WRAP_WORD    = 1;
const SCI_STYLESETFORE    = 2051;
const SCI_STYLESETBACK    = 2052;
const SCI_STYLESETEOLFILLED = 2057;
const SCI_SETCARETLINEVISIBLE = 2097;
const SCI_SETCARETLINEBACK    = 2098;
const SCI_COLOURISE       = 4003;
const SCI_STYLECLEARALL   = 2050;
const SC_CP_UTF8          = 65001;
const STYLE_DEFAULT       = 32;
const STYLE_LINENUMBER    = 33;

// cpp lexer style IDs (SCE_C_*)
const SCE_C_DEFAULT        = 0;
const SCE_C_COMMENT        = 1;
const SCE_C_COMMENTLINE    = 2;
const SCE_C_COMMENTDOC     = 3;
const SCE_C_NUMBER         = 4;
const SCE_C_WORD           = 5;  // keywords
const SCE_C_STRING         = 6;
const SCE_C_CHARACTER      = 7;
const SCE_C_UUID           = 8;
const SCE_C_PREPROCESSOR   = 9;
const SCE_C_OPERATOR       = 10;
const SCE_C_IDENTIFIER     = 11;
const SCE_C_STRINGEOL      = 12;
const SCE_C_VERBATIM       = 13;
const SCE_C_REGEX          = 14;
const SCE_C_COMMENTLINEDOC = 15;
const SCE_C_WORD2          = 16; // keywords2 (types, builtins)
const SCE_C_COMMENTDOCKEYWORD = 17;
const SCE_C_GLOBALCLASS    = 19;
const SCE_C_TEMPLATESTRING = 20; // backtick template literals

// Scintilla notification codes inside WM_NOTIFY
const SCN_SAVEPOINTREACHED = 2002;
const SCN_SAVEPOINTLEFT    = 2003;
const SCN_MARGINCLICK      = 2010;
const SCN_UPDATEUI         = 2007;
const SCN_MODIFIED         = 2008;
const SCNOTIFICATION_CODE_OFFSET = 8;
const SC_MOD_INSERTTEXT    = 0x01;
const SC_MOD_DELETETEXT    = 0x02;

// ── JS/TS keyword sets for the cpp lexer ─────────────────────────────────────
const JS_KEYWORDS1 =
  'break case catch class const continue debugger default delete do else ' +
  'export extends false finally for from function get if import in instanceof ' +
  'let new null of package private protected public return set static super ' +
  'switch this throw true try typeof undefined var void while with yield ' +
  'async await enum declare abstract readonly type interface satisfies keyof ' +
  'infer never unknown any';

const JS_KEYWORDS2 =
  'Array Boolean Date Error Function JSON Map Math Number Object Promise ' +
  'RegExp Set String Symbol WeakMap WeakSet WeakRef console process Bun ' +
  'globalThis undefined NaN Infinity parseInt parseFloat isNaN isFinite ' +
  'setTimeout setInterval clearTimeout clearInterval fetch URL URLSearchParams ' +
  'Buffer Uint8Array Int32Array Float64Array Promise';

// ── Language detection ────────────────────────────────────────────────────────
const EXT_LEXER = {
  '.js':   'cpp', '.mjs': 'cpp', '.cjs': 'cpp',
  '.jsx':  'cpp', '.ts':  'cpp', '.tsx': 'cpp',
  '.mts':  'cpp', '.cts': 'cpp',
  '.c':    'cpp', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.h':    'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.py':   'python',
  '.json': 'json', '.jsonc': 'json',
  '.md':   'markdown',
  '.css':  'css',
  '.html': 'hypertext', '.htm': 'hypertext',
  '.xml':  'xml',
  '.sh':   'bash', '.bash': 'bash',
  '.bat':  'batch', '.cmd': 'batch',
  '.sql':  'sql',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.lua':  'lua',
  '.rb':   'ruby',
  '.rs':   'rust',
};

function lexerForPath(path) {
  if (!path) return null;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_LEXER[path.slice(dot).toLowerCase()] ?? null;
}

// COLORREF is 0x00BBGGRR
const rgb = (r, g, b) => r | (g << 8) | (b << 16);

// ── Theme definitions ─────────────────────────────────────────────────────────
const THEMES = {
  'Light (Default)': {
    bg:          rgb(255, 255, 255),
    fg:          rgb(0,   0,   0),
    linenoFg:    rgb(130, 130, 150),
    linoBg:      rgb(240, 240, 245),
    caretLineBg: rgb(232, 248, 232),
    comment:     rgb(0,   128,  0),
    string:      rgb(163,  21,  21),
    keyword:     rgb(0,    0,  255),
    number:      rgb(9,   134, 88),
    type:        rgb(38,  127, 153),
    func:        rgb(121,  94,  38),
    operator:    rgb(0,   0,   0),
    preproc:     rgb(155, 0,   173),
    regex:       rgb(215, 58,  73),
    globalcls:   rgb(38,  127, 153),
  },
  'Dark (Dracula)': {
    bg:          rgb(40,  42,  54),
    fg:          rgb(248, 248, 242),
    linenoFg:    rgb(100, 110, 130),
    linoBg:      rgb(34,  36,  46),
    caretLineBg: rgb(48,  56,  44),
    comment:     rgb(98,  114, 164),
    string:      rgb(241, 250, 140),
    keyword:     rgb(139, 233, 253),
    number:      rgb(189, 147, 249),
    type:        rgb(139, 233, 253),
    func:        rgb(80,  250, 123),
    operator:    rgb(255, 121, 198),
    preproc:     rgb(255, 121, 198),
    regex:       rgb(255, 184, 108),
    globalcls:   rgb(80,  250, 123),
  },
  'Dark (One Dark)': {
    bg:          rgb(40,  44,  52),
    fg:          rgb(171, 178, 191),
    linenoFg:    rgb(90,  99,  116),
    linoBg:      rgb(33,  37,  43),
    caretLineBg: rgb(44,  56,  44),
    comment:     rgb(92,  99,  112),
    string:      rgb(152, 195, 121),
    keyword:     rgb(198, 120, 221),
    number:      rgb(209, 154, 102),
    type:        rgb(229, 192, 123),
    func:        rgb(97,  175, 239),
    operator:    rgb(171, 178, 191),
    preproc:     rgb(224,  108, 117),
    regex:       rgb(86,  182, 194),
    globalcls:   rgb(229, 192, 123),
  },
  'Solarized Light': {
    bg:          rgb(253, 246, 227),
    fg:          rgb(101, 123, 131),
    linenoFg:    rgb(147, 161, 161),
    linoBg:      rgb(238, 232, 213),
    caretLineBg: rgb(235, 245, 220),
    comment:     rgb(147, 161, 161),
    string:      rgb(42,  161, 152),
    keyword:     rgb(133, 153,   0),
    number:      rgb(211, 54,  130),
    type:        rgb(181, 137,   0),
    func:        rgb(38,  139, 210),
    operator:    rgb(101, 123, 131),
    preproc:     rgb(203,  75,  22),
    regex:       rgb(42,  161, 152),
    globalcls:   rgb(181, 137,   0),
  },
};

const THEME_NAMES = Object.keys(THEMES);
let activeTheme = THEME_NAMES[0]; // will be overwritten by config load
let fontSize = 11;                // will be overwritten by config load
let fontFace = 'Consolas';        // will be overwritten by config load
let fontBold  = false;            // will be overwritten by config load
let wordWrap  = false;            // will be overwritten by config load

// fontBuf is rebuilt whenever fontFace changes
let fontBuf = Buffer.from(fontFace + '\0', 'utf8');

function rebuildFontBuf() {
  fontBuf = Buffer.from(fontFace + '\0', 'utf8');
}

// ── config.ini read/write ─────────────────────────────────────────────────────
const APP_DIR     = process.execPath.includes("bun.exe") ? dirname(import.meta.path) : dirname(process.execPath);
const CONFIG_PATH = join(APP_DIR, 'config.ini');

function loadConfig() {
  try {
    const text = readFileSync(CONFIG_PATH, 'utf8');
    const mt = text.match(/^theme\s*=\s*(.+)$/im);
    if (mt) {
      const name = mt[1].trim();
      if (THEMES[name]) activeTheme = name;
    }
    const mf = text.match(/^fontsize\s*=\s*(\d+)$/im);
    if (mf) {
      const size = parseInt(mf[1], 10);
      if (size >= 6 && size <= 72) fontSize = size;
    }
    const mff = text.match(/^fontface\s*=\s*(.+)$/im);
    if (mff) {
      const face = mff[1].trim();
      if (face.length > 0 && face.length <= 31) { fontFace = face; rebuildFontBuf(); }
    }
    const mfb = text.match(/^fontbold\s*=\s*(.+)$/im);
    if (mfb) fontBold = mfb[1].trim() === 'true';
    const mw = text.match(/^wordwrap\s*=\s*(.+)$/im);
    if (mw) wordWrap = mw[1].trim() === 'true';
  } catch {}
}

function saveConfig() {
  writeFileSync(CONFIG_PATH,
    `[editor]\ntheme=${activeTheme}\nfontsize=${fontSize}\nfontface=${fontFace}\nfontbold=${fontBold}\nwordwrap=${wordWrap}\n`, 'utf8');
}

loadConfig();

// ── Apply theme + lexer to Scintilla window ───────────────────────────────────
function applyWordWrap(hwnd, hWin) {
  sciSend(hwnd, SCI_SETWRAPMODE, wordWrap ? SC_WRAP_WORD : SC_WRAP_NONE, 0);
  const hMenuBar = User32.GetMenu(hWin || hMainWnd);
  if (!hMenuBar || hMenuBar === 0n) return;
  const hViewMenu = User32.GetSubMenu(hMenuBar, 1);
  if (!hViewMenu || hViewMenu === 0n) return;
  const MF_BYCOMMAND = 0x0000;
  const MF_CHECKED   = 0x0008;
  const MF_UNCHECKED = 0x0000;
  User32.CheckMenuItem(hViewMenu, CMD_WRAP, MF_BYCOMMAND | (wordWrap ? MF_CHECKED : MF_UNCHECKED));
}

function cmdToggleWrap() {
  wordWrap = !wordWrap;
  applyWordWrap(hSciWnd);
  saveConfig();
}

function applyFoldMarkerColors(hwnd) {
  const t  = THEMES[activeTheme];
  const fg = t.linenoFg;
  const bg = t.linoBg;
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDER,        SC_MARK_BOXPLUS);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDEROPEN,    SC_MARK_BOXMINUS);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDERSUB,     SC_MARK_VLINE);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDERTAIL,    SC_MARK_LCORNER);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDEREND,     SC_MARK_BOXPLUSCONNECTED);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDEROPENMID, SC_MARK_BOXMINUSCONNECTED);
  sciSend(hwnd, SCI_MARKERDEFINE, MARKER_FOLDERMIDTAIL, SC_MARK_TCORNER);
  for (const m of [MARKER_FOLDER, MARKER_FOLDEROPEN, MARKER_FOLDERSUB,
      MARKER_FOLDERTAIL, MARKER_FOLDEREND, MARKER_FOLDEROPENMID, MARKER_FOLDERMIDTAIL]) {
    sciSend(hwnd, SCI_MARKERSETFORE, m, bg);
    sciSend(hwnd, SCI_MARKERSETBACK, m, fg);
  }
}

function applyThemeStyles(hwnd) {
  const t = THEMES[activeTheme];
  // Set all STYLE_DEFAULT attributes before SCI_STYLECLEARALL so font/size propagate
  sciSend(hwnd, SCI_STYLESETFONT, STYLE_DEFAULT, ptr(fontBuf));
  sciSend(hwnd, SCI_STYLESETSIZE, STYLE_DEFAULT, fontSize);
  sciSend(hwnd, SCI_STYLESETBOLD, STYLE_DEFAULT, fontBold ? 1 : 0);
  sciSend(hwnd, SCI_STYLESETFORE, STYLE_DEFAULT, t.fg);
  sciSend(hwnd, SCI_STYLESETBACK, STYLE_DEFAULT, t.bg);
  sciSend(hwnd, SCI_STYLECLEARALL, 0, 0);
  sciSend(hwnd, SCI_STYLESETFORE, STYLE_LINENUMBER, t.linenoFg);
  sciSend(hwnd, SCI_STYLESETBACK, STYLE_LINENUMBER, t.linoBg);
  sciSend(hwnd, SCI_SETCARETLINEBACK, t.caretLineBg, 0);
  sciSend(hwnd, SCI_SETCARETLINEVISIBLE, 1, 0);
  applyFoldMarkerColors(hwnd);
}

function applyCppStyles(hwnd) {
  const t = THEMES[activeTheme];
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_COMMENT,        t.comment);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_COMMENTLINE,    t.comment);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_COMMENTDOC,     t.comment);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_COMMENTLINEDOC, t.comment);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_STRING,         t.string);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_CHARACTER,      t.string);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_TEMPLATESTRING, t.string);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_VERBATIM,       t.string);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_STRINGEOL,      t.preproc);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_NUMBER,         t.number);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_WORD,           t.keyword);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_WORD2,          t.func);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_PREPROCESSOR,   t.preproc);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_OPERATOR,       t.operator);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_REGEX,          t.regex);
  sciSend(hwnd, SCI_STYLESETFORE, SCE_C_GLOBALCLASS,    t.globalcls);
}

// Set the active lexer on the Scintilla window based on a file path.
function applyLexer(hwnd, path) {
  const name = lexerForPath(path);
  const lexerPtr = _lexilla.symbols.CreateLexer(name ?? 'null');
  sciSend(hwnd, SCI_SETILEXER, 0, BigInt(lexerPtr));

  // Enable folding for all lexers that support it
  const foldKey = Buffer.from('fold\0', 'utf8');
  const foldVal = Buffer.from('1\0', 'utf8');
  sciSend(hwnd, SCI_SETPROPERTY, ptr(foldKey), BigInt(ptr(foldVal)));

  applyThemeStyles(hwnd);
  if (name === 'cpp') {
    applyCppStyles(hwnd);
    const kw1Buf = Buffer.from(JS_KEYWORDS1 + '\0', 'utf8');
    const kw2Buf = Buffer.from(JS_KEYWORDS2 + '\0', 'utf8');
    sciSend(hwnd, SCI_SETKEYWORDS, 0, ptr(kw1Buf));
    sciSend(hwnd, SCI_SETKEYWORDS, 1, ptr(kw2Buf));
  }

  sciSend(hwnd, SCI_COLOURISE, 0, -1);
}

function setFontSize(hwnd, delta) {
  fontSize = Math.max(6, Math.min(72, fontSize + delta));
  applyLexer(hwnd, currentPath);
}

// ── Font face dialog (ChooseFontW) ────────────────────────────────────────────
// LOGFONTW layout (92 bytes, no pointer-sized fields):
//   lfHeight(4) lfWidth(4) lfEscapement(4) lfOrientation(4) lfWeight(4)
//   lfItalic(1) lfUnderline(1) lfStrikeOut(1) lfCharSet(1)
//   lfOutPrecision(1) lfClipPrecision(1) lfQuality(1) lfPitchAndFamily(1)
//   lfFaceName(32×2=64 bytes UTF-16)
const LOGFONTW_SIZE  = 92;
const LF_FACENAME_OFF = 28; // byte offset of lfFaceName in LOGFONTW

// CHOOSEFONTW layout on x64 (104 bytes):
//   lStructSize(4) pad(4) hwndOwner(8) hDC(8) lpLogFont(8)
//   iPointSize(4) Flags(4) rgbColors(4) pad(4) lCustData(8)
//   lpfnHook(8) lpTemplateName(8) hInstance(8) lpszStyle(8)
//   nFontType(2) pad(2) nSizeMin(4) nSizeMax(4)  → 104 bytes
const CHOOSEFONTW_SIZE = 104;
const CF_SCREENFONTS       = 0x00000001;
const CF_INITTOLOGFONTSTRUCT = 0x00000040;
const CF_TTONLY            = 0x00040000;
const CF_LIMITSIZE         = 0x00002000;

function cmdFontFace(hwnd) {
  const logFont = Buffer.alloc(LOGFONTW_SIZE);
  // Pre-fill current font face and size so the dialog opens on the current selection
  // lfHeight: negative of point size in logical units (use -fontSize for points)
  logFont.writeInt32LE(-fontSize, 0);
  // lfWeight: 400 = FW_NORMAL, 700 = FW_BOLD
  logFont.writeInt32LE(fontBold ? 700 : 400, 16);
  // lfFaceName — current font face as UTF-16
  logFont.write(fontFace, LF_FACENAME_OFF, 'utf16le');

  const cf = Buffer.alloc(CHOOSEFONTW_SIZE);
  const view = new DataView(cf.buffer);
  view.setUint32(0, CHOOSEFONTW_SIZE, true);               // lStructSize
  view.setBigUint64(8, hwnd, true);                        // hwndOwner
  view.setBigUint64(24, pointerToBigInt(logFont), true);   // lpLogFont
  view.setUint32(36, CF_SCREENFONTS | CF_INITTOLOGFONTSTRUCT | CF_TTONLY, true); // Flags

  if (!Comdlg32.ChooseFontW(ffiPtr(cf))) return; // user cancelled

  // Read back face name, point size, and weight from LOGFONTW
  const face = logFont.slice(LF_FACENAME_OFF).toString('utf16le').replace(/\0.*$/, '');
  const ptSize = view.getInt32(32, true); // iPointSize (in tenths of a point)
  const newSize = Math.max(6, Math.min(72, Math.round(ptSize / 10)));
  const weight = logFont.readInt32LE(16); // lfWeight: >=600 = bold

  fontFace = face || fontFace;
  fontSize = newSize;
  fontBold  = weight >= 600;
  rebuildFontBuf();
  applyLexer(hwnd, currentPath);
}

const sciSend = (hwnd, msg, wParam, lParam = 0n) =>
  User32.SendMessageW(hwnd, msg, BigInt(wParam), BigInt(lParam));

// ── OPENFILENAMEW helpers ────────────────────────────────────────────────────
const OPENFILENAMEW_SIZE = 152;
const PATH_BUF_CHARS     = 1024;
const TITLE_BUF_CHARS    = 260;

const ALL_FILTER = Buffer.from('All Files (*.*)\0*.*\0\0', 'utf16le');

function packOFN(owner, fileBuf, fileTitleBuf, titleBuf, initialDirBuf, flags, filterBuf) {
  const ofn  = Buffer.alloc(OPENFILENAMEW_SIZE);
  const view = new DataView(ofn.buffer);
  view.setUint32(0x00, OPENFILENAMEW_SIZE, true);
  view.setBigUint64(0x08, owner, true);
  view.setBigUint64(0x18, pointerToBigInt(filterBuf), true);
  view.setUint32(0x2c, 1, true);
  view.setBigUint64(0x30, pointerToBigInt(fileBuf), true);
  view.setUint32(0x38, PATH_BUF_CHARS, true);
  view.setBigUint64(0x40, pointerToBigInt(fileTitleBuf), true);
  view.setUint32(0x48, TITLE_BUF_CHARS, true);
  if (initialDirBuf) view.setBigUint64(0x50, pointerToBigInt(initialDirBuf), true);
  view.setBigUint64(0x58, pointerToBigInt(titleBuf), true);
  view.setUint32(0x60, flags, true);
  return ofn;
}

const readPath = (buf) => buf.toString('utf16le').replace(/\0.*$/, '');

function showOpenDialog(owner) {
  const fileBuf     = Buffer.alloc(PATH_BUF_CHARS * 2);
  const fileTitleBuf = Buffer.alloc(TITLE_BUF_CHARS * 2);
  const titleBuf    = encodeWide('Open File');
  const dirBuf      = encodeWide(process.cwd());
  const OFN_EXPLORER     = 0x0008_0000;
  const OFN_FILEMUSTEXIST = 0x0000_1000;
  const OFN_PATHMUSTEXIST = 0x0000_0800;
  const OFN_HIDEREADONLY  = 0x0000_0004;
  const ofn = packOFN(owner, fileBuf, fileTitleBuf, titleBuf, dirBuf,
    OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY, ALL_FILTER);
  if (!Comdlg32.GetOpenFileNameW(ffiPtr(ofn))) return null;
  return readPath(fileBuf);
}

function showSaveAsDialog(owner, currentPath) {
  const fileBuf      = Buffer.alloc(PATH_BUF_CHARS * 2);
  const fileTitleBuf = Buffer.alloc(TITLE_BUF_CHARS * 2);
  const titleBuf     = encodeWide('Save As');
  const dirBuf       = currentPath
    ? encodeWide(currentPath.replace(/[\\/][^\\/]+$/, '') || process.cwd())
    : encodeWide(process.cwd());
  if (currentPath) fileBuf.write(currentPath, 0, 'utf16le');
  const OFN_EXPLORER       = 0x0008_0000;
  const OFN_OVERWRITEPROMPT = 0x0000_0002;
  const OFN_HIDEREADONLY   = 0x0000_0004;
  const OFN_PATHMUSTEXIST  = 0x0000_0800;
  const ofn = packOFN(owner, fileBuf, fileTitleBuf, titleBuf, dirBuf,
    OFN_EXPLORER | OFN_OVERWRITEPROMPT | OFN_HIDEREADONLY | OFN_PATHMUSTEXIST, ALL_FILTER);
  if (!Comdlg32.GetSaveFileNameW(ffiPtr(ofn))) return null;
  return readPath(fileBuf);
}

// ── Enable Per-Monitor DPI awareness ─────────────────────────────────────────
User32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

// ── Load Scintilla.dll (registers 'Scintilla' window class as side effect) ───
const scintillaDllBuf = encodeWide('./Scintilla.dll');
const hScintilla = Kernel32.LoadLibraryW(ffiPtr(scintillaDllBuf));
if (!hScintilla || hScintilla === 0n) {
  console.error('Failed to load Scintilla.dll');
  process.exit(1);
}

// ── Load Lexilla.dll for syntax highlighting ─────────────────────────────────
const _lexilla = dlopen('./Lexilla.dll', {
  CreateLexer: { args: [FFIType.cstring], returns: FFIType.ptr },
});

// ── App state ────────────────────────────────────────────────────────────────
let hMainWnd    = 0n;
let hSciWnd     = 0n;
let running     = true;
let currentPath = null;
let isDirty     = false;

// ── Plugin system ─────────────────────────────────────────────────────────────
const pluginEmitter = new EventEmitter();
let   pluginAPIs    = []; // populated after loadPlugins()

// Factory: create a PluginAPI bound to the current editor state
function makePluginAPI(pluginName) {
  const api = new PluginAPI();
  api._pluginName = pluginName ?? '';
  api._rawSend = (msg, wParam, lParam = 0n) => sciSend(hSciWnd, msg, wParam, lParam);
  api._emitter = pluginEmitter;
  api._hMain   = () => hMainWnd;
  api._state   = {
    get currentPath() { return currentPath; },
    get isDirty()     { return isDirty; },
    get activeTheme() { return activeTheme; },
    get fontSize()    { return fontSize; },
  };
  return api;
}

// Debounce helper for SCN_MODIFIED
let _changeTimer = null;
function emitChange() {
  if (_changeTimer) clearTimeout(_changeTimer);
  _changeTimer = setTimeout(() => { _changeTimer = null; pluginEmitter.emit('change'); }, 150);
}

const sciClassBuf = encodeWide('Scintilla');
const welcomeBuf  = Buffer.from('// Bun Scintilla Editor\n// Win32 FFI \xB7 bun:ffi\n\n\0', 'utf8');

// ── Title helper ─────────────────────────────────────────────────────────────
function refreshTitle() {
  const name = currentPath ?? 'Untitled';
  const dirty = isDirty ? ' *' : '';
  const buf = encodeWide(`BunSciEditor - ${name}${dirty}`);
  User32.SetWindowTextW(hMainWnd, ffiPtr(buf));
}

// ── Get text from Scintilla ───────────────────────────────────────────────────
function getSciText() {
  const len = Number(sciSend(hSciWnd, SCI_GETTEXTLENGTH, 0, 0));
  const buf = Buffer.alloc(len + 1);
  sciSend(hSciWnd, SCI_GETTEXT, len + 1, ptr(buf));
  return buf.toString('utf8', 0, len);
}

// ── File operations ──────────────────────────────────────────────────────────
function cmdNew() {
  if (isDirty) {
    const MB_YESNOCANCEL = 3, MB_ICONQUESTION = 0x20;
    const titleBuf = encodeWide('Unsaved Changes');
    const textBuf  = encodeWide('Save changes before creating a new file?');
    const r = Number(User32.MessageBoxW(hMainWnd, ffiPtr(textBuf), ffiPtr(titleBuf), MB_YESNOCANCEL | MB_ICONQUESTION));
    if (r === 2) return;       // Cancel
    if (r === 6) cmdSave();    // Yes
  }
  sciSend(hSciWnd, SCI_SETTEXT, 0, ptr(Buffer.from('\0')));
  applyLexer(hSciWnd, null);
  sciSend(hSciWnd, SCI_SETSAVEPOINT, 0, 0);
  currentPath = null;
  isDirty = false;
  refreshTitle();
  pluginEmitter.emit('open', null);
}
function cmdOpenPath(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const buf  = Buffer.from(text + '\0', 'utf8');
    sciSend(hSciWnd, SCI_SETTEXT, 0, ptr(buf));
    applyLexer(hSciWnd, path);
    sciSend(hSciWnd, SCI_SETSAVEPOINT, 0, 0);
    currentPath = path;
    isDirty = false;
    refreshTitle();
    pluginEmitter.emit('open', path);
  } catch (e) {
    console.error('Open failed:', e.message);
  }
}

function cmdOpen() {
  const path = showOpenDialog(hMainWnd);
  if (!path) return;
  cmdOpenPath(path);
}

function cmdSave() {
  if (!currentPath) { cmdSaveAs(); return; }
  try {
    writeFileSync(currentPath, getSciText(), 'utf8');
    sciSend(hSciWnd, SCI_SETSAVEPOINT, 0, 0);
    isDirty = false;
    refreshTitle();
    pluginEmitter.emit('save', currentPath);
  } catch (e) {
    console.error('Save failed:', e.message);
  }
}

function cmdSaveAs() {
  const path = showSaveAsDialog(hMainWnd, currentPath);
  if (!path) return;
  try {
    writeFileSync(path, getSciText(), 'utf8');
    sciSend(hSciWnd, SCI_SETSAVEPOINT, 0, 0);
    currentPath = path;
    isDirty = false;
    refreshTitle();
    pluginEmitter.emit('save', currentPath);
  } catch (e) {
    console.error('Save As failed:', e.message);
  }
}

// Returns false if the user cancelled (caller should abort the close)
function promptSaveIfDirty() {
  if (!isDirty) return true;
  const name   = currentPath ?? 'Untitled';
  const textBuf = encodeWide(`"${name}" has unsaved changes.\nDo you want to save before closing?`);
  const capBuf  = encodeWide('BunSciEditor');
  const MB_YESNOCANCEL  = 0x00000003;
  const MB_ICONQUESTION = 0x00000020;
  const result = User32.MessageBoxW(hMainWnd, ffiPtr(textBuf), ffiPtr(capBuf), MB_YESNOCANCEL | MB_ICONQUESTION);
  if (result === 6) { cmdSave(); return !isDirty; } // Yes — save, then close only if save succeeded
  if (result === 7) return true;                     // No  — discard and close
  return false;                                      // Cancel
}

// ── Build accelerator table ───────────────────────────────────────────────────
function buildAccelTable() {
  const staticEntries = [
    [FVIRTKEY | FCONTROL,        VK_N,         CMD_NEW],
    [FVIRTKEY | FCONTROL,        VK_O,         CMD_OPEN],
    [FVIRTKEY | FCONTROL,        VK_S,         CMD_SAVE],
    [FVIRTKEY | FCONTROL | 0x04, VK_S,         CMD_SAVE_AS],  // Ctrl+Shift+S
    [FVIRTKEY | FCONTROL,        VK_OEM_PLUS,  CMD_FONT_INC], // Ctrl+=
    [FVIRTKEY | FCONTROL,        VK_ADD,       CMD_FONT_INC], // Ctrl+numpad+
    [FVIRTKEY | FCONTROL,        VK_OEM_MINUS, CMD_FONT_DEC], // Ctrl+-
    [FVIRTKEY | FCONTROL,        VK_SUBTRACT,  CMD_FONT_DEC], // Ctrl+numpad-
  ];

  // Collect plugin shortcut entries
  const pluginEntries = [];
  let cmdIndex = 0;
  for (const api of pluginAPIs) {
    for (const item of api._menuItems) {
      if (item.shortcut) {
        const accel = parseShortcut(item.shortcut);
        if (accel) pluginEntries.push([accel.fVirt, accel.key, CMD_PLUGIN_BASE + cmdIndex]);
      }
      cmdIndex++;
    }
  }

  const entries = [...staticEntries, ...pluginEntries];
  const buf = Buffer.alloc(ACCEL_SIZE * entries.length);
  entries.forEach(([virt, key, cmd], i) => {
    buf.writeUInt8(virt,  i * ACCEL_SIZE);
    buf.writeUInt16LE(key, i * ACCEL_SIZE + 2);
    buf.writeUInt16LE(cmd, i * ACCEL_SIZE + 4);
  });
  return User32.CreateAcceleratorTableW(ffiPtr(buf), entries.length);
}

// Parse a shortcut string like 'Ctrl+Shift+W' into { fVirt, key }
function parseShortcut(shortcut) {
  const parts = shortcut.split('+').map(s => s.trim().toLowerCase());
  let fVirt = FVIRTKEY;
  if (parts.includes('ctrl'))  fVirt |= FCONTROL;
  if (parts.includes('shift')) fVirt |= 0x04; // FSHIFT
  if (parts.includes('alt'))   fVirt |= 0x10; // FALT
  const keyPart = parts[parts.length - 1];
  let key = 0;
  if (keyPart.length === 1) {
    key = keyPart.toUpperCase().charCodeAt(0);
  } else if (keyPart === '=') {
    key = 0xBB;
  } else if (keyPart === '-') {
    key = 0xBD;
  } else {
    return null; // unsupported key name
  }
  return { fVirt, key };
}

// ── Build menu bar ────────────────────────────────────────────────────────────
// Label buffers must stay alive for the lifetime of the menu.
const _menuLabels = [];
function menuLabel(text) {
  const buf = encodeWide(text);
  _menuLabels.push(buf);
  return ffiPtr(buf);
}

function buildMenuBar(hwnd) {
  const hMenuBar    = User32.CreateMenu();
  const hFileMenu   = User32.CreatePopupMenu();
  const hViewMenu   = User32.CreatePopupMenu();
  const hThemeMenu  = User32.CreatePopupMenu();

  User32.AppendMenuW(hFileMenu, MF_STRING,    BigInt(CMD_NEW),     menuLabel('&New\tCtrl+N'));
  User32.AppendMenuW(hFileMenu, MF_STRING,    BigInt(CMD_OPEN),    menuLabel('&Open...\tCtrl+O'));
  User32.AppendMenuW(hFileMenu, MF_SEPARATOR, 0n,                  null);
  User32.AppendMenuW(hFileMenu, MF_STRING,    BigInt(CMD_SAVE),    menuLabel('&Save\tCtrl+S'));
  User32.AppendMenuW(hFileMenu, MF_STRING,    BigInt(CMD_SAVE_AS), menuLabel('Save &As...\tCtrl+Shift+S'));
  User32.AppendMenuW(hFileMenu, MF_SEPARATOR, 0n,                  null);
  User32.AppendMenuW(hFileMenu, MF_STRING,    BigInt(CMD_CLOSE),   menuLabel('&Close'));

  // Theme radio items
  for (let i = 0; i < THEME_NAMES.length; i++) {
    User32.AppendMenuW(hThemeMenu, MF_STRING, BigInt(CMD_THEME_BASE + i), menuLabel(THEME_NAMES[i]));
  }

  User32.AppendMenuW(hViewMenu, MF_STRING,    BigInt(CMD_FONT_FACE), menuLabel('&Font...'));
  User32.AppendMenuW(hViewMenu, MF_SEPARATOR, 0n,                    null);
  User32.AppendMenuW(hViewMenu, MF_STRING,    BigInt(CMD_WRAP),      menuLabel('&Word Wrap'));
  User32.AppendMenuW(hViewMenu, MF_SEPARATOR, 0n,                    null);
  User32.AppendMenuW(hViewMenu, MF_POPUP,     hThemeMenu,            menuLabel('&Theme'));

  User32.AppendMenuW(hMenuBar, MF_POPUP, hFileMenu, menuLabel('&File'));
  User32.AppendMenuW(hMenuBar, MF_POPUP, hViewMenu, menuLabel('&View'));
  // Plugins popup is added later by rebuildPluginsMenu() after plugins load
  User32.SetMenu(hwnd, hMenuBar);
}

let hMenuBarGlobal = 0n;

function updateThemeCheckmarks() {
  const hMenu = User32.GetMenu(hMainWnd);
  if (!hMenu) return;
  for (let i = 0; i < THEME_NAMES.length; i++) {
    const flag = THEME_NAMES[i] === activeTheme ? MF_BYCOMMAND | MF_CHECKED : MF_BYCOMMAND | MF_UNCHECKED;
    User32.CheckMenuItem(hMenu, CMD_THEME_BASE + i, flag);
  }
}

// ── Plugin menu helpers ───────────────────────────────────────────────────────
// Flat ordered list matching CMD_PLUGIN_BASE + index → item
let _allPluginMenuItems = []; // { label, shortcut, fn }

function rebuildPluginsMenu() {
  _allPluginMenuItems = pluginAPIs.flatMap(api => api._menuItems);
  if (_allPluginMenuItems.length === 0) return;

  const hMenuBar = User32.GetMenu(hMainWnd);
  if (!hMenuBar || hMenuBar === 0n) return;

  const hPlugMenu = User32.CreatePopupMenu();
  let globalIndex = 0;
  let letterCode  = 97; // 'a'

  const nextLetter = () => letterCode <= 122 ? String.fromCharCode(letterCode++) : '';

  for (const api of pluginAPIs) {
    if (api._menuItems.length === 0) continue;
    const pluginTitle = api._pluginName.replace(/[_-]/g, ' ');
    const letter = nextLetter();
    const accessPrefix = letter ? `&${letter} ` : '';

    if (api._menuItems.length === 1) {
      const item = api._menuItems[0];
      const label = item.shortcut
        ? `${accessPrefix}${pluginTitle}\t${item.shortcut}`
        : `${accessPrefix}${pluginTitle}`;
      User32.AppendMenuW(hPlugMenu, MF_STRING, BigInt(CMD_PLUGIN_BASE + globalIndex), menuLabel(label));
      globalIndex++;
    } else {
      const hSub = User32.CreatePopupMenu();
      for (const item of api._menuItems) {
        const label = item.shortcut ? `${item.label}\t${item.shortcut}` : item.label;
        User32.AppendMenuW(hSub, MF_STRING, BigInt(CMD_PLUGIN_BASE + globalIndex), menuLabel(label));
        globalIndex++;
      }
      User32.AppendMenuW(hPlugMenu, MF_POPUP, hSub, menuLabel(`${accessPrefix}${pluginTitle}`));
    }
  }

  // Remove old Plugins menu if present (position 2), then insert the popup
  const MF_BYPOSITION = 0x00000400;
  User32.DeleteMenu(hMenuBar, 2, MF_BYPOSITION);
  User32.InsertMenuW(hMenuBar, 2, MF_BYPOSITION | MF_POPUP, hPlugMenu, menuLabel('&Plugins'));
  User32.DrawMenuBar(hMainWnd);
}

function dispatchPluginMenuItem(index) {
  const item = _allPluginMenuItems[index];
  if (item) try { item.fn(); } catch (e) { console.error('[plugin menu]', e.message); }
}

// ── Scintilla child: create + configure ──────────────────────────────────────
function createScintillaEditor(parentHwnd) {
  hSciWnd = User32.CreateWindowExW(
    0, ffiPtr(sciClassBuf), NULL_PTR,
    WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_HSCROLL,
    0, 0, 100, 100,
    parentHwnd, NULL, NULL, NULL_PTR,
  );
  if (!hSciWnd || hSciWnd === 0n) throw new Error('CreateWindowExW(Scintilla) failed');

  sciSend(hSciWnd, SCI_SETCODEPAGE, SC_CP_UTF8, 0);

  // Apply theme baseline — sets font, size, colors, and propagates via SCI_STYLECLEARALL
  applyThemeStyles(hSciWnd);

  sciSend(hSciWnd, SCI_SETMARGINTYPEN,  0, SC_MARGIN_NUMBER);
  const rulerBuf = Buffer.from('9999\0', 'utf8');
  const rulerWidth = Number(sciSend(hSciWnd, SCI_TEXTWIDTH, STYLE_LINENUMBER, ptr(rulerBuf)));
  sciSend(hSciWnd, SCI_SETMARGINWIDTHN, 0, rulerWidth + 4);

  setupFolding(hSciWnd);
  sciSend(hSciWnd, SCI_SETSCROLLWIDTH, 1, 0);
  sciSend(hSciWnd, SCI_SETSCROLLWIDTHTRACKING, 1, 0);
  sciSend(hSciWnd, SCI_SETWRAPMODE, wordWrap ? SC_WRAP_WORD : SC_WRAP_NONE, 0);

  sciSend(hSciWnd, SCI_SETTEXT, 0, ptr(welcomeBuf));
  User32.SetFocus(hSciWnd);
}

function setupFolding(hwnd) {
  sciSend(hwnd, SCI_SETMARGINTYPEN,      2, SC_MARGIN_SYMBOL);
  sciSend(hwnd, SCI_SETMARGINWIDTHN,     2, 14);
  sciSend(hwnd, SCI_SETMARGINSENSITIVEN, 2, 1);
  sciSend(hwnd, SCI_SETMARGINMASKN,      2, SC_MASK_FOLDERS);
  applyFoldMarkerColors(hwnd);
}

// ── Resize Scintilla to fill client area ────────────────────────────────────
function layoutEditor(parentHwnd) {
  if (!hSciWnd || hSciWnd === 0n) return;
  const rect = Buffer.alloc(16);
  if (!User32.GetClientRect(parentHwnd, ffiPtr(rect))) return;
  const width  = rect.readInt32LE(8)  - rect.readInt32LE(0);
  const height = rect.readInt32LE(12) - rect.readInt32LE(4);
  User32.MoveWindow(hSciWnd, 0, 0, width, height, 1);
}

// ── WndProc ──────────────────────────────────────────────────────────────────
const wndProc = new JSCallback(
  (hWnd, msg, wParam, lParam) => {
    switch (msg) {
      case WM_CREATE:
        createScintillaEditor(hWnd);
        buildMenuBar(hWnd);
        applyWordWrap(hSciWnd, hWnd);
        return 0n;

      case WM_SIZE:
        layoutEditor(hWnd);
        return 0n;

      case WM_SETFOCUS:
        if (hSciWnd && hSciWnd !== 0n) User32.SetFocus(hSciWnd);
        return 0n;

      case WM_COMMAND: {
        const cmdId = Number(wParam & 0xffffn);
        switch (cmdId) {
          case CMD_NEW:     cmdNew();    break;
          case CMD_OPEN:    cmdOpen();   break;
          case CMD_SAVE:    cmdSave();   break;
          case CMD_SAVE_AS: cmdSaveAs(); break;
          case CMD_FONT_INC:  setFontSize(hSciWnd, +1); break;
          case CMD_FONT_DEC:  setFontSize(hSciWnd, -1); break;
          case CMD_FONT_FACE: cmdFontFace(hMainWnd);    break;
          case CMD_WRAP:      cmdToggleWrap();           break;
          case CMD_CLOSE:
            if (promptSaveIfDirty()) User32.DestroyWindow(hWnd);
            break;
          default:
            if (cmdId >= CMD_THEME_BASE && cmdId < CMD_THEME_BASE + THEME_NAMES.length) {
              activeTheme = THEME_NAMES[cmdId - CMD_THEME_BASE];
              saveConfig();
              applyLexer(hSciWnd, currentPath);
              updateThemeCheckmarks();
            } else if (cmdId >= CMD_PLUGIN_BASE && cmdId < CMD_PLUGIN_BASE + 200) {
              dispatchPluginMenuItem(cmdId - CMD_PLUGIN_BASE);
            }
            break;
        }
        return 0n;
      }

      case WM_NOTIFY: {
        // NMHDR layout on x64: hwndFrom(8) + idFrom(8) + code(4) → code at byte offset 16
        const code = new DataView(toArrayBuffer(lParam, 16, 4)).getInt32(0, true);
        if (code === SCN_SAVEPOINTLEFT) {
          isDirty = true;
          refreshTitle();
        } else if (code === SCN_SAVEPOINTREACHED) {
          isDirty = false;
          refreshTitle();
        } else if (code === SCN_MODIFIED) {
          // offset 28: modificationType (4 bytes)
          const modType = new DataView(toArrayBuffer(lParam, 28, 4)).getInt32(0, true);
          if (modType & (SC_MOD_INSERTTEXT | SC_MOD_DELETETEXT)) emitChange();
        } else if (code === SCN_UPDATEUI) {
          pluginEmitter.emit('cursorMove');
        } else if (code === SCN_MARGINCLICK) {
          const margin   = new DataView(toArrayBuffer(lParam, 112, 4)).getInt32(0, true);
          const position = Number(new DataView(toArrayBuffer(lParam, 24, 8)).getBigInt64(0, true));
          const line     = Number(sciSend(hSciWnd, SCI_LINEFROMPOSITION, position, 0));
          if (margin === 2) sciSend(hSciWnd, SCI_TOGGLEFOLD, line, 0);
        }
        return 0n;
      }
      case WM_CLOSE:
        if (!promptSaveIfDirty()) return 0n; // user cancelled
        pluginEmitter.emit('close', currentPath);
        User32.DestroyWindow(hWnd);
        return 0n;

      case WM_DESTROY:
        saveConfig();
        User32.PostQuitMessage(0);
        return 0n;

      default:
        return User32.DefWindowProcW(hWnd, msg, wParam, lParam);
    }
  },
  { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' },
);

// ── Register window class ────────────────────────────────────────────────────
const classNameBuf = encodeWide('BunScintillaEditor');
const hCursor      = _user32Raw.symbols.LoadCursorW(0n, IDC_ARROW);

const wndClassBuf = packWndClassEx(
  wndProc.ptr,
  ffiPtr(classNameBuf),
  CS_HREDRAW | CS_VREDRAW,
  BigInt(6), // (HBRUSH)(COLOR_WINDOW + 1)
);
wndClassBuf.writeBigUInt64LE(hCursor, 40);

const atom = User32.RegisterClassExW(ffiPtr(wndClassBuf));
if (!atom) {
  console.error('RegisterClassExW failed');
  wndProc.close();
  process.exit(1);
}

// ── Create main window ────────────────────────────────────────────────────────
const titleBuf = encodeWide('Bun Scintilla Editor');

hMainWnd = User32.CreateWindowExW(
  0,
  ffiPtr(classNameBuf),
  ffiPtr(titleBuf),
  WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
  CW_USEDEFAULT, CW_USEDEFAULT,
  900, 650,
  NULL, NULL, NULL,
  NULL_PTR,
);

if (!hMainWnd || hMainWnd === 0n) {
  console.error('CreateWindowExW failed');
  wndProc.close();
  process.exit(1);
}

User32.ShowWindow(hMainWnd, SW_SHOW);
User32.UpdateWindow(hMainWnd);

// hMainWnd is valid now — tick the active theme and open any CLI-supplied file
updateThemeCheckmarks();
const argFile = process.argv[2];
if (argFile) cmdOpenPath(argFile);

// Load plugins — must run before pump starts (we're already in async top-level)
pluginAPIs = await loadPlugins(join(APP_DIR, 'plugins'), makePluginAPI);
rebuildPluginsMenu();

const hAccel = buildAccelTable();
console.log('Editor running. Close the window to exit.');

// ── Non-blocking PeekMessage pump ────────────────────────────────────────────
const msgBuf = Buffer.alloc(MSG_SIZE);

while (running) {
  while (User32.PeekMessageW(ffiPtr(msgBuf), 0n, 0, 0, PM_REMOVE) !== 0) {
    if (msgBuf.readUInt32LE(MSG_MESSAGE_OFFSET) === WM_QUIT) {
      running = false;
      break;
    }
    // Accelerators must be checked before TranslateMessage
    if (hAccel && User32.TranslateAcceleratorW(hMainWnd, hAccel, ffiPtr(msgBuf)) !== 0) {
      continue;
    }
    User32.TranslateMessage(ffiPtr(msgBuf));
    User32.DispatchMessageW(ffiPtr(msgBuf));
  }
  if (running) await Bun.sleep(1);
}

wndProc.close();
console.log('Editor closed.');
