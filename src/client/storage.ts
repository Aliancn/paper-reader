/** Browser-local storage for uploaded PDFs, their annotations, and translations. */
import type { Annotation, PaperMeta, ParsedCache, TranslationCache } from './types.ts'

const DB_NAME = 'dsh-paper-reader'
const DB_VERSION = 3
const PAPERS = 'papers'
const FILES = 'files'
const ANNOTATIONS = 'annotations'
const TRANSLATIONS = 'translations'
const PARSED = 'parsed'
let database: Promise<IDBDatabase> | undefined

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB request failed')) }
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB transaction failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB transaction aborted')) }
  })
}

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PAPERS)) db.createObjectStore(PAPERS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        const store = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' })
        store.createIndex('paperId', 'paperId', { unique: false })
      }
      if (!db.objectStoreNames.contains(TRANSLATIONS)) {
        const store = db.createObjectStore(TRANSLATIONS, { keyPath: 'id' })
        store.createIndex('paperId', 'paperId', { unique: false })
      }
      if (!db.objectStoreNames.contains(PARSED)) {
        db.createObjectStore(PARSED, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('Could not open the paper library')) }
  })
  return database
}

async function stores(names: string[], mode: IDBTransactionMode): Promise<{ tx: IDBTransaction; store: (name: string) => IDBObjectStore }> {
  const db = await openDatabase()
  const tx = db.transaction(names, mode)
  return { tx, store: name => tx.objectStore(name) }
}

/** Every stored paper, most recently opened first. */
export async function listPapers(): Promise<PaperMeta[]> {
  const { tx, store } = await stores([PAPERS], 'readonly')
  const rows = await requestResult(store(PAPERS).getAll() as IDBRequest<PaperMeta[]>)
  await transactionDone(tx)
  return rows.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt))
}

/** Read one paper's original bytes. */
export async function readPaperFile(id: string): Promise<Blob | undefined> {
  const { tx, store } = await stores([FILES], 'readonly')
  const row = await requestResult(store(FILES).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>)
  await transactionDone(tx)
  return row?.blob
}

/** Store the original file and its metadata together. */
export async function storePaper(file: File, title: string): Promise<PaperMeta> {
  const id = globalThis.crypto?.randomUUID?.() ?? `paper-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = Date.now()
  const meta: PaperMeta = {
    id, title, fileName: file.name, size: file.size, addedAt: now, lastOpenedAt: now,
  }
  const { tx, store } = await stores([PAPERS, FILES], 'readwrite')
  store(PAPERS).put(meta)
  store(FILES).put({ id, blob: file })
  await transactionDone(tx)
  return meta
}

/** Mark a paper as recently opened. */
export async function touchPaper(meta: PaperMeta): Promise<PaperMeta> {
  const next = { ...meta, lastOpenedAt: Date.now() }
  const { tx, store } = await stores([PAPERS], 'readwrite')
  store(PAPERS).put(next)
  await transactionDone(tx)
  return next
}

/** Persist the page count once the PDF engine has parsed the document. */
export async function updatePaperMeta(meta: PaperMeta): Promise<void> {
  const { tx, store } = await stores([PAPERS], 'readwrite')
  store(PAPERS).put(meta)
  await transactionDone(tx)
}

/** Load every annotation for one paper. */
export async function listAnnotations(paperId: string): Promise<Annotation[]> {
  const { tx, store } = await stores([ANNOTATIONS], 'readonly')
  const rows = await requestResult(store(ANNOTATIONS).index('paperId').getAll(paperId) as IDBRequest<Annotation[]>)
  await transactionDone(tx)
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

/** Insert or replace one annotation. */
export async function putAnnotation(annotation: Annotation): Promise<void> {
  const { tx, store } = await stores([ANNOTATIONS], 'readwrite')
  store(ANNOTATIONS).put(annotation)
  await transactionDone(tx)
}

/** Remove one annotation. */
export async function removeAnnotation(id: string): Promise<void> {
  const { tx, store } = await stores([ANNOTATIONS], 'readwrite')
  store(ANNOTATIONS).delete(id)
  await transactionDone(tx)
}

/** Read the cached MinerU layout parse of one paper. */
export async function readParsed(paperId: string): Promise<ParsedCache | undefined> {
  const { tx, store } = await stores([PARSED], 'readonly')
  const row = await requestResult(store(PARSED).get(paperId) as IDBRequest<ParsedCache | undefined>)
  await transactionDone(tx)
  return row
}

/** Insert or replace the cached MinerU layout parse of one paper. */
export async function writeParsed(cache: ParsedCache): Promise<void> {
  const { tx, store } = await stores([PARSED], 'readwrite')
  store(PARSED).put(cache)
  await transactionDone(tx)
}

/** Read the cached paragraph translations of one paper and language. */
export async function readTranslations(paperId: string, language: string): Promise<TranslationCache | undefined> {
  const { tx, store } = await stores([TRANSLATIONS], 'readonly')
  const row = await requestResult(store(TRANSLATIONS).get(`${paperId}::${language}`) as IDBRequest<TranslationCache | undefined>)
  await transactionDone(tx)
  return row
}

/** Insert or replace the paragraph translations of one paper and language. */
export async function writeTranslations(cache: TranslationCache): Promise<void> {
  const { tx, store } = await stores([TRANSLATIONS], 'readwrite')
  store(TRANSLATIONS).put(cache)
  await transactionDone(tx)
}

/** Remove a paper, its original file, all of its annotations, and its translations. */
export async function removePaper(id: string): Promise<void> {
  const { tx, store } = await stores([PAPERS, FILES, ANNOTATIONS, TRANSLATIONS, PARSED], 'readwrite')
  store(PAPERS).delete(id)
  store(FILES).delete(id)
  store(PARSED).delete(id)
  for (const name of [ANNOTATIONS, TRANSLATIONS]) {
    const index = store(name).index('paperId')
    const keys = index.getAllKeys(id)
    keys.onsuccess = () => { for (const key of keys.result) store(name).delete(key) }
  }
  await transactionDone(tx)
}
