import type { TestResult } from "./types";

const DATABASE_NAME = "netpulse-measurement-evidence";
const DATABASE_VERSION = 1;
const STORE_NAME = "runs";
const MAX_RUNS = 20;

type StoredEvidence = {
  runId: string;
  timestamp: number;
  result: TestResult;
};

/** Keep complete privacy-filtered evidence on this device; nothing is uploaded. */
export async function saveRawEvidence(result: TestResult): Promise<void> {
  const database = await openDatabase();
  await transactionComplete(database, "readwrite", (store) => {
    store.put({ runId: result.runId, timestamp: result.timestamp, result } satisfies StoredEvidence);
  });
  await pruneOldEvidence(database);
  database.close();
}

export async function deleteRawEvidence(runId: string): Promise<void> {
  const database = await openDatabase();
  await transactionComplete(database, "readwrite", (store) => store.delete(runId));
  database.close();
}

export async function clearRawEvidence(): Promise<void> {
  const database = await openDatabase();
  await transactionComplete(database, "readwrite", (store) => store.clear());
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Local evidence database could not be opened."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "runId" });
        store.createIndex("timestamp", "timestamp");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local evidence transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local evidence transaction was aborted."));
    action(transaction.objectStore(STORE_NAME));
  });
}

async function pruneOldEvidence(database: IDBDatabase): Promise<void> {
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("timestamp").getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local evidence index could not be read."));
  });
  const stale = keys.slice(0, Math.max(0, keys.length - MAX_RUNS));
  if (stale.length === 0) return;
  await transactionComplete(database, "readwrite", (store) => {
    for (const key of stale) store.delete(key);
  });
}
