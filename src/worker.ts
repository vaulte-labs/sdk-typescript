// Owns one handle on its own thread, because a call blocks while a person answers a prompt. Messages
// arrive in order and each call finishes before the next starts, so `lv_close` never races a call.
import { CString, dlopen, FFIType, type Pointer } from "bun:ffi";

declare const self: Worker;

export type Request = { library: string; home: string | undefined } | { id: number; call: string } | { close: true };
export type Reply = { id: number; reply: string } | { closed: true };

const symbols = {
  lv_open: { args: [FFIType.ptr], returns: FFIType.ptr },
  lv_call: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  lv_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  lv_close: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

let library: ReturnType<typeof dlopen<typeof symbols>> | undefined;
let handle: Pointer | bigint | null = null;
let failure = "";

const cString = (text: string) => Buffer.from(`${text}\0`);

function call(json: string): string {
  if (library === undefined || handle === null) {
    return JSON.stringify({ error: failure, code: "error" });
  }
  const input = cString(json);
  const reply = library.symbols.lv_call(handle, input);
  input.fill(0);
  if (reply === null) {
    return JSON.stringify({ error: "the library gave no reply", code: "error" });
  }
  try {
    return new CString(reply).toString();
  } finally {
    // Erases the native copy. The JavaScript string cannot be erased.
    library.symbols.lv_free_string(reply);
  }
}

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if ("library" in data) {
    try {
      library = dlopen(data.library, symbols);
      handle = library.symbols.lv_open(data.home === undefined ? null : cString(data.home));
      failure = "that home is not a path";
    } catch (error) {
      failure = `libvaulty could not be loaded from ${data.library}: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if ("close" in data) {
    if (handle !== null) library?.symbols.lv_close(handle);
    library?.close();
    handle = null;
    library = undefined;
    failure = "this vault is closed";
    postMessage({ closed: true } satisfies Reply);
  } else {
    postMessage({ id: data.id, reply: call(data.call) } satisfies Reply);
  }
};
