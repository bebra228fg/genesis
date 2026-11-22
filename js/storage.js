const DB_NAME = 'memento_diary_v1';
const DB_VERSION = 1;
const STORE_MEMORIES = 'memories';
const STORE_BLOBS = 'blobs';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
        db.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Не удалось открыть IndexedDB.'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function waitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция отменена.'));
  });
}

export async function saveMemory(memory, photoEntries = [], audioBlob = null) {
  const db = await openDb();
  const tx = db.transaction([STORE_MEMORIES, STORE_BLOBS], 'readwrite');
  const memStore = tx.objectStore(STORE_MEMORIES);
  const blobStore = tx.objectStore(STORE_BLOBS);

  memStore.put(memory);
  for (const entry of photoEntries) {
    if (entry?.id && entry?.blob) {
      blobStore.put({ id: entry.id, blob: entry.blob });
    }
  }
  if (audioBlob) {
    blobStore.put({ id: `audio:${memory.id}`, blob: audioBlob });
  }
  await waitTx(tx);
  return memory;
}

export async function getAllMemories() {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readonly');
  const list = await wrap(tx.objectStore(STORE_MEMORIES).getAll());
  return list.sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    return byDate !== 0 ? byDate : String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

export async function getMemory(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readonly');
  return wrap(tx.objectStore(STORE_MEMORIES).get(id));
}

export async function getBlob(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const rec = await wrap(tx.objectStore(STORE_BLOBS).get(id));
  return rec?.blob || null;
}

export async function deleteMemory(id) {
  const db = await openDb();
  const tx = db.transaction([STORE_MEMORIES, STORE_BLOBS], 'readwrite');
  tx.objectStore(STORE_MEMORIES).delete(id);
  tx.objectStore(STORE_BLOBS).delete(`audio:${id}`);
  await waitTx(tx);
}