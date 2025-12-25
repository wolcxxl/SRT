import { initDB, loadLibraryFromDB, saveBookToDB } from './db.js';
import { playAudio, stopAudio } from './tts.js';
import { loadEpub, loadFb2 } from './parser.js';

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    // Логика UI: нажатия кнопок, переключение вкладок
    const fileInput = document.getElementById('libFileInput');
    
    fileInput.addEventListener('change', async (e) => {
        // вызов функций из модулей
    });
});