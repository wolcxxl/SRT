const DB_NAME = 'SmartReaderDB';
const STORE_NAME = 'books';
let db;

export function initDB() {
    return new Promise((res) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        };
        r.onsuccess = (e) => { db = e.target.result; res(db); };
    });
}

export async function saveBookToDB(file, meta) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).add({
        name: meta.title || file.name,
        file: file,
        type: file.name.split('.').pop().toLowerCase(),
        date: new Date()
    });
}

export function getAllBooks() {
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
    });
}

export async function deleteBook(id) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).delete(id);
}