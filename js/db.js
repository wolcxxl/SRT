const DB_NAME = 'SmartReaderDB';
const STORE_NAME = 'books';
const TRANS_STORE = 'translations'; // Новое хранилище
let db;

export function initDB() {
    return new Promise((res) => {
        // Повышаем версию до 3, чтобы создалось новое хранилище
        const r = indexedDB.open(DB_NAME, 3);
        
        r.onupgradeneeded = (e) => {
            const d = e.target.result;
            // Создаем хранилище книг, если нет
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            // Создаем хранилище переводов, если нет
            if (!d.objectStoreNames.contains(TRANS_STORE)) {
                // keyPath: 'id' будет уникальной строкой (hash)
                d.createObjectStore(TRANS_STORE, { keyPath: 'id' });
            }
        };
        r.onsuccess = (e) => { db = e.target.result; res(db); };
        r.onerror = (e) => { console.error("DB Error:", e); };
    });
}

// --- Работа с книгами ---

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
            data.progress = { 
                chapter: chapter || 0, 
                scroll: scroll || 0 
            };
            data.lastRead = new Date();
            store.put(data);
        }
    };
}

// --- Работа с переводами (КЭШ) ---

// Генерируем уникальный ID для перевода
function getTransKey(text, src, tgt) {
    // Удаляем лишние пробелы, чтобы "Hello " и "Hello" считались одним и тем же
    return `${src}:${tgt}:${text.trim()}`;
}

export async function getCachedTranslation(text, src, tgt) {
    return new Promise((resolve) => {
        if (!text) { resolve(null); return; }
        
        const tx = db.transaction(TRANS_STORE, 'readonly');
        const store = tx.objectStore(TRANS_STORE);
        const key = getTransKey(text, src, tgt);
        
        const req = store.get(key);
        req.onsuccess = () => {
            // Если нашли - возвращаем текст перевода, иначе null
            resolve(req.result ? req.result.trans : null);
        };
        req.onerror = () => resolve(null);
    });
}

export async function saveCachedTranslation(text, src, tgt, transResult) {
    if (!text || !transResult) return;
    
    const tx = db.transaction(TRANS_STORE, 'readwrite');
    const store = tx.objectStore(TRANS_STORE);
    
    await store.put({
        id: getTransKey(text, src, tgt),
        original: text.trim(),
        trans: transResult,
        date: new Date() // Можно потом чистить старые переводы
    });
}