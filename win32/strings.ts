import { ffiPtr } from "./pointers";

/** UTF-16LE NUL-terminated buffer for LPCWSTR parameters. */
export const encodeWide = (value: string): Buffer =>
  Buffer.from(`${value}\0`, "utf16le");

export { ffiPtr };
