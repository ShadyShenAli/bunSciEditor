import type { Pointer } from "bun:ffi";

import { pointerToBigInt } from "./pointers";

/**
 * Pack WNDCLASSEXW (80 bytes on x64):
 * cbSize(4) + style(4) + lpfnWndProc(8) + cbClsExtra(4) + cbWndExtra(4) +
 * hInstance(8) + hIcon(8) + hCursor(8) + hbrBackground(8) + lpszMenuName(8) +
 * lpszClassName(8) + hIconSm(8)
 */
export const packWndClassEx = (
  wndProcPtr: Pointer,
  classNamePtr: Pointer | Buffer,
  style: number,
  backgroundBrush = 0n,
): Buffer => {
  const wndClass = Buffer.alloc(80);
  const view = new DataView(wndClass.buffer);

  view.setUint32(0, 80, true);
  view.setUint32(4, style, true);
  wndClass.writeBigUInt64LE(pointerToBigInt(wndProcPtr), 8);
  view.setInt32(16, 0, true);
  view.setInt32(20, 0, true);
  wndClass.writeBigUInt64LE(0n, 24);
  wndClass.writeBigUInt64LE(0n, 32);
  wndClass.writeBigUInt64LE(0n, 40);
  wndClass.writeBigUInt64LE(backgroundBrush, 48);
  wndClass.writeBigUInt64LE(0n, 56);
  wndClass.writeBigUInt64LE(pointerToBigInt(classNamePtr), 64);
  wndClass.writeBigUInt64LE(0n, 72);

  return wndClass;
};
