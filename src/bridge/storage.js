/**
 * HTMLix IndexedDB Persistence & Snapshot Manager
 */

const DB_NAME = 'HTMLix_SystemDB';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

class HTMLixStorage {
  static serializeSnapshot(ramUint8Array, meta = {}) {
    let binary = '';
    // Sample or encode RAM snapshot
    const len = ramUint8Array.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(ramUint8Array[i]);
    }
    const ramBase64 = btoa(binary);
    return {
      ramBase64,
      meta: {
        timestamp: Date.now(),
        ...meta
      }
    };
  }

  static async openDB() {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async saveState(emulator) {
    const db = await HTMLixStorage.openDB();
    if (!db) return false;

    const ram = emulator.getRam();
    const snapshot = HTMLixStorage.serializeSnapshot(ram, {
      pc: emulator.getPC()
    });

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put({ id: 'latest_state', data: snapshot });
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    });
  }

  static async loadLatestState() {
    const db = await HTMLixStorage.openDB();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get('latest_state');
      getReq.onsuccess = () => resolve(getReq.result ? getReq.result.data : null);
      getReq.onerror = () => reject(getReq.error);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HTMLixStorage };
}
if (typeof window !== 'undefined') {
  window.HTMLixStorage = HTMLixStorage;
}
