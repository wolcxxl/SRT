const DB_NAME = 'SmartReaderDB';
const STORE_NAME = 'books';
const TRANS_STORE = 'translations'; // Хранилище переводов
let db;

export function initDB() {
    return new Promise((res) => {
        // Версия 3 для создания хранилища переводов
        const r = indexedDB.open(DB_NAME, 3);
        r.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            if (!d.objectStoreNames.contains(TRANS_STORE)) {
                d.createObjectStore(TRANS_STORE, { keyPath: 'id' });
            }
        };
        r.onsuccess = (e) => { db = e.target.result; res(db); };
        r.onerror = (e) => console.error("DB Error:", e);
    });
}

// --- Книги ---
export async function saveBookToDB(file, meta) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).add({
        name: meta.title || file.name,
        file: file,
        type: file.name.split('.').pop().toLowerCase(),
        date: new Date(),
        progress: { chapter: 0, scroll: 0 }
    });
}

export function getAllBooks() {
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

export async function deleteBook(id) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).delete(id);
}

export async function updateBookProgress(id, chapter, scroll) {
    if (!id) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
        const data = req.result;
        if (data) {
            data.progress = { chapter: chapter || 0, scroll: scroll || 0 };
            data.lastRead = new Date();
            store.put(data);
        }
    };
}

// --- Переводы (То, чего не хватало) ---
function getTransKey(text, src, tgt) {
    return `${src}:${tgt}:${text.trim()}`;
}

export async function getCachedTranslation(text, src, tgt) {
    return new Promise((resolve) => {
        if (!text) { resolve(null); return; }
        const tx = db.transaction(TRANS_STORE, 'readonly');
        const req = tx.objectStore(TRANS_STORE).get(getTransKey(text, src, tgt));
        req.onsuccess = () => resolve(req.result ? req.result.trans : null);
        req.onerror = () => resolve(null);
    });
}

export async function saveCachedTranslation(text, src, tgt, transResult) {
    if (!text || !transResult) return;
    const tx = db.transaction(TRANS_STORE, 'readwrite');
    await tx.objectStore(TRANS_STORE).put({
        id: getTransKey(text, src, tgt),
        original: text.trim(),
        trans: transResult,
        date: new Date()
    });
}