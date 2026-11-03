// The demo code lives in this browser only (localStorage), as a convenience; storage can be unavailable. Exposed as
// a tiny external store so React can read it with useSyncExternalStore (empty on the server).
const KEY = "tracklab.demoCode";
const listeners = new Set<() => void>();
let memory: string | undefined;

export function getDemoCode(): string {
  if (memory !== undefined) return memory;
  try {
    memory = localStorage.getItem(KEY) ?? "";
  } catch {
    memory = "";
  }
  return memory;
}

export function setDemoCode(code: string): void {
  memory = code;
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the code just won't be remembered.
  }
  listeners.forEach((l) => l());
}

export function subscribeDemoCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
