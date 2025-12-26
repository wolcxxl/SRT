import { initDB, saveBookToDB, getAllBooks, deleteBook, updateBookProgress, getCachedTranslation, saveCachedTranslation } from './db.js';
import { translateApi, fetchPhonetics } from './api.js';
import { loadZip, parseFb2, getFb2ChapterText, parseEpub, getEpubChapterContent, parsePdf } from './parser.js';
import { speakDevice, playGoogleSingle, stopAudio } from './tts.js';

// --- Глобальное состояние ---
const state = {
    book: null,
    currentBookId: null,
    fb2Chapters: [],
    epubChapters: [],
    coverUrl: null,
    currentIdx: 0,
    isWorking: false,
    isAudioPlaying: false,
    isVertical: true,
    isZonesEnabled: false,
    saveTimeout: null,
    translationObserver: null,
    syncTimeout: null // Для предотвращения зацикливания скролла
};

let ui = {};

document.addEventListener('DOMContentLoaded', async () => {
    initUI();
    
    // Инициализация
    try {
        await initDB();
        await refreshLibrary();
    } catch (e) {
        console.error("DB Init Error:", e);
        setStatus("Ошибка базы данных");
    }

    setupEventListeners();
    setupResizer();
    setupSelectionBar();
    setupNavigationZones();
    setupSwipeGestures();
    
    // Глобальный клик
    document.body.addEventListener('click', handleGlobalClicks);
});

function initUI() {
    ui = {
        libView: document.getElementById('library-view'),
        readerView: document.getElementById('reader-view'),
        bookGrid: document.getElementById('bookGrid'),
        fileInput: document.getElementById('libFileInput'),
        status: document.getElementById('statusLine'),
        loader: document.getElementById('loader'),
        
        container: document.getElementById('container'),
        panel1: document.getElementById('panel1'),
        panel2: document.getElementById('panel2'),
        orig: document.getElementById('origPanel'),
        trans: document.getElementById('transPanel'),
        resizer: document.getElementById('resizer'),
        
        topNav: document.querySelector('.top-nav-group'), 
        chapSel: document.getElementById('chapterSelect'),
        
        tooltip: document.getElementById('tooltip'),
        selBar: document.getElementById('selection-bar'),
        selBtn: document.getElementById('translateSelBtn'),
        
        imageModal: document.getElementById('image-modal'),
        modalImg: document.getElementById('modal-img-element'),
        modalClose: document.getElementById('modal-close'),

        voiceSrc: document.getElementById('voiceSource'),
        voiceRu: document.getElementById('voiceRu'),
        voiceEn: document.getElementById('voiceEn'),
        voiceDe: document.getElementById('voiceDe'),
        rateRange: document.getElementById('rateRange'),
        rateVal: document.getElementById('rateVal'),
        
        srcLang: document.getElementById('srcLang'),
        tgtLang: document.getElementById('tgtLang'),
        fontFamily: document.getElementById('fontFamily'),
        
        btnStart: document.getElementById('btnStart'),
        btnRead: document.getElementById('btnRead'),
        btnStop: document.getElementById('btnStop'),
        globalStop: document.getElementById('global-stop-btn'),
        layoutBtn: document.getElementById('layoutBtn'),
        zoneToggle: document.getElementById('zoneToggle'),
        
        zoneLeft: document.getElementById('nav-zone-left'),
        zoneRight: document.getElementById('nav-zone-right')
    };
}

// --- Event Listeners ---

function setupEventListeners() {
    // Настройки скорости
    if (ui.rateRange && ui.rateVal) {
        ui.rateRange.addEventListener('input', (e) => {
            ui.rateVal.innerText = e.target.value;
        });
        ui.rateVal.innerText = ui.rateRange.value;
    }

    // Загрузка файла
    if(ui.fileInput) {
        ui.fileInput.addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if(!f) return;
            showLoad();
            try {
                await saveBookToDB(f, { title: f.name });
                await refreshLibrary();
            } catch (err) {
                alert("Ошибка сохранения: " + err.message);
            } finally {
                hideLoad();
                ui.fileInput.value = null;
            }
        });
    }

    // Навигация
    document.getElementById('backToLib').onclick = () => {
        saveProgressNow();
        state.currentBookId = null;
        ui.readerView.classList.remove('active');
        ui.libView.classList.add('active');
        document.getElementById('settings-panel').classList.remove('open');
        stopAllWork();
        refreshLibrary();
    };

    document.getElementById('menu-toggle').onclick = () => {
        document.getElementById('settings-panel').classList.toggle('open');
    };
    
    ui.voiceSrc.onchange = () => {
        const mode = ui.voiceSrc.value;
        const voiceSettings = document.getElementById('voiceSettings');
        if (voiceSettings) voiceSettings.style.display = (mode === 'edge') ? 'flex' : 'none';
    };

    ui.chapSel.onchange = (e) => loadChapter(parseInt(e.target.value));
    document.getElementById('prevBtn').onclick = () => loadChapter(state.currentIdx - 1);
    document.getElementById('nextBtn').onclick = () => loadChapter(state.currentIdx + 1);

    // Управление воспроизведением
    ui.btnStart.onclick = startTranslation;
    ui.btnRead.onclick = startReading;
    ui.btnStop.onclick = stopAllWork;
    if(ui.globalStop) ui.globalStop.onclick = stopAllWork;

    // Внешний вид
    ui.layoutBtn.onclick = toggleLayout;

    ui.fontFamily.onchange = () => {
        document.body.classList.forEach(cls => {
            if (cls.startsWith('font-')) document.body.classList.remove(cls);
        });
        if(ui.fontFamily.value !== 'ui') document.body.classList.add(`font-${ui.fontFamily.value}`);
    };

    document.getElementById('fontSize').onchange = (e) => {
        document.documentElement.style.setProperty('--font-size', e.target.value);
    };
    
    document.getElementById('boldToggle').onclick = (e) => {
        document.body.classList.toggle('font-bold');
        e.target.classList.toggle('active-state');
    };

    if (ui.zoneToggle) {
        ui.zoneToggle.onclick = () => {
            state.isZonesEnabled = !state.isZonesEnabled;
            updateZonesState();
        };
    }

    // Модальное окно
    if(ui.modalClose) ui.modalClose.onclick = closeImageModal;
    if(ui.imageModal) ui.imageModal.onclick = (e) => { 
        if(e.target === ui.imageModal) closeImageModal(); 
    };

    setupSync();
    updateLayoutUI(); 
    updateZonesState();
}

function updateZonesState() {
    if (!ui.zoneToggle || !ui.zoneLeft || !ui.zoneRight) return;
    const action = state.isZonesEnabled ? 'add' : 'remove';
    ui.zoneToggle.classList[action]('active-state');
    ui.zoneLeft.classList[action]('active');
    ui.zoneRight.classList[action]('active');
}

// --- Library Logic ---

async function refreshLibrary() {
    const books = await getAllBooks();
    ui.bookGrid.innerHTML = '';
    
    if(books.length === 0) {
        ui.bookGrid.innerHTML = '<div style="color:#666;width:100%;text-align:center;padding-top:20px">Библиотека пуста</div>';
        return;
    }
    
    // Сортировка: недавно открытые первыми
    books.sort((a, b) => (b.lastRead || b.date) - (a.lastRead || a.date));

    const frag = document.createDocumentFragment();
    books.forEach(book => {
        const card = document.createElement('div'); 
        card.className = 'book-card';
        card.innerHTML = `
            <button class="delete-btn" title="Удалить">×</button>
            <div class="book-cover">📖</div>
            <div class="book-info">
                <div class="book-title">${book.name}</div>
                <div class="book-fmt">${book.type.toUpperCase()}</div>
            </div>
        `;
        
        const delBtn = card.querySelector('.delete-btn');
        delBtn.onclick = async (e) => { 
            e.stopPropagation(); 
            if(confirm(`Удалить книгу "${book.name}"?`)) { 
                await deleteBook(book.id); 
                refreshLibrary(); 
            }
        };
        
        card.onclick = () => openBook(book); 
        frag.appendChild(card);
    });
    ui.bookGrid.appendChild(frag);
}

function resetState() {
    clearTimeout(state.saveTimeout);
    if (state.translationObserver) {
        state.translationObserver.disconnect();
        state.translationObserver = null;
    }
    state.book = null;
    state.fb2Chapters = [];
    state.epubChapters = [];
    state.coverUrl = null;
    state.currentIdx = 0;
    state.currentBookId = null;
    
    ui.orig.innerHTML = '';
    ui.trans.innerHTML = '';
    ui.chapSel.innerHTML = '';
    if(ui.topNav) ui.topNav.style.display = 'none';
}

async function openBook(bookData) {
    resetState();
    ui.libView.classList.remove('active');
    ui.readerView.classList.add('active');
    
    state.currentBookId = bookData.id;
    const file = bookData.file;
    const progress = bookData.progress || { chapter: 0, scroll: 0 };
    
    setStatus(`Загрузка...`);
    showLoad();
    
    try {
        const n = file.name.toLowerCase();
        let textOrBuffer;

        if (n.endsWith('.fb2')) {
            ui.topNav.style.display = 'flex';
            textOrBuffer = await file.text();
            processFb2Data(textOrBuffer, progress);
        } else if (n.endsWith('.epub')) {
            ui.topNav.style.display = 'flex';
            textOrBuffer = await file.arrayBuffer();
            await processEpubData(textOrBuffer, progress);
        } else if (n.endsWith('.zip')) {
             const res = await loadZip(file);
             if(res.type === 'epub') { 
                 ui.topNav.style.display = 'flex'; 
                 await processEpubData(res.data, progress); 
             } else if(res.type === 'fb2') { 
                 ui.topNav.style.display = 'flex'; 
                 processFb2Data(res.data, progress); 
             } else { 
                 ui.topNav.style.display = 'none'; 
                 renderText(res.data); 
             }
        } else {
             // PDF или TXT
             ui.topNav.style.display = 'none';
             if (n.endsWith('.pdf')) {
                 textOrBuffer = await parsePdf(await file.arrayBuffer());
             } else {
                 textOrBuffer = await file.text();
             }
             renderText(textOrBuffer);
        }
        setStatus(file.name);
    } catch(err) { 
        console.error(err); 
        alert("Ошибка при открытии: " + err.message); 
        setStatus("Ошибка"); 
    } finally { 
        hideLoad(); 
    }
}

// --- Data Processing ---

function processFb2Data(text, progress) {
    state.fb2Chapters = parseFb2(text);
    fillChapterSelect(state.fb2Chapters);
    loadChapter(progress.chapter || 0, progress.scroll || 0);
}

async function processEpubData(buffer, progress) {
    const data = await parseEpub(buffer);
    state.book = data.book;
    state.epubChapters = data.chapters;
    if(data.coverUrl) state.coverUrl = data.coverUrl;
    fillChapterSelect(state.epubChapters);
    loadChapter(progress.chapter || 0, progress.scroll || 0);
}

function fillChapterSelect(chapters) {
    ui.chapSel.innerHTML = '';
    const frag = document.createDocumentFragment();
    chapters.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.text = c.title || `Глава ${i + 1}`;
        frag.appendChild(opt);
    });
    ui.chapSel.appendChild(frag);
}

async function loadChapter(idx, scrollTop = 0) {
    stopAllWork();
    
    let max = 0;
    if (state.epubChapters.length > 0) max = state.epubChapters.length - 1;
    else if (state.fb2Chapters.length > 0) max = state.fb2Chapters.length - 1;
    
    if (idx < 0) idx = 0; 
    if (idx > max && max > 0) idx = max;
    
    state.currentIdx = idx;
    ui.chapSel.value = idx;
    
    if (state.currentBookId) saveProgress(idx, 0);

    showLoad();
    try {
        let text = "";
        if(state.fb2Chapters.length > 0) {
            const chap = state.fb2Chapters[idx];
            text = getFb2ChapterText(chap.content, chap.images);
        } else if(state.epubChapters.length > 0) {
            const chap = state.epubChapters[idx];
            text = await getEpubChapterContent(state.book, chap);
            if (idx === 0 && state.coverUrl) text = `[IMG:${state.coverUrl}]\n\n` + text;
        }
        
        renderText(text);
        
        // Сброс скролла и анимация
        ui.orig.classList.remove('page-anim');
        void ui.orig.offsetWidth; // Trigger Reflow
        ui.orig.classList.add('page-anim');
        
        ui.orig.scrollTop = 0; 
        ui.trans.scrollTop = 0;
        
        if (scrollTop > 0) {
            setTimeout(() => { ui.orig.scrollTop = scrollTop; }, 50);
        }

        setupTranslationObserver();
    } catch(e) { 
        renderText("Ошибка отображения главы: " + e.message); 
    } finally { 
        hideLoad(); 
    }
}

// --- Rendering (ОПТИМИЗИРОВАНО) ---

function renderText(txt) {
    ui.orig.innerHTML = ''; 
    ui.trans.innerHTML = ''; 
    ui.orig.scrollTop = 0;

    // Разбиваем на параграфы, игнорируя пустые строки
    const arr = txt.split(/\n\s*\n/).filter(x => x.trim().length > 0);
    
    const f1 = document.createDocumentFragment(); 
    const f2 = document.createDocumentFragment();
    
    arr.forEach(s => {
        const imgMatch = s.match(/^\[IMG:(.+?)\]$/);
        
        if (imgMatch) {
            const imgSrc = imgMatch[1];
            const createImgBtn = () => { 
                const div = document.createElement('div'); 
                div.className = 'image-stub'; 
                div.dataset.src = imgSrc; 
                div.innerHTML = `<img class="preview" src="${imgSrc}" loading="lazy"><span>📷 Просмотр</span>`; 
                return div; 
            };
            f1.appendChild(createImgBtn()); 
            f2.appendChild(createImgBtn());
        } else {
            // ОПТИМИЗАЦИЯ: Не создаем SPAN для каждого слова. Рендерим чистый текст.
            const d1 = document.createElement('div'); 
            d1.className = 'orig-p'; 
            d1.textContent = s; // Безопасный рендер текста
            f1.appendChild(d1);
            
            const d2 = document.createElement('div'); 
            d2.className = 'trans-p'; 
            d2.dataset.text = s; 
            // Кнопка звука добавляется сразу, перевод загружается лениво
            d2.innerHTML = `<button class="para-tts-btn">🔊</button><span class="trans-content">${s}</span>`; 
            f2.appendChild(d2);
        }
    });
    
    ui.orig.appendChild(f1); 
    ui.trans.appendChild(f2);
}

function setupTranslationObserver() {
    if (state.translationObserver) state.translationObserver.disconnect();
    
    const src = ui.srcLang.value; 
    const tgt = ui.tgtLang.value;
    
    state.translationObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(async (entry) => {
            if (entry.isIntersecting) {
                const el = entry.target; 
                observer.unobserve(el);
                
                const text = el.dataset.text; 
                if (!text) return;
                
                try {
                    // Проверяем кэш только для видимых элементов
                    const t = await getCachedTranslation(text, src, tgt);
                    if (t && el.isConnected && !el.classList.contains('translated')) {
                        requestAnimationFrame(() => { 
                             applyTranslation(el, t);
                        });
                    }
                } catch (e) { console.warn(e); }
            }
        });
    }, { root: ui.trans, rootMargin: '300px' });
    
    // Наблюдаем за параграфами перевода
    const els = ui.trans.querySelectorAll('.trans-p:not(.translated):not(.image-stub)');
    els.forEach(el => state.translationObserver.observe(el));
}

function applyTranslation(el, text) {
    const btn = el.querySelector('.para-tts-btn');
    const content = el.querySelector('.trans-content') || el;
    // Сохраняем кнопку, меняем текст
    if(btn) {
        // Очищаем контент кроме кнопки
        while(el.childNodes.length > 1) { el.removeChild(el.lastChild); }
        el.insertAdjacentText('beforeend', text);
    } else {
        el.innerHTML = `<button class="para-tts-btn">🔊</button>${text}`;
    }
    el.classList.add('translated');
}

// --- Sync & Scroll (ОПТИМИЗИРОВАНО) ---

function setupSync() {
    // Используем индексный метод вместо процентного для точности
    const sync = (source, target) => {
        if(state.syncTimeout) return;
        
        state.syncTimeout = setTimeout(() => {
            const sourceParas = source.children;
            const targetParas = target.children;
            if(sourceParas.length === 0 || targetParas.length === 0) {
                 state.syncTimeout = null;
                 return;
            }

            // Находим верхний видимый элемент
            const offset = source.scrollTop;
            let idx = -1;
            
            // Бинарный поиск или простой перебор (здесь простой, т.к. элементов не миллион)
            for(let i=0; i < sourceParas.length; i++) {
                const p = sourceParas[i];
                if(p.offsetTop + p.clientHeight > offset) {
                    idx = i;
                    break;
                }
            }
            
            if(idx !== -1 && targetParas[idx]) {
                const tP = targetParas[idx];
                // Плавная корректировка
                target.scrollTop = tP.offsetTop; 
            }
            
            state.syncTimeout = null;
            if(source === ui.orig) saveProgress();
        }, 50); // Debounce
    };

    ui.orig.onscroll = () => sync(ui.orig, ui.trans);
    // Обратную синхронизацию часто лучше отключить или делать очень аккуратно,
    // чтобы они не боролись друг с другом. Здесь оставим только Orig -> Trans
    // ui.trans.onscroll = () => sync(ui.trans, ui.orig); 
}

// --- Resize Logic (ОПТИМИЗИРОВАНО) ---

function setupResizer() {
    let isResizing = false;
    let rAF = null;

    const start = (e) => { 
        isResizing = true; 
        if(e.type === 'touchstart') e.preventDefault(); 
        ui.resizer.classList.add('active'); 
    };
    const stop = () => { 
        isResizing = false; 
        ui.resizer.classList.remove('active'); 
        if(rAF) cancelAnimationFrame(rAF);
    };
    
    const move = (e) => {
        if(!isResizing) return;
        if(rAF) return; // Пропуск кадров, если браузер занят

        rAF = requestAnimationFrame(() => {
            let clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
            let clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
            const rect = ui.container.getBoundingClientRect();
            
            let pct;
            if(state.isVertical) {
                pct = ((clientY - rect.top) / rect.height) * 100;
            } else {
                pct = ((clientX - rect.left) / rect.width) * 100;
            }
            
            if(pct > 10 && pct < 90) {
                ui.panel1.style.flex = `0 0 ${pct}%`;
                // Panel 2 автоматически займет остальное место
            }
            rAF = null;
        });
    };

    ui.resizer.addEventListener('mousedown', start);
    ui.resizer.addEventListener('touchstart', start);
    
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
    
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move);
}

// --- Interaction Logic (Клик по словам) ---

async function handleGlobalClicks(e) {
    const target = e.target;

    // 1. Клик по картинке
    if (target.closest('.image-stub')) { 
        const stub = target.closest('.image-stub'); 
        if(stub.dataset.src) openImageModal(stub.dataset.src); 
        return;
    }
    
    // 2. TTS кнопка
    if(target.classList.contains('para-tts-btn')) { 
        e.stopPropagation(); 
        const p = target.closest('.trans-p'); 
        
        // Сначала переводим, если не переведено
        if(!p.classList.contains('translated')) {
            const success = await doTrans(p);
            if(!success) return;
        }
        
        stopAudio(); 
        state.isAudioPlaying = true; 
        target.classList.add('playing'); 
        
        const textToRead = p.innerText.replace('🔊', '').trim();
        await playFullAudio(textToRead, ui.tgtLang.value); 
        
        target.classList.remove('playing'); 
        showGlobalStop(false); 
        state.isAudioPlaying = false; 
        return;
    }
    
    // 3. Клик по абзацу перевода (перевести его)
    if(target.closest('.trans-p') && !target.closest('.image-stub')) { 
        doTrans(target.closest('.trans-p')); 
        return;
    }
    
    // 4. Клик по слову в оригинале (Новая логика без SPAN)
    if(target.closest('.orig-p')) {
        handleWordClick(e);
        return;
    }

    // 5. Закрытие тултипа
    if(target.classList.contains('close-tip') || (!target.closest('#tooltip') && ui.tooltip.style.display === 'block')) {
         ui.tooltip.style.display = 'none'; 
    }
}

// Функция для определения слова под курсором без SPAN
function handleWordClick(e) {
    const sel = window.getSelection();
    
    // Если пользователь выделил текст сам, не мешаем ему
    if (sel.toString().length > 1) return;

    // Пытаемся выделить слово автоматически
    if (sel.isCollapsed) {
        // Расширяем выделение до слова
        sel.modify("move", "forward", "character");
        sel.modify("move", "backward", "word");
        sel.modify("extend", "forward", "word");
    }
    
    const word = sel.toString().trim();
    if (word && /^[a-zA-Zа-яА-Я0-9\u00C0-\u00FF'-]+$/.test(word)) {
        showTooltip(e.target, word); // Передаем target для позиционирования, но позицию возьмем из мыши лучше
    }
}

// --- Translation & TTS Logic ---

async function doTrans(el) {
    if(el.classList.contains('translated')) return true;
    
    el.classList.add('loading', 'current');
    const text = el.dataset.text;
    const src = ui.srcLang.value;
    const tgt = ui.tgtLang.value;
    
    try {
        let t = await getCachedTranslation(text, src, tgt);
        if (!t) {
            t = await translateApi(text, src, tgt);
            if (t) await saveCachedTranslation(text, src, tgt, t);
        }
        applyTranslation(el, t);
        return true;
    } catch (e) { 
        el.classList.add('error'); 
        return false; 
    } finally { 
        el.classList.remove('loading', 'current'); 
    }
}

async function playFullAudio(text, lang) {
    showGlobalStop(true);
    const provider = ui.voiceSrc.value;
    const rate = ui.rateRange ? parseFloat(ui.rateRange.value) : 1.0;
    
    // Улучшенная разбивка на предложения
    const chunks = text.match(/[^.!?\s][^.!?]*(?:[.!?](?!['"]?\s|$)[^.!?]*)*[.!?]?['"]?(?=\s|$)/g) || [text];
    
    for (let chunk of chunks) {
        if(!state.isWorking && !state.isAudioPlaying) break;
        chunk = chunk.trim();
        if(!chunk) continue;
        
        if (provider === 'google') {
            // Google TTS имеет лимит символов
             if (chunk.length > 180) {
                 const subs = chunk.match(/.{1,180}(?:\s|$)/g);
                 if(subs) {
                     for(let s of subs) await playGoogleSingle(s, lang, rate);
                     continue;
                 }
             }
             await playGoogleSingle(chunk, lang, rate);
        } else {
            let gender = 'f';
            if (lang.startsWith('ru')) gender = ui.voiceRu.value;
            else if (lang.startsWith('en')) gender = ui.voiceEn.value;
            else if (lang.startsWith('de')) gender = ui.voiceDe.value;
            await speakDevice(text, lang, gender, provider, rate);
            break; // Device TTS обычно читает всё сразу
        }
    }
    
    if(!state.isWorking) showGlobalStop(false);
}

// --- Helpers ---

async function startTranslation() {
    if(state.isWorking) return;
    state.isWorking = true;
    updateWorkButtons(true);
    
    const els = Array.from(ui.trans.querySelectorAll('.trans-p:not(.image-stub)'));
    const idx = getStartIndex(els);
    
    for(let i = idx; i < els.length; i++) {
        if(!state.isWorking) break;
        if(!els[i].classList.contains('translated')) {
            await doTrans(els[i]);
            els[i].scrollIntoView({behavior:"smooth", block:"center"});
            await sleep(400);
        }
    }
    stopAllWork();
}

async function startReading() {
    if(state.isWorking) return;
    state.isWorking = true;
    updateWorkButtons(true);
    
    const els = Array.from(ui.trans.querySelectorAll('.trans-p:not(.image-stub)'));
    const idx = getStartIndex(els);
    const lang = ui.tgtLang.value;
    
    for(let i = idx; i < els.length; i++) {
        if(!state.isWorking) break;
        const el = els[i];
        
        if(!el.classList.contains('translated')) {
            await doTrans(el);
            await sleep(300);
        }
        
        document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading'));
        el.classList.add('reading');
        el.scrollIntoView({behavior:"smooth", block:"center"});
        
        const btn = el.querySelector('.para-tts-btn');
        if(btn) btn.classList.add('playing');
        
        const txt = el.innerText.replace('🔊','').trim();
        await playFullAudio(txt, lang);
        
        if(btn) btn.classList.remove('playing');
        await sleep(200);
    }
    stopAllWork();
}

function stopAllWork() {
    state.isWorking = false;
    state.isAudioPlaying = false;
    stopAudio();
    updateWorkButtons(false);
    showGlobalStop(false);
    document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
    document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading'));
}

function updateWorkButtons(working) {
    ui.btnStart.disabled = working;
    ui.btnRead.disabled = working;
    ui.btnStop.disabled = !working;
}

function getStartIndex(elements) {
    const top = ui.trans.scrollTop;
    // Находим первый элемент, который виден или ниже линии скролла
    let idx = elements.findIndex(b => b.offsetTop + b.clientHeight > top);
    return idx === -1 ? 0 : idx;
}

// Вспомогательная функция для тултипа
async function showTooltip(targetEl, text) {
    // Позиционирование
    // Лучше использовать координаты выделения, но пока оставим привязку к параграфу + смещение
    const rect = targetEl.getBoundingClientRect(); // Это будет rect всего параграфа
    
    // Пытаемся получить координаты выделения
    const sel = window.getSelection();
    let left = rect.left;
    let top = rect.bottom;
    
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0).getBoundingClientRect();
        left = range.left;
        top = range.bottom;
    }

    if (left + 250 > window.innerWidth) left = window.innerWidth - 260;
    if (left < 10) left = 10;

    ui.tooltip.style.top = (top + 5) + 'px';
    ui.tooltip.style.left = left + 'px';
    ui.tooltip.style.display = 'block';
    
    ui.tooltip.innerHTML = `<span class="t-word">${text}</span><span>⏳...</span>`;

    try {
        const lang = ui.srcLang.value;
        const [trans, phon] = await Promise.all([
            translateApi(text, lang, ui.tgtLang.value),
            fetchPhonetics(text, lang)
        ]);
        
        const targetLang = lang === 'auto' ? 'en' : lang;
        
        ui.tooltip.innerHTML = `
            <div class="tt-header">
                <span class="t-word">${text}</span>
                <button class="t-tts-btn">🔊</button>
            </div>
            ${phon.ipa ? `<span class="t-ipa">[${phon.ipa}]</span>` : ''} 
            ${phon.cyr ? `<span class="t-rus">"${phon.cyr}"</span>` : ''}
            <span class="t-trans">${trans}</span>
            <button class="close-tip">X</button>
        `;
        
        ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => { 
            e.stopPropagation(); 
            e.target.classList.add('playing'); 
            await playFullAudio(text, targetLang); 
            e.target.classList.remove('playing'); 
        };
    } catch(e) {
        ui.tooltip.innerHTML = "Ошибка перевода";
    }
}

// Navigation Zones & Swipe
function setupNavigationZones() {
    const nav = (dir) => {
        const amount = window.innerHeight * 0.8;
        const el = ui.orig;
        
        // Проверка на конец/начало главы
        if (dir === 1 && el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
            loadChapter(state.currentIdx + 1);
        } else if (dir === -1 && el.scrollTop <= 0) {
            loadChapter(state.currentIdx - 1);
        } else {
            el.scrollBy({ top: amount * dir, behavior: 'smooth' });
        }
    };
    if(ui.zoneRight) ui.zoneRight.onclick = (e) => { e.stopPropagation(); nav(1); };
    if(ui.zoneLeft) ui.zoneLeft.onclick = (e) => { e.stopPropagation(); nav(-1); };
}

function setupSwipeGestures() {
    let tsX = 0, tsY = 0;
    ui.container.addEventListener('touchstart', (e) => { tsX = e.changedTouches[0].screenX; tsY = e.changedTouches[0].screenY; }, {passive: true});
    ui.container.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].screenX - tsX;
        const dy = e.changedTouches[0].screenY - tsY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
            if (dx < 0) loadChapter(state.currentIdx + 1); 
            else loadChapter(state.currentIdx - 1);
        }
    }, {passive: true});
}

function setupSelectionBar() {
    let selTimeout;
    document.addEventListener('selectionchange', () => {
        clearTimeout(selTimeout);
        selTimeout = setTimeout(() => {
            const sel = window.getSelection();
            if(!sel.rangeCount) return;
            const txt = sel.toString().trim();
            
            // Показываем бар только если выделение внутри панели оригинала и длинное
            if(txt.length > 1 && ui.orig.contains(sel.anchorNode)) {
                ui.selBar.classList.add('visible');
                // Сохраняем текст в замыкании кнопки (или глобально, но лучше через атрибут)
                ui.selBtn.dataset.text = txt;
            } else {
                ui.selBar.classList.remove('visible');
            }
        }, 300);
    });
    
    if(ui.selBtn) {
        ui.selBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const txt = ui.selBtn.dataset.text;
            if(txt) {
                showPopupPhrase(txt);
                ui.selBar.classList.remove('visible');
            }
        };
    }
}

async function showPopupPhrase(text) {
    ui.tooltip.style.display='block';
    ui.tooltip.style.top='50%';
    ui.tooltip.style.left='50%';
    ui.tooltip.style.transform='translate(-50%,-50%)';
    ui.tooltip.style.maxWidth='80%';
    ui.tooltip.innerHTML = `<span class="t-word">${text.substring(0,50)}...</span><span>⏳</span>`;
    
    try {
        const trans = await translateApi(text, ui.srcLang.value, ui.tgtLang.value);
        const safeText = text.replace(/'/g, "\\'").replace(/\n/g, ' ');
        const lang = ui.srcLang.value === 'auto' ? 'en' : ui.srcLang.value;
        
        ui.tooltip.innerHTML = `
            <div class="tt-header">
                <span class="t-word">${text.substring(0,30)}...</span>
                <button class="t-tts-btn">🔊</button>
            </div>
            <span class="t-trans">${trans}</span>
            <button class="close-tip">X</button>
        `;
        
        ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => {
            e.stopPropagation(); e.target.classList.add('playing');
            await playFullAudio(safeText, lang);
            e.target.classList.remove('playing');
        };
    } catch(e) {
        ui.tooltip.innerHTML="Error";
    }
}

// Utils
function openImageModal(src) { if(ui.modalImg && ui.imageModal) { ui.modalImg.src = src; ui.imageModal.classList.add('visible'); } }
function closeImageModal() { if(ui.imageModal) ui.imageModal.classList.remove('visible'); setTimeout(() => { if(ui.modalImg) ui.modalImg.src = ""; }, 300); }
function toggleLayout() { state.isVertical = !state.isVertical; updateLayoutUI(); }
function updateLayoutUI() { 
    if (state.isVertical) { 
        ui.container.style.flexDirection = 'column'; 
        ui.resizer.style.cssText = 'width:100%; height:12px; cursor:row-resize;'; 
        ui.layoutBtn.innerText = '⬍'; 
    } else { 
        ui.container.style.flexDirection = 'row'; 
        ui.resizer.style.cssText = 'width:12px; height:100%; cursor:col-resize;'; 
        ui.layoutBtn.innerText = '⬄'; 
    } 
    ui.panel1.style.flex = '1'; ui.panel2.style.flex = '1'; 
}

function saveProgress(ch, sc) { clearTimeout(state.saveTimeout); state.saveTimeout = setTimeout(() => saveProgressNow(ch, sc), 1000); }
function saveProgressNow(ch, sc) { 
    if (!state.currentBookId) return; 
    const c = (ch !== undefined) ? ch : state.currentIdx; 
    const s = (sc !== undefined) ? sc : ui.orig.scrollTop; 
    updateBookProgress(state.currentBookId, c, s); 
}

const setStatus = (msg) => ui.status.innerText = msg;
const showLoad = () => ui.loader.style.display = 'flex';
const hideLoad = () => ui.loader.style.display = 'none';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const showGlobalStop = (show) => { if (ui.globalStop) ui.globalStop.style.display = show ? 'flex' : 'none'; state.isAudioPlaying = show; };