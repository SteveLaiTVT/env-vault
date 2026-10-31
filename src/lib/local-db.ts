import type { AuditItem, LocalSnapshot } from "./model";

const DB_NAME = "env-vault";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(): Promise<LocalSnapshot | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("snapshot");
    req.onsuccess = () => resolve((req.result as LocalSnapshot | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(snapshot: LocalSnapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(snapshot, "snapshot");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function trimAudits(audits: AuditItem[], now = Date.now()): AuditItem[] {
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  return audits.filter((item) => new Date(item.createdAt).getTime() >= cutoff).slice(-500);
}
