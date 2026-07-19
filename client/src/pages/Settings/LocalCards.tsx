/**
 * Local-mode-only settings cards: on-device Anthropic API key management and
 * database backup/restore. Rendered (lazily) only when VITE_LOCAL_MODE=1, so
 * none of this — or the local runtime it imports — reaches the server-mode
 * bundle.
 */
import { useRef, useState } from "react";
import { getStoredApiKey, setStoredApiKey } from "../../local/boot";
import { exportDbBytes, importDbBytes } from "../../local/sqljsDb";

export default function LocalCards() {
  const [keyInput, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(() => getStoredApiKey() != null);
  const [keySaved, setKeySaved] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function saveKey() {
    const key = keyInput.trim();
    if (!key) return;
    setStoredApiKey(key);
    setHasKey(true);
    setKeyInput("");
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1600);
  }

  function clearKey() {
    setStoredApiKey(null);
    setHasKey(false);
    setKeyInput("");
  }

  function exportBackup() {
    setDataError(null);
    try {
      const bytes = exportDbBytes();
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
      // Copy into a plain ArrayBuffer — TS's BlobPart rejects Uint8Array<ArrayBufferLike>.
      const copy = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([copy], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `darfum-backup-${stamp}.db`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function importBackup(file: File) {
    setDataError(null);
    try {
      const buf = await file.arrayBuffer();
      await importDbBytes(new Uint8Array(buf));
      location.reload();
    } catch (e) {
      setDataError(e instanceof Error ? e.message : "Import failed");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="grid cols-2" style={{ marginTop: 16 }}>
      <div className="card" data-testid="ai-assistant-card">
        <h3>AI assistant</h3>
        <div className="stack">
          <p className="empty" style={{ margin: 0 }}>
            {hasKey
              ? "An API key is saved on this device — the AI assistants are enabled."
              : "Paste your Anthropic API key to enable the AI assistants."}
          </p>
          <label className="field">
            Anthropic API key
            <input
              className="input"
              type="password"
              placeholder="sk-ant-…"
              value={keyInput}
              autoComplete="off"
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
              }}
            />
          </label>
          <div className="row">
            <button className="btn primary" onClick={saveKey} disabled={!keyInput.trim()}>
              Save key
            </button>
            {hasKey && (
              <button className="btn danger" onClick={clearKey}>
                Clear key
              </button>
            )}
            {keySaved && <span style={{ color: "var(--good-text)", fontSize: 13 }}>Saved ✓</span>}
          </div>
          <p className="empty" style={{ margin: 0, fontSize: 12 }}>
            The key is stored only on this device (in this browser) and is sent only to the
            Anthropic API.
          </p>
        </div>
      </div>

      <div className="card" data-testid="data-card">
        <h3>Data</h3>
        <div className="stack">
          <p className="empty" style={{ margin: 0 }}>
            All your data lives in this browser, on this device. Export a backup before clearing
            browser data or to move to another device.
          </p>
          <div className="row">
            <button className="btn" onClick={exportBackup}>
              Export backup
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".db,application/octet-stream"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importBackup(f);
              }}
            />
          </div>
          {dataError && <p className="error-text">{dataError}</p>}
          <p className="empty" style={{ margin: 0, fontSize: 12 }}>
            Importing replaces everything with the backup's contents and reloads the app.
          </p>
        </div>
      </div>
    </div>
  );
}
