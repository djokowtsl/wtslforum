export type LocalDmoFileHandle = {
  kind: 'file';
  getFile(): Promise<File>;
};

export type LocalDmoEntryHandle = LocalDmoFileHandle | {
  kind: 'directory';
  name: string;
};

export type LocalDmoDirectoryHandle = {
  name: string;
  values(): AsyncIterableIterator<LocalDmoEntryHandle>;
  getDirectoryHandle?(name: string): Promise<LocalDmoDirectoryHandle>;
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
};

const DATABASE_NAME = 'wtsl-live-dmo';
const DATABASE_VERSION = 1;
const STORE_NAME = 'folders';
const FOLDER_KEY = 'demos-folder';

function openFolderDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot save local folder access.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Folder storage could not be opened.'));
  });
}

export async function saveDmoDirectory(handle: LocalDmoDirectoryHandle): Promise<void> {
  const database = await openFolderDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(handle, FOLDER_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Folder access could not be saved.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Folder access could not be saved.'));
  }).finally(() => database.close());
}

export async function loadDmoDirectory(): Promise<LocalDmoDirectoryHandle | null> {
  const database = await openFolderDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(FOLDER_KEY);
    request.onsuccess = () => resolve((request.result as LocalDmoDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Saved folder access could not be read.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Saved folder access could not be read.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Saved folder access could not be read.'));
    };
  });
}
