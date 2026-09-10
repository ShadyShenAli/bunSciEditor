#!/c/TEMP/bun/bin/bun.exe
import { ptr, JSCallback } from 'bun:ffi';
import { readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import User32 from '@bun-win32/user32';
import { ffiPtr, pointerToBigInt } from './win32/pointers.ts';
import { encodeWide } from './win32/strings.ts';

// ── EventEmitter ──────────────────────────────────────────────────────────────
export class EventEmitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, []);
    this.#handlers.get(event).push(fn);
  }

  off(event, fn) {
    const arr = this.#handlers.get(event);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }

  emit(event, ...args) {
    const arr = this.#handlers.get(event);
    if (!arr) return;
    for (const fn of arr.slice()) {
      try { fn(...args); } catch (e) { console.error(`[plugin event ${event}]`, e.message); }
    }
  }
}

// ── Scintilla message numbers used by the API ─────────────────────────────────
const SCI_GETTEXT         = 2182;
const SCI_GETTEXTLENGTH   = 2183;
const SCI_SETTEXT         = 2181;
const SCI_GETCURRENTPOS   = 2008;
const SCI_GETLINECOUNT    = 2154;
const SCI_GETLINE         = 2153;
const SCI_LINELENGTH      = 2350;
const SCI_GOTOLINE        = 2024;
const SCI_SETSEL          = 2160;
const SCI_GETSELTEXT      = 2161;
const SCI_REPLACESEL      = 2170;
const SCI_APPENDTEXT      = 2282;
const SCI_LINEFROMPOSITION   = 2166;
const SCI_POSITIONFROMLINE   = 2167;
const SCI_GETLINEENDPOSITION = 2136;
const SCI_GETSELECTIONSTART  = 2143;
const SCI_GETSELECTIONEND    = 2144;
const SCI_GETLINEINDENTATION = 2127;
const SCI_SETREADONLY        = 2171;
const SCI_GETREADONLY        = 2140;
const SCI_WORDSTARTPOSITION  = 2266;
const SCI_WORDENDPOSITION    = 2267;
const SCI_INDICSETSTYLE      = 2080;
const SCI_INDICSETFORE       = 2082;
const SCI_INDICSETALPHA      = 2523;
const SCI_INDICSETUNDER      = 2510;
const SCI_SETINDICATORCURRENT = 2500;
const SCI_INDICATORCLEARRANGE = 2505;
const SCI_INDICATORFILLRANGE  = 2504;
const SCI_FINDTEXT           = 2150;
const SCFIND_MATCHCASE       = 0x4;
const SCFIND_WHOLEWORD       = 0x2;
const SCFIND_REGEXP          = 0x800000;

// SCI_GETTEXTRANGE uses a Sci_TextRange struct: {min(8), max(8), buf(8)} = 24 bytes
function sciGetTextRange(rawSend, start, end) {
  const len = end - start + 1;
  const outBuf = Buffer.alloc(len + 1);
  const rangeStruct = Buffer.alloc(24);
  const view = new DataView(rangeStruct.buffer);
  view.setBigInt64(0, BigInt(start), true);
  view.setBigInt64(8, BigInt(end), true);
  view.setBigUint64(16, pointerToBigInt(outBuf), true);
  rawSend(2162, 0, ptr(rangeStruct)); // SCI_GETTEXTRANGE = 2162
  return outBuf.toString('utf8').replace(/\0.*$/, '');
}

// ── Prompt dialog (DLGTEMPLATE packed in Buffer) ──────────────────────────────
// Dialog layout:
//   DLGTEMPLATE:  style(4) exStyle(4) cDlgItems(2) x(2) y(2) cx(2) cy(2) = 18 bytes
//                 menu(2=0) class(2=0) title(2=0) = +6 => 24 bytes total (WORD-aligned)
//   DLGITEMTEMPLATE per control:
//                 style(4) exStyle(4) x(2) y(2) cx(2) cy(2) id(2) = 18 bytes (WORD-aligned)
//                 class(atom or string) title creation data

const IDOK     = 1;
const IDCANCEL = 2;
const ID_EDIT  = 100;
const ID_LABEL = 101;

const DS_SETFONT   = 0x40;
const DS_MODALFRAME = 0x80;
const DS_CENTER    = 0x0800;
const WS_POPUP     = 0x80000000;
const WS_CAPTION   = 0x00C00000;
const WS_SYSMENU   = 0x00080000;
const WS_VISIBLE   = 0x10000000;
const WS_CHILD     = 0x40000000;
const WS_TABSTOP   = 0x00010000;
const WS_BORDER    = 0x00800000;
const WS_VSCROLL   = 0x00200000;
const ES_AUTOHSCROLL = 0x0080;
const BS_DEFPUSHBUTTON = 0x01;
const WM_INITDIALOG = 0x0110;
const WM_COMMAND    = 0x0111;
const EN_CHANGE     = 0x0300;
const LB_RESETCONTENT = 0x0184;
const LB_ADDSTRING    = 0x0180;
const LB_GETCURSEL    = 0x0188;
const LB_SETCURSEL    = 0x0186;
const LB_GETCOUNT     = 0x018B;
const LBS_NOTIFY      = 0x0001;
const LBS_NOINTEGRALHEIGHT = 0x0100;
const LBN_DBLCLK      = 2;

function writeWORD(buf, off, v)  { buf.writeUInt16LE(v & 0xFFFF, off); return off + 2; }
function writeDWORD(buf, off, v) { buf.writeUInt32LE(v >>> 0, off); return off + 4; }

function buildPromptDialog(message, defaultValue) {
  // Encode strings as UTF-16LE null-terminated
  const titleW   = Buffer.from('Input\0', 'utf16le');
  const msgW     = Buffer.from((message || '') + '\0', 'utf16le');
  const defW     = Buffer.from((defaultValue || '') + '\0', 'utf16le');
  const fontW    = Buffer.from('MS Shell Dlg\0', 'utf16le');
  const okW      = Buffer.from('OK\0', 'utf16le');
  const cancelW  = Buffer.from('Cancel\0', 'utf16le');
  const emptyW   = Buffer.from('\0', 'utf16le');

  // Items: label(ID_LABEL), edit(ID_EDIT), OK(IDOK), Cancel(IDCANCEL)
  // Dialog: 280x80 dialog units
  const dlgStyle = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_CENTER | DS_SETFONT;

  // Build into a growing array of Buffers then concat
  const parts = [];
  const w = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xFFFF, 0); parts.push(b); };
  const dw = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); parts.push(b); };
  const str = (buf) => parts.push(buf);
  const align = () => { const total = parts.reduce((s, b) => s + b.length, 0); if (total % 4) parts.push(Buffer.alloc(4 - total % 4)); };

  // DLGTEMPLATE
  dw(dlgStyle); dw(0); // style, exStyle
  w(4);                // cDlgItems
  w(0); w(0); w(280); w(80); // x y cx cy
  w(0); w(0); str(titleW); // menu, class, title
  // DS_SETFONT font info
  w(9); str(fontW); // point size, face name
  align();

  const addItem = (style, exStyle, x, y, cx, cy, id, classAtom, titleBuf) => {
    align();
    dw(style); dw(exStyle);
    w(x); w(y); w(cx); w(cy);
    w(id);
    w(0xFFFF); w(classAtom); // class as atom
    str(titleBuf);
    w(0); // no creation data
  };

  // STATIC label — class atom 0x0082
  addItem(WS_VISIBLE | WS_CHILD, 0, 7, 7, 266, 14, ID_LABEL, 0x0082, msgW);
  // EDIT — class atom 0x0081
  addItem(WS_VISIBLE | WS_CHILD | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 0, 7, 24, 266, 14, ID_EDIT, 0x0081, defW);
  // OK button — class atom 0x0080
  addItem(WS_VISIBLE | WS_CHILD | WS_TABSTOP | BS_DEFPUSHBUTTON, 0, 126, 52, 70, 14, IDOK, 0x0080, okW);
  // Cancel button — class atom 0x0080
  addItem(WS_VISIBLE | WS_CHILD | WS_TABSTOP, 0, 203, 52, 70, 14, IDCANCEL, 0x0080, cancelW);

  return Buffer.concat(parts);
}

function showPromptDialog(hParent, message, defaultValue) {
  let result = null;

  const dlgProc = new JSCallback(
    (hDlg, msg, wParam) => {
      if (msg === WM_INITDIALOG) return 1n;
      if (msg === WM_COMMAND) {
        const id = Number(wParam & 0xffffn);
        if (id === IDOK) {
          const buf = Buffer.alloc(2048);
          User32.GetDlgItemTextW(hDlg, ID_EDIT, ffiPtr(buf), 1024);
          result = buf.toString('utf16le').replace(/\0.*$/, '');
          User32.EndDialog(hDlg, 1n);
          return 1n;
        }
        if (id === IDCANCEL) {
          User32.EndDialog(hDlg, 0n);
          return 1n;
        }
      }
      return 0n;
    },
    { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' },
  );

  const dlgBuf = buildPromptDialog(message, defaultValue);
  User32.DialogBoxIndirectParamW(0n, ffiPtr(dlgBuf), hParent, dlgProc.ptr, 0n);
  dlgProc.close();
  return result;
}

// ── Picker dialog (filter EDIT + LISTBOX + OK/Cancel) ────────────────────────
// items: array of strings. Returns selected string or null.
const ID_FILTER = 102;
const ID_LIST   = 200;

function buildPickerDialog(title) {
  const titleW  = Buffer.from((title || 'Pick') + '\0', 'utf16le');
  const fontW   = Buffer.from('MS Shell Dlg\0', 'utf16le');
  const okW     = Buffer.from('OK\0', 'utf16le');
  const cancelW = Buffer.from('Cancel\0', 'utf16le');
  const emptyW  = Buffer.from('\0', 'utf16le');

  const dlgStyle = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_CENTER | DS_SETFONT;
  const parts = [];
  const w  = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xFFFF, 0); parts.push(b); };
  const dw = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); parts.push(b); };
  const str = (buf) => parts.push(buf);
  const align = () => { const total = parts.reduce((s, b) => s + b.length, 0); if (total % 4) parts.push(Buffer.alloc(4 - total % 4)); };
  const addItem = (style, exStyle, x, y, cx, cy, id, classAtom, titleBuf) => {
    align();
    dw(style); dw(exStyle);
    w(x); w(y); w(cx); w(cy);
    w(id);
    w(0xFFFF); w(classAtom);
    str(titleBuf); w(0);
  };

  // 5 items: filter EDIT, LISTBOX, OK, Cancel
  dw(dlgStyle); dw(0);
  w(4); // cDlgItems
  w(0); w(0); w(320); w(200);
  w(0); w(0); str(titleW);
  w(11); str(fontW);
  align();

  // Filter EDIT (0x0081)
  addItem(WS_VISIBLE | WS_CHILD | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 0, 7, 7, 306, 14, ID_FILTER, 0x0081, emptyW);
  // LISTBOX (0x0083)
  const lbStyle = WS_VISIBLE | WS_CHILD | WS_BORDER | WS_TABSTOP | WS_VSCROLL | LBS_NOTIFY | LBS_NOINTEGRALHEIGHT;
  addItem(lbStyle, 0, 7, 26, 306, 148, ID_LIST, 0x0083, emptyW);
  // OK button (0x0080)
  addItem(WS_VISIBLE | WS_CHILD | WS_TABSTOP | BS_DEFPUSHBUTTON, 0, 166, 180, 70, 14, IDOK, 0x0080, okW);
  // Cancel button (0x0080)
  addItem(WS_VISIBLE | WS_CHILD | WS_TABSTOP, 0, 243, 180, 70, 14, IDCANCEL, 0x0080, cancelW);

  return Buffer.concat(parts);
}

function showPickerDialog(hParent, title, itemsOrFn, initialFilter = '') {
  // Accept either a static array or a getItems(filterText) => string[] callback.
  // Static array: apply built-in fuzzy matching. Callback: delegate entirely.
  const getItems = typeof itemsOrFn === 'function'
    ? itemsOrFn
    : (filter) => {
        const q = filter.trim().toLowerCase();
        if (!q) return itemsOrFn.slice();
        return itemsOrFn
          .map(s => ({ s, score: fuzzyMatch(s, q) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.s);
      };

  const initial = getItems(initialFilter);
  // For static arrays, bail early if empty. For callbacks, always open — list populates as user types.
  if (typeof itemsOrFn !== 'function' && (!initial || initial.length === 0)) return null;
  let selected     = null;
  let visibleItems = initial ? initial.slice() : [];

  const GWLP_WNDPROC = -4;
  const WM_KEYDOWN   = 0x0100;
  const VK_UP        = 0x26;
  const VK_DOWN      = 0x28;
  const VK_RETURN    = 0x0D;
  const VK_ESCAPE    = 0x1B;
  let origEditProc = 0n;
  let hDlgRef      = 0n;

  const repopulate = (hDlg, filter) => {
    visibleItems = getItems(filter);
    User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_RESETCONTENT, 0n, 0n);
    for (const s of visibleItems) {
      const buf = encodeWide(s);
      User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_ADDSTRING, 0n, BigInt(ptr(buf)));
    }
    if (visibleItems.length > 0)
      User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_SETCURSEL, 0n, 0n);
  };

  const confirmSelection = (hDlg) => {
    const idx = Number(User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_GETCURSEL, 0n, 0n));
    if (idx >= 0 && idx < visibleItems.length) selected = visibleItems[idx];
    User32.EndDialog(hDlg, 1n);
  };

  const moveSel = (hDlg, delta) => {
    const count = Number(User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_GETCOUNT, 0n, 0n));
    if (count <= 0) return;
    const cur = Number(User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_GETCURSEL, 0n, 0n));
    const next = Math.max(0, Math.min(count - 1, (cur < 0 ? 0 : cur) + delta));
    User32.SendDlgItemMessageW(hDlg, ID_LIST, LB_SETCURSEL, BigInt(next), 0n);
  };

  // Subclass the EDIT to intercept arrow/enter/esc keys
  const editSubProc = new JSCallback(
    (hWnd, msg, wParam, lParam) => {
      if (msg === WM_KEYDOWN) {
        const vk = Number(wParam);
        if (vk === VK_DOWN)   { moveSel(hDlgRef, +1); return 0n; }
        if (vk === VK_UP)     { moveSel(hDlgRef, -1); return 0n; }
        if (vk === VK_RETURN) { confirmSelection(hDlgRef); return 0n; }
        if (vk === VK_ESCAPE) { User32.EndDialog(hDlgRef, 0n); return 0n; }
      }
      return User32.CallWindowProcW(origEditProc, hWnd, msg, wParam, lParam);
    },
    { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' },
  );

  const dlgProc = new JSCallback(
    (hDlg, msg, wParam) => {
      if (msg === WM_INITDIALOG) {
        hDlgRef = hDlg;
        const hEdit = User32.GetDlgItem(hDlg, ID_FILTER);
        origEditProc = BigInt(User32.GetWindowLongPtrW(hEdit, GWLP_WNDPROC));
        User32.SetWindowLongPtrW(hEdit, GWLP_WNDPROC, BigInt(editSubProc.ptr));
        if (initialFilter) {
          const initBuf = encodeWide(initialFilter);
          User32.SetDlgItemTextW(hDlg, ID_FILTER, ffiPtr(initBuf));
        }
        repopulate(hDlg, initialFilter);
        User32.SetFocus(hEdit);
        return 0n;
      }
      if (msg === WM_COMMAND) {
        const id    = Number(wParam & 0xffffn);
        const notif = Number((wParam >> 16n) & 0xffffn);
        if (id === ID_FILTER && notif === EN_CHANGE) {
          const buf = Buffer.alloc(2048);
          User32.GetDlgItemTextW(hDlg, ID_FILTER, ffiPtr(buf), 1024);
          const filter = buf.toString('utf16le').replace(/\0.*$/, '');
          repopulate(hDlg, filter);
          return 1n;
        }
        if (id === IDOK || (id === ID_LIST && notif === LBN_DBLCLK)) {
          confirmSelection(hDlg);
          return 1n;
        }
        if (id === IDCANCEL) { User32.EndDialog(hDlg, 0n); return 1n; }
      }
      return 0n;
    },
    { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' },
  );

  const dlgBuf = buildPickerDialog(title);
  User32.DialogBoxIndirectParamW(0n, ffiPtr(dlgBuf), hParent, dlgProc.ptr, 0n);
  dlgProc.close();
  editSubProc.close();
  return selected;
}

// Match query against text.
// No wildcard → consecutive substring match (case-insensitive).
// * in query → fuzzy: each segment between * must appear in order anywhere.
// \ escapes: \* = literal *, \  = literal space, \\ = backslash.
// Returns score > 0 on match, 0 on no match.
function fuzzyMatch(text, query) {
  const t = text.toLowerCase();

  // Parse into segments split on unescaped *
  const segments = parseSegments(query);
  if (segments.length === 0) return 1;

  if (segments.length === 1) {
    // No wildcard — plain consecutive substring match
    const needle = segments[0].toLowerCase();
    if (needle.length === 0) return 1;
    const idx = t.indexOf(needle);
    if (idx < 0) return 0;
    // Score: longer match at earlier position scores higher
    return needle.length * 100 - idx;
  }

  // Wildcard mode — each segment must appear consecutively in t, in order
  let pos = 0;
  let score = 0;
  for (const seg of segments) {
    if (seg.length === 0) continue; // leading/trailing/adjacent * — skip
    const needle = seg.toLowerCase();
    const idx = t.indexOf(needle, pos);
    if (idx < 0) return 0;
    score += needle.length * 100 - (idx - pos);
    pos = idx + needle.length;
  }
  return score > 0 ? score : 1;
}

// Parse query into segments split on unescaped *.
// Each segment is a plain string (\ escapes already resolved).
function parseSegments(query) {
  const segments = [];
  let cur = '';
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '\\' && i + 1 < query.length) {
      i++;
      cur += query[i] === '*'  ? '*'
           : query[i] === '\\' ? '\\'
           : query[i] === ' '  ? ' '
           : query[i];
    } else if (query[i] === '*') {
      segments.push(cur);
      cur = '';
    } else {
      cur += query[i];
    }
  }
  segments.push(cur);
  return segments;
}

// ── PluginAPI ─────────────────────────────────────────────────────────────────
export class PluginAPI {
  // Set by editor.js after construction
  _rawSend   = null;   // (msg, wParam, lParam) => BigInt
  _emitter   = null;   // EventEmitter instance
  _state     = null;   // { currentPath, isDirty, activeTheme, fontSize }
  _hMain     = () => 0n;
  _pluginName = '';    // plugin filename without .js — used as submenu label
  _menuItems = [];     // { label, shortcut, fn }

  get sci() { return this._sci; }

  constructor() {
    const self = this;
    this._sci = {
      send(msg, wParam = 0, lParam = 0) {
        return self._rawSend(msg, wParam, lParam);
      },
      getText() {
        const len = Number(self._rawSend(SCI_GETTEXTLENGTH, 0, 0));
        const buf = Buffer.alloc(len + 1);
        self._rawSend(SCI_GETTEXT, len + 1, ptr(buf));
        return buf.toString('utf8', 0, len);
      },
      setText(text) {
        const buf = Buffer.from(text + '\0', 'utf8');
        self._rawSend(SCI_SETTEXT, 0, ptr(buf));
      },
      getLine(n) {
        const len = Number(self._rawSend(SCI_LINELENGTH, n, 0));
        if (len <= 0) return '';
        const buf = Buffer.alloc(len + 2);
        self._rawSend(SCI_GETLINE, n, ptr(buf));
        return buf.toString('utf8', 0, len).replace(/[\r\n]+$/, '');
      },
      getLineCount() {
        return Number(self._rawSend(SCI_GETLINECOUNT, 0, 0));
      },
      gotoLine(n) {
        self._rawSend(SCI_GOTOLINE, n, 0);
      },
      getCursorPos() {
        return Number(self._rawSend(SCI_GETCURRENTPOS, 0, 0));
      },
      setSelection(start, end) {
        self._rawSend(SCI_SETSEL, start, end);
      },
      getSelText() {
        const len = Number(self._rawSend(SCI_GETSELTEXT, 0, 0));
        const buf = Buffer.alloc(len + 1);
        self._rawSend(SCI_GETSELTEXT, 0, ptr(buf));
        return buf.toString('utf8', 0, len);
      },
      replaceSelection(text) {
        const buf = Buffer.from(text + '\0', 'utf8');
        self._rawSend(SCI_REPLACESEL, 0, ptr(buf));
      },
      appendText(text) {
        const buf = Buffer.from(text, 'utf8');
        self._rawSend(SCI_APPENDTEXT, buf.length, ptr(buf));
      },
      getTextRange(start, end) {
        return sciGetTextRange(self._rawSend.bind(self), start, end);
      },
      lineFromPosition(pos) {
        return Number(self._rawSend(SCI_LINEFROMPOSITION, pos, 0));
      },
      positionFromLine(line) {
        return Number(self._rawSend(SCI_POSITIONFROMLINE, line, 0));
      },
      getLineEndPosition(line) {
        return Number(self._rawSend(SCI_GETLINEENDPOSITION, line, 0));
      },
      getSelectionStart() {
        return Number(self._rawSend(SCI_GETSELECTIONSTART, 0, 0));
      },
      getSelectionEnd() {
        return Number(self._rawSend(SCI_GETSELECTIONEND, 0, 0));
      },
      getLineIndentation(line) {
        return Number(self._rawSend(SCI_GETLINEINDENTATION, line, 0));
      },
      getTextLength() {
        return Number(self._rawSend(SCI_GETTEXTLENGTH, 0, 0));
      },
      getReadOnly() {
        return Number(self._rawSend(SCI_GETREADONLY, 0, 0)) !== 0;
      },
      setReadOnly(flag) {
        self._rawSend(SCI_SETREADONLY, flag ? 1 : 0, 0);
      },
      getWordAt(pos) {
        const start = Number(self._rawSend(SCI_WORDSTARTPOSITION, pos, 1));
        const end   = Number(self._rawSend(SCI_WORDENDPOSITION,   pos, 1));
        return start < end ? sciGetTextRange(self._rawSend.bind(self), start, end - 1) : '';
      },
      // Find next occurrence of needle starting at fromPos.
      // flags: combination of SCFIND_MATCHCASE, SCFIND_WHOLEWORD, SCFIND_REGEXP (exported below).
      // Returns {start, end} or null if not found.
      findNext(needle, fromPos = 0, toPos = -1, flags = 0) {
        const docLen   = Number(self._rawSend(SCI_GETTEXTLENGTH, 0, 0));
        const searchTo = toPos < 0 ? docLen : toPos;
        const needleBuf = Buffer.from(needle + '\0', 'utf8');
        const ttf = Buffer.alloc(24);
        ttf.writeInt32LE(fromPos,  0);
        ttf.writeInt32LE(searchTo, 4);
        ttf.writeBigInt64LE(BigInt(ptr(needleBuf)), 8);
        const found = Number(self._rawSend(SCI_FINDTEXT, flags, ptr(ttf)));
        if (found < 0) return null;
        return { start: found, end: ttf.readInt32LE(20) };
      },
      // Find all occurrences of needle in the document.
      findAll(needle, flags = 0) {
        const docLen = Number(self._rawSend(SCI_GETTEXTLENGTH, 0, 0));
        const results = [];
        let pos = 0;
        while (pos < docLen) {
          const m = self._sci.findNext(needle, pos, docLen, flags);
          if (!m || m.end <= m.start) break;
          results.push(m);
          pos = m.end;
        }
        return results;
      },
      // ── Indicator helpers ──────────────────────────────────────────────────
      setIndicatorStyle(id, style) { self._rawSend(SCI_INDICSETSTYLE, id, style); },
      setIndicatorFore(id, color)  { self._rawSend(SCI_INDICSETFORE,  id, color); },
      setIndicatorAlpha(id, alpha) { self._rawSend(SCI_INDICSETALPHA, id, alpha); },
      setIndicatorUnder(id, under) { self._rawSend(SCI_INDICSETUNDER, id, under ? 1 : 0); },
      clearIndicator(id) {
        const docLen = Number(self._rawSend(SCI_GETTEXTLENGTH, 0, 0));
        self._rawSend(SCI_SETINDICATORCURRENT, id, 0n);
        self._rawSend(SCI_INDICATORCLEARRANGE, 0, BigInt(docLen));
      },
      fillIndicator(id, start, length) {
        self._rawSend(SCI_SETINDICATORCURRENT, id, 0n);
        self._rawSend(SCI_INDICATORFILLRANGE, start, BigInt(length));
      },
    };

    this.editor = {
      getCurrentPath: () => self._state?.currentPath ?? null,
      isDirty:        () => self._state?.isDirty ?? false,
      getTheme:       () => self._state?.activeTheme ?? '',
      getFontSize:    () => self._state?.fontSize ?? 11,
    };

    // Search flag constants for use with sci.findNext / sci.findAll
    this.SCFIND = { MATCHCASE: SCFIND_MATCHCASE, WHOLEWORD: SCFIND_WHOLEWORD, REGEXP: SCFIND_REGEXP };
  }

  on(event, fn)  { this._emitter?.on(event, fn); }
  off(event, fn) { this._emitter?.off(event, fn); }

  // shortcut is optional string like 'Ctrl+Shift+W'
  addMenuItem(label, shortcutOrFn, fn) {
    if (typeof shortcutOrFn === 'function') {
      this._menuItems.push({ label, shortcut: null, fn: shortcutOrFn });
    } else {
      this._menuItems.push({ label, shortcut: shortcutOrFn ?? null, fn });
    }
  }

  alert(msg) {
    const textBuf = encodeWide(String(msg));
    const capBuf  = encodeWide('BunSciEditor');
    User32.MessageBoxW(this._hMain(), ffiPtr(textBuf), ffiPtr(capBuf), 0x00000040); // MB_ICONINFORMATION
  }

  confirm(msg) {
    const textBuf = encodeWide(String(msg));
    const capBuf  = encodeWide('BunSciEditor');
    const result  = User32.MessageBoxW(this._hMain(), ffiPtr(textBuf), ffiPtr(capBuf), 0x00000024); // MB_YESNO|MB_ICONQUESTION
    return result === 6; // IDYES
  }

  prompt(msg, defaultValue = '') {
    return showPromptDialog(this._hMain(), msg, defaultValue);
  }

  // showPickerDynamic(title, getItems, initialFilter) → selected string | null
  // getItems(filterText) called on every keystroke; returns string[].
  showPickerDynamic(title, getItems, initialFilter = '') {
    return showPickerDialog(this._hMain(), title, getItems, initialFilter);
  }

}

// ── Plugin loader ─────────────────────────────────────────────────────────────
export async function loadPlugins(dir, makeAPI) {
  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  } catch {
    return []; // no plugins/ folder
  }

  const loaded = [];
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const mod  = await import(pathToFileURL(fullPath).href);
      const init = mod.default;
      if (typeof init !== 'function') continue;
      const pluginName = file.replace(/\.js$/, '');
      const api = makeAPI(pluginName);
      await init(api);
      loaded.push(api);
      console.log(`[plugin] loaded ${file}`);
    } catch (e) {
      console.error(`[plugin] ${file} failed:`, e.message);
    }
  }
  return loaded;
}
