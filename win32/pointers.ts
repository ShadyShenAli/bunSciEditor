import { ptr } from "bun:ffi";
import type { Pointer } from "bun:ffi";

type FfiBuffer = ArrayBufferLike | DataView | NodeJS.ArrayBufferView;

/** Native pointer for a buffer view (works in dev and compiled executables). */
export const ffiPtr = (buf: FfiBuffer): Pointer => {
  const withPtr = buf as { ptr?: Pointer };
  if (withPtr.ptr !== undefined && withPtr.ptr !== null) {
    return withPtr.ptr;
  }

  return ptr(buf) as unknown as Pointer;
};

/** Coerce a Bun FFI pointer (or buffer view) to bigint for manual struct packing. */
export const pointerToBigInt = (value: Pointer | FfiBuffer): bigint => {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (value && typeof value === "object" && "ptr" in value) {
    const nested = (value as { ptr?: unknown }).ptr;
    if (typeof nested === "bigint") {
      return nested;
    }
    if (typeof nested === "number") {
      return BigInt(nested);
    }
  }

  return BigInt(ptr(value as FfiBuffer));
};

/** Reject small integers mistaken for Win32 pointers after bad FFI calls. */
export const isPlausibleFfiPointer = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "bigint") {
    return value > 0xffffn;
  }

  if (typeof value === "number") {
    return value > 0xffff;
  }

  return isPlausibleFfiPointer(pointerToBigInt(value as Pointer | FfiBuffer));
};
