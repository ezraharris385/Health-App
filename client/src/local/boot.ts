// STUB — replaced by the browser-runtime implementation.
// Initializes the wasm SQLite DB, registers local API dispatchers, and wires
// the on-device Anthropic key when the app runs without a server.
import { initSqljsDb } from "./sqljsDb";

export async function initLocalBackend(): Promise<void> {
  await initSqljsDb();
  throw new Error("Local mode not fully wired yet");
}
