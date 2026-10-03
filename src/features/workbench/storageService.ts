export const STORAGE_KEY = 'focusdesk.document.v1'
export const RECOVERY_BACKUP_KEY = 'focusdesk.document.v1.recovery-backup'
const DATABASE_NAME = 'focusdesk-db'
const STORE_NAME = 'workspace'

export interface StorageService {
  read(): Promise<string | null>
  write(value: string): Promise<void>
  archive?(value: string): Promise<void>
}

export class BrowserStorageService implements StorageService {
  async read(): Promise<string | null> {
    try {
      const database = await openDatabase()
      const value = await readFromDatabase(database)
      database.close()
      return typeof value === 'string' ? value : window.localStorage.getItem(STORAGE_KEY)
    } catch {
      return window.localStorage.getItem(STORAGE_KEY)
    }
  }

  async write(value: string): Promise<void> {
    try {
      const database = await openDatabase()
      await writeToDatabase(database, STORAGE_KEY, value)
      database.close()
    } catch {
      window.localStorage.setItem(STORAGE_KEY, value)
    }
  }

  async archive(value: string): Promise<void> {
    try {
      const database = await openDatabase()
      await writeToDatabase(database, RECOVERY_BACKUP_KEY, value)
      database.close()
    } catch {
      window.localStorage.setItem(RECOVERY_BACKUP_KEY, value)
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function readFromDatabase(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STORAGE_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}

function writeToDatabase(database: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
  })
}
