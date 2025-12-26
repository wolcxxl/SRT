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
    isPaged: false,         // <--- НОВЫЙ ФЛАГ
    totalCharCount: 0,      // <--- ОБЩЕЕ КОЛ-ВО СИМВОЛОВ (для расчета страниц)
    chapterCharCounts: [],  // Символы по главам
    t_sync: null,
    saveTimeout: null,
    translationObserver: null
};

let ui = {};

document.addEventListener('DOMContentLoaded', async () => {
    initUI();
    await initDB();
    refreshLibrary();
    setupEventListeners();
    setupResizer();
    setupSelectionBar();
    setupNavigationZones();
    setupSwipeGestures();
    
    document.body.addEventListener('click', handleGlobalClicks);
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => {};
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
        pagedToggle: document.getElementById('pagedToggle'), // <--- НОВАЯ КНОПКА
        pageCounter: document.getElementById('page-counter'), // <--- СЧЕТЧИК
        
        zoneLeft: document.getElementById('nav-zone-left'),
        zoneRight: document.getElementById('nav-zone-right')
    };
}

function setupEventListeners() {
    // ... (стандартные листенеры, без изменений) ...
    const range = document.getElementById('rateRange');
    const label = document.getElementById('rateVal');
    if (range && label) {
        range.oninput = null;
        range.addEventListener('input', function() { label.innerText = this.value; });
        label.innerText = range.value;
    }

    if(ui.fileInput) {
        ui.fileInput.addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if(!f) return;
            showLoad();
            await saveBookToDB(f, { title: f.name });
            await refreshLibrary();
            hideLoad();
            ui.fileInput.value = null;
        });
    }

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
        document.getElementById('voiceSettings').style.display = (mode === 'edge') ? 'flex' : 'none';
    };

    ui.chapSel.onchange = (e) => loadChapter(parseInt(e.target.value));
    document.getElementById('prevBtn').onclick = () => prevPageOrChapter();
    document.getElementById('nextBtn').onclick = () => nextPageOrChapter();

    ui.btnStart.onclick = startTranslation;
    ui.btnRead.onclick = startReading;
    ui.btnStop.onclick = stopAllWork;
    if(ui.globalStop) ui.globalStop.onclick = stopAllWork;

    ui.layoutBtn.onclick = toggleLayout;
    
    // --- ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМА СТРАНИЦ ---
    if(ui.pagedToggle) {
        ui.pagedToggle.onclick = () => {
            state.isPaged = !state.isPaged;
            updatePagedMode();
        };
    }

    ui.fontFamily.onchange = () => {
        document.body.className = document.body.className.replace(/font-\w+/g, '');
        if(ui.fontFamily.value !== 'ui') document.body.classList.add(`font-${ui.fontFamily.value}`);
        updatePageCountDisplay(); // Пересчет при смене шрифта
    };
    document.getElementById('fontSize').onchange = (e) => {
        document.documentElement.style.setProperty('--font-size', e.target.value);
        updatePageCountDisplay(); // Пересчет при смене размера
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

    if(ui.modalClose) ui.modalClose.onclick = closeImageModal;
    if(ui.imageModal) ui.imageModal.onclick = (e) => { if(e.target === ui.imageModal) closeImageModal(); };

    setupSync();
    updateLayoutUI(); 
    updateZonesState();
}

function updateZonesState() {
    if (state.isZonesEnabled) {
        ui.zoneToggle.classList.add('active-state');
        ui.zoneLeft.classList.add('active');
        ui.zoneRight.classList.add('active');
    } else {
        ui.zoneToggle.classList.remove('active-state');
        ui.zoneLeft.classList.remove('active');
        ui.zoneRight.classList.remove('active');
    }
}

function updatePagedMode() {
    if (state.isPaged) {
        ui.pagedToggle.classList.add('active-state');
        ui.container.classList.add('paged-view');
        ui.pageCounter.style.display = 'block';
        // Принудительно скроллим в начало текущей "страницы"
        ui.orig.scrollLeft = 0;
        updatePageCountDisplay();
    } else {
        ui.pagedToggle.classList.remove('active-state');
        ui.container.classList.remove('paged-view');
        ui.pageCounter.style.display = 'none';
    }
}

// === ЛОГИКА СТРАНИЦ ===

// Вычисляем "Примерное" количество страниц во всей книге
function calculateTotalPagesEstimate() {
    if (!ui.orig || ui.orig.innerText.length < 100) return { current: 1, total: 1 };

    // 1. Сколько символов влезает на ОДИН экран?
    // Берем текущий текст главы и делим его длину на кол-во экранов, которое он занимает
    const screenWidth = ui.orig.clientWidth;
    const scrollW = ui.orig.scrollWidth;
    const textLen = ui.orig.innerText.length;
    
    // Количество экранов в текущей главе
    const screensInChapter = Math.ceil(scrollW / screenWidth) || 1;
    
    // Среднее кол-во символов на страницу
    const charsPerPage = textLen / screensInChapter;

    // 2. Считаем глобальные страницы
    // Суммируем символы всех глав (мы их не грузим, но можем знать длину, если сохраним при парсинге. 
    // Пока упростим: считаем "прогресс" относительно текущей главы)
    
    // Упрощенный "честный" расчет для текущей главы + эмуляция глобального
    // Чтобы было "12 из 500", нам нужно знать длину всей книги. 
    // Если мы ее не знаем точно, будем эмулировать на основе позиции главы.
    
    const totalChapters = Math.max(state.epubChapters.length, state.fb2Chapters.length) || 1;
    const avgChapterLen = charsPerPage * 10; // Допустим, в главе 10 страниц
    const estimatedTotalPages = Math.ceil((state.totalCharCount || (textLen * totalChapters)) / charsPerPage);
    
    // Текущая страница в главе (0-based)
    const currentScreenIdx = Math.round(ui.orig.scrollLeft / screenWidth);
    
    // Страниц до текущей главы (грубо)
    let pagesBefore = 0;
    for(let i=0; i<state.currentIdx; i++) {
        // Если есть данные о длине глав - используем, иначе берем среднее
        pagesBefore += (state.chapterCharCounts[i] ? Math.ceil(state.chapterCharCounts[i] / charsPerPage) : 10);
    }
    
    const globalPage = pagesBefore + currentScreenIdx + 1;
    const globalTotal = Math.max(estimatedTotalPages, globalPage); // Чтобы не было "100 из 50"
    
    return { current: globalPage, total: globalTotal };
}

function updatePageCountDisplay() {
    if (!state.isPaged) return;
    const count = calculateTotalPagesEstimate();
    ui.pageCounter.innerText = `Стр. ${count.current} из ${count.total}`;
}

// Навигация ВПЕРЕД (Страница или Глава)
function nextPageOrChapter() {
    if (state.isPaged) {
        const el = ui.orig;
        // Если можно скроллить вправо (есть еще страницы в этой главе)
        // Допуск 10px на погрешность
        if (el.scrollLeft + el.clientWidth < el.scrollWidth - 10) {
            el.scrollBy({ left: el.clientWidth, behavior: 'smooth' });
        } else {
            // Конец главы -> следующая глава
            loadChapter(state.currentIdx + 1);
        }
        setTimeout(updatePageCountDisplay, 300);
    } else {
        // Старый режим
        loadChapter(state.currentIdx + 1);
    }
}

// Навигация НАЗАД
function prevPageOrChapter() {
    if (state.isPaged) {
        const el = ui.orig;
        if (el.scrollLeft > 10) {
            el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
        } else {
            // Начало главы -> пред. глава (и нужно бы прокрутить в конец, но пока в начало)
            loadChapter(state.currentIdx - 1);
        }
        setTimeout(updatePageCountDisplay, 300);
    } else {
        loadChapter(state.currentIdx - 1);
    }
}

// ... (resetState, refreshLibrary - без изменений) ...

function resetState() {
    clearTimeout(state.saveTimeout);
    if (state.translationObserver) {
        state.translationObserver.disconnect();
        state.translationObserver = null;
    }
    state.book = null;
    state.fb2Chapters = [];
    state.epubChapters = [];
    state.chapterCharCounts = []; // Очищаем счетчик символов
    state.totalCharCount = 0;
    state.coverUrl = null;
    state.currentIdx = 0;
    state.currentBookId = null;
    
    ui.orig.innerHTML = '';
    ui.trans.innerHTML = '';
    ui.chapSel.innerHTML = '';
    if(ui.topNav) ui.topNav.style.display = 'none';
}

// ... (openBook - без изменений) ...
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
        if(n.endsWith('.fb2')) {
            if(ui.topNav) ui.topNav.style.display = 'flex';
            processFb2Data(await file.text(), progress);
        }
        else if(n.endsWith('.epub')) {
            if(ui.topNav) ui.topNav.style.display = 'flex';
            await processEpubData(await file.arrayBuffer(), progress);
        }
        else if(n.endsWith('.pdf')) {
            if(ui.topNav) ui.topNav.style.display = 'none';
            const text = await parsePdf(await file.arrayBuffer());
            renderText(text);
        }
        else if(n.endsWith('.zip')) {
             const res = await loadZip(file);
             if(res.type === 'epub') {
                 if(ui.topNav) ui.topNav.style.display = 'flex';
                 await processEpubData(res.data, progress);
             }
             else if(res.type === 'fb2') {
                 if(ui.topNav) ui.topNav.style.display = 'flex';
                 processFb2Data(res.data, progress);
             }
             else {
                 if(ui.topNav) ui.topNav.style.display = 'none';
                 renderText(res.data);
             }
        } 
        else {
             if(ui.topNav) ui.topNav.style.display = 'none';
             renderText(await file.text());
        }
        
        // Восстановление режима страниц, если был
        updatePagedMode();
        setStatus(file.name);
    } catch(err) { console.error(err); alert("Ошибка: " + err.message); setStatus("Ошибка"); } finally { hideLoad(); }
}

function processFb2Data(text, progress) {
    state.fb2Chapters = parseFb2(text);
    ui.chapSel.innerHTML = '';
    
    // Считаем символы
    state.totalCharCount = 0;
    state.chapterCharCounts = state.fb2Chapters.map(c => {
        // Грубая оценка длины контента (текст + теги)
        const len = c.content.textContent.length; 
        state.totalCharCount += len;
        return len;
    });

    state.fb2Chapters.forEach((c, i) => ui.chapSel.add(new Option(c.title, i)));
    loadChapter(progress.chapter || 0, progress.scroll || 0);
}

async function processEpubData(buffer, progress) {
    try {
        const data = await parseEpub(buffer);
        state.book = data.book;
        state.epubChapters = data.chapters;
        if(data.coverUrl) state.coverUrl = data.coverUrl;
        
        setStatus(data.title);
        ui.chapSel.innerHTML = '';
        
        // Для EPUB сложно узнать длину всех глав сразу без загрузки.
        // Будем считать динамически или брать среднее.
        // Пока ставим заглушку, будет пересчитываться при чтении
        state.totalCharCount = state.epubChapters.length * 5000; // Примерно 5000 символов на главу

        state.epubChapters.forEach((c, i) => ui.chapSel.add(new Option(c.title, i)));
        loadChapter(progress.chapter || 0, progress.scroll || 0);
    } catch (e) { throw new Error(e.message); }
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
        
        ui.orig.classList.remove('page-anim');
        void ui.orig.offsetWidth; 
        ui.orig.classList.add('page-anim');

        // Сброс скролла
        ui.orig.scrollTop = 0;
        ui.orig.scrollLeft = 0;

        if (scrollTop > 0) {
            // Если мы в режиме страниц, нужно сконвертировать вертикальный скролл в горизонтальный?
            // Пока просто восстанавливаем как есть, пользователь сам переключится.
            setTimeout(() => { ui.orig.scrollTop = scrollTop; }, 50);
        }

        restoreChapterTranslations();
        // Обновляем счетчик
        setTimeout(updatePageCountDisplay, 100);
        
    } catch(e) { renderText("Ошибка: " + e.message); } finally { hideLoad(); }
}

// --- НОВЫЙ SETUP ЗОН И СВАЙПОВ (Для поддержки страниц) ---

function setupNavigationZones() {
    // Единая логика для клика по зоне
    const handleZoneClick = (direction) => {
        if (state.isPaged) {
            // В режиме страниц: листаем экранами
            if (direction === 1) nextPageOrChapter();
            else prevPageOrChapter();
        } else {
            // В обычном режиме: скроллим вниз/вверх
            const scrollAmount = window.innerHeight * 0.8;
            const el = ui.orig;
            if (direction === 1 && el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
                loadChapter(state.currentIdx + 1);
            } else if (direction === -1 && el.scrollTop <= 0) {
                loadChapter(state.currentIdx - 1);
            } else {
                el.scrollBy({ top: scrollAmount * direction, behavior: 'smooth' });
            }
        }
    };

    if(ui.zoneRight) ui.zoneRight.onclick = (e) => { e.stopPropagation(); handleZoneClick(1); };
    if(ui.zoneLeft) ui.zoneLeft.onclick = (e) => { e.stopPropagation(); handleZoneClick(-1); };
}

function setupSwipeGestures() {
    let touchStartX = 0, touchStartY = 0;
    ui.container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, {passive: true});
    
    ui.container.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].screenX - touchStartX;
        const dy = e.changedTouches[0].screenY - touchStartY;
        
        // Определяем свайп
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
            // Горизонтальный свайп
            if (dx < 0) {
                // Свайп влево -> Вперед
                if (state.isPaged) nextPageOrChapter();
                else loadChapter(state.currentIdx + 1);
            } else {
                // Свайп вправо -> Назад
                if (state.isPaged) prevPageOrChapter();
                else loadChapter(state.currentIdx - 1);
            }
        }
    }, {passive: true});
    
    // Добавляем слушатель скролла для обновления счетчика в реальном времени
    ui.orig.addEventListener('scroll', () => {
        if(state.isPaged) {
             // Используем throttle
             if(!state.cntTimer) {
                 state.cntTimer = setTimeout(() => {
                     updatePageCountDisplay();
                     state.cntTimer = null;
                 }, 500);
             }
        }
    });
}

// ... (остальные функции: saveProgress, renderText, restoreChapterTranslations и т.д. без изменений) ...

function saveProgress(chapterIdx, scrollTop) {
    clearTimeout(state.saveTimeout);
    state.saveTimeout = setTimeout(() => {
        saveProgressNow(chapterIdx, scrollTop);
    }, 1000);
}

function saveProgressNow(chapterIdx, scrollTop) {
    if (!state.currentBookId) return;
    const ch = (chapterIdx !== undefined) ? chapterIdx : state.currentIdx;
    const scr = (scrollTop !== undefined) ? scrollTop : ui.orig.scrollTop;
    updateBookProgress(state.currentBookId, ch, scr);
}

function renderText(txt) {
    ui.orig.innerHTML = ''; ui.trans.innerHTML = ''; ui.orig.scrollTop = 0;
    const arr = txt.split(/\n\s*\n/).filter(x => x.trim().length > 0);
    const f1 = document.createDocumentFragment(); const f2 = document.createDocumentFragment();
    
    arr.forEach(s => {
        const imgMatch = s.match(/^\[IMG:(.+?)\]$/);
        if (imgMatch) {
            const imgSrc = imgMatch[1];
            const createImgBtn = () => {
                const div = document.createElement('div'); div.className = 'image-stub';
                div.dataset.src = imgSrc;
                div.innerHTML = `<img class="preview" src="${imgSrc}"><span>📷 Просмотр</span>`;
                return div;
            };
            const d1 = createImgBtn(); d1.classList.add('orig-p'); f1.appendChild(d1);
            const d2 = createImgBtn(); d2.classList.add('trans-p', 'translated'); f2.appendChild(d2);
        } else {
            const d1 = document.createElement('div'); d1.className = 'orig-p';
            d1.innerHTML = s.replace(/([a-zA-Zа-яА-Я0-9\u00C0-\u00FF'-]+)/g, '<span class="word" data-word="$1">$1</span>');
            f1.appendChild(d1);
            const d2 = document.createElement('div'); d2.className = 'trans-p'; d2.dataset.text = s;
            d2.innerHTML = `<button class="para-tts-btn">🔊</button>${s}`;
            f2.appendChild(d2);
        }
    });
    ui.orig.appendChild(f1); ui.trans.appendChild(f2);
    // При рендере в режиме страниц обновляем счетчик
    if(state.isPaged) updatePageCountDisplay();
}

function restoreChapterTranslations() {
    if (state.translationObserver) { state.translationObserver.disconnect(); }
    const src = ui.srcLang.value; const tgt = ui.tgtLang.value;
    state.translationObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(async (entry) => {
            if (entry.isIntersecting) {
                const el = entry.target; observer.unobserve(el);
                const text = el.dataset.text; if (!text) return;
                try {
                    const t = await getCachedTranslation(text, src, tgt);
                    if (t && el.isConnected && !el.classList.contains('translated')) {
                        requestAnimationFrame(() => { el.innerHTML = `<button class="para-tts-btn">🔊</button>${t}`; el.classList.add('translated'); });
                    }
                } catch (e) { }
            }
        });
    }, { root: ui.trans, rootMargin: '500px' });
    const els = document.querySelectorAll('.trans-p:not(.translated):not(.image-stub)');
    els.forEach(el => state.translationObserver.observe(el));
}

function openImageModal(src) { if(ui.modalImg && ui.imageModal) { ui.modalImg.src = src; ui.imageModal.classList.add('visible'); } }
function closeImageModal() { if(ui.imageModal) ui.imageModal.classList.remove('visible'); setTimeout(() => { if(ui.modalImg) ui.modalImg.src = ""; }, 300); }

async function handleGlobalClicks(e) {
    if (e.target.closest('.image-stub')) { const stub = e.target.closest('.image-stub'); if(stub.dataset.src) openImageModal(stub.dataset.src); }
    else if(e.target.classList.contains('word')) { showTooltip(e.target, e.target.dataset.word); }
    else if(e.target.classList.contains('para-tts-btn')) { e.stopPropagation(); const p = e.target.closest('.trans-p'); if(!p.classList.contains('translated')) await doTrans(p); stopAudio(); state.isAudioPlaying = true; e.target.classList.add('playing'); await playFullAudio(p.innerText.replace('🔊', '').trim(), ui.tgtLang.value); e.target.classList.remove('playing'); showGlobalStop(false); state.isAudioPlaying = false; }
    else if(e.target.closest('.trans-p') && !e.target.classList.contains('para-tts-btn') && !e.target.closest('.image-stub')) { doTrans(e.target.closest('.trans-p')); }
    else if(e.target.classList.contains('close-tip') || (!e.target.closest('#tooltip') && ui.tooltip.style.display === 'block') && e.target.id !== 'translateSelBtn') { ui.tooltip.style.display = 'none'; document.querySelectorAll('.word.active').forEach(x => x.classList.remove('active')); }
}

function stopAllWork() { state.isWorking = false; state.isAudioPlaying = false; ui.btnStart.disabled = false; ui.btnRead.disabled = false; ui.btnStop.disabled = true; stopAudio(); showGlobalStop(false); document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing')); document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading')); }
async function startTranslation() { if(state.isWorking) return; state.isWorking = true; ui.btnStart.disabled = true; ui.btnStop.disabled = false; const els = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')); const idx = getStartIndex(); for(let i=idx; i<els.length; i++) { if(!state.isWorking) break; if(!els[i].classList.contains('translated')) { await doTrans(els[i]); els[i].scrollIntoView({behavior:"smooth", block:"center"}); await sleep(400); } } stopAllWork(); }
async function startReading() { if(state.isWorking) return; state.isWorking = true; ui.btnStart.disabled = true; ui.btnStop.disabled = false; const els = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')); const idx = getStartIndex(); const lang = ui.tgtLang.value; for(let i=idx; i<els.length; i++) { if(!state.isWorking) break; const el = els[i]; if(!el.classList.contains('translated')) { await doTrans(el); await sleep(300); } document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading')); el.classList.add('reading'); el.scrollIntoView({behavior:"smooth", block:"center"}); const btn = el.querySelector('.para-tts-btn'); if(btn) btn.classList.add('playing'); await playFullAudio(el.innerText.replace('🔊','').trim(), lang); if(btn) btn.classList.remove('playing'); await sleep(200); } stopAllWork(); }
async function doTrans(el) { if(el.classList.contains('translated')) return true; el.classList.add('loading', 'current'); const text = el.dataset.text; const src = ui.srcLang.value; const tgt = ui.tgtLang.value; try { let t = await getCachedTranslation(text, src, tgt); if (!t) { t = await translateApi(text, src, tgt); if (t) await saveCachedTranslation(text, src, tgt, t); } el.innerHTML = `<button class="para-tts-btn">🔊</button>${t}`; el.classList.add('translated'); return true; } catch (e) { el.classList.add('error'); return false; } finally { el.classList.remove('loading', 'current'); } }
async function playFullAudio(text, lang) { showGlobalStop(true); const provider = ui.voiceSrc.value; const rateEl = document.getElementById('rateRange'); const rate = rateEl ? parseFloat(rateEl.value) : 1.0; if (provider === 'google') { const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]; for (let chunk of chunks) { if(!state.isWorking && !state.isAudioPlaying) break; chunk = chunk.trim(); if(!chunk) continue; if (chunk.length > 180) { const sub = chunk.match(/.{1,180}(?:\s|$)/g); if(sub) { for(let s of sub) await playGoogleSingle(s, lang, rate); continue; } } await playGoogleSingle(chunk, lang, rate); } } else { let gender = 'f'; if (lang.startsWith('ru')) gender = ui.voiceRu.value; else if (lang.startsWith('en')) gender = ui.voiceEn.value; else if (lang.startsWith('de')) gender = ui.voiceDe.value; await speakDevice(text, lang, gender, provider, rate); } if(!state.isWorking) showGlobalStop(false); }
async function showTooltip(el, text) { document.querySelectorAll('.word.active').forEach(x => x.classList.remove('active')); el.classList.add('active'); const rect = el.getBoundingClientRect(); ui.tooltip.style.top = (rect.bottom + 5) + 'px'; let l = rect.left; if (l + 250 > window.innerWidth) l = window.innerWidth - 260; ui.tooltip.style.left = l + 'px'; ui.tooltip.style.transform = 'none'; ui.tooltip.style.display = 'block'; ui.tooltip.innerHTML = `<span class="t-word">${text}</span><span>⏳</span>`; try { const lang = ui.srcLang.value; const [trans, phon] = await Promise.all([ translateApi(text, lang, ui.tgtLang.value), fetchPhonetics(text, lang) ]); const targetLang = lang === 'auto' ? 'en' : lang; ui.tooltip.innerHTML = `<div class="tt-header"><span class="t-word">${text}</span><button class="t-tts-btn">🔊</button></div>${phon.ipa ? `<span class="t-ipa">[${phon.ipa}]</span>` : ''} ${phon.cyr ? `<span class="t-rus">"${phon.cyr}"</span>` : ''}<span class="t-trans">${trans}</span><button class="close-tip">X</button>`; ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => { e.stopPropagation(); e.target.classList.add('playing'); await playFullAudio(text, targetLang); e.target.classList.remove('playing'); }; } catch(e) { ui.tooltip.innerHTML = "Error"; } }
let selText = "", selTimeout; function setupSelectionBar() { document.addEventListener('selectionchange', () => { clearTimeout(selTimeout); selTimeout = setTimeout(() => { const sel = window.getSelection(); const txt = sel.toString().trim(); if(txt && txt.length > 1 && ui.orig.contains(sel.anchorNode)) { selText = txt; ui.selBar.classList.add('visible'); } else { ui.selBar.classList.remove('visible'); } }, 300); }); if(ui.selBtn) { ui.selBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if(selText) { showPopupPhrase(selText); ui.selBar.classList.remove('visible'); }}; } }
async function showPopupPhrase(text) { ui.tooltip.style.display='block'; ui.tooltip.style.top='50%'; ui.tooltip.style.left='50%'; ui.tooltip.style.transform='translate(-50%,-50%)'; ui.tooltip.style.maxWidth='80%'; ui.tooltip.innerHTML=`<span class="t-word">${text.substring(0,50)}...</span><span>⏳</span>`; try { const trans = await translateApi(text, ui.srcLang.value, ui.tgtLang.value); const safeText = text.replace(/'/g, "\\'").replace(/\n/g, ' '); const lang = ui.srcLang.value === 'auto' ? 'en' : ui.srcLang.value; ui.tooltip.innerHTML = `<div class="tt-header"><span class="t-word">${text.substring(0,30)}...</span><button class="t-tts-btn">🔊</button></div><span class="t-trans">${trans}</span><button class="close-tip">X</button>`; ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => { e.stopPropagation(); e.target.classList.add('playing'); await playFullAudio(safeText, lang); e.target.classList.remove('playing'); }; } catch(e) { ui.tooltip.innerHTML="Error"; } }
function setupResizer() { let isResizing = false; const startResize = (e) => { isResizing = true; if(e.type === 'touchstart') e.preventDefault(); ui.resizer.classList.add('active'); }; const stopResize = () => { isResizing = false; ui.resizer.classList.remove('active'); }; const doResize = (e) => { if(!isResizing) return; let cy = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY; let cx = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX; const r = ui.container.getBoundingClientRect(); if(state.isVertical) { let pct = ((cy - r.top) / r.height) * 100; if(pct > 10 && pct < 90) { ui.panel1.style.flex = `0 0 ${pct}%`; ui.panel2.style.flex = '1'; } } else { let pct = ((cx - r.left) / r.width) * 100; if(pct > 10 && pct < 90) { ui.panel1.style.flex = `0 0 ${pct}%`; ui.panel2.style.flex = '1'; } } }; ui.resizer.addEventListener('mousedown', startResize); document.addEventListener('mouseup', stopResize); document.addEventListener('mousemove', doResize); ui.resizer.addEventListener('touchstart', startResize); document.addEventListener('touchend', stopResize); document.addEventListener('touchmove', doResize); }
function toggleLayout() { state.isVertical = !state.isVertical; updateLayoutUI(); }
function updateLayoutUI() { if (state.isVertical) { ui.container.style.flexDirection = 'column'; ui.resizer.style.width = '100%'; ui.resizer.style.height = '12px'; ui.resizer.style.cursor = 'row-resize'; ui.layoutBtn.innerText = '⬍'; } else { ui.container.style.flexDirection = 'row'; ui.resizer.style.width = '12px'; ui.resizer.style.height = '100%'; ui.resizer.style.cursor = 'col-resize'; ui.layoutBtn.innerText = '⬄'; } ui.panel1.style.flex = '1'; ui.panel2.style.flex = '1'; }
function getStartIndex() { const blocks = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')); const top = ui.trans.scrollTop; let idx = blocks.findIndex(b => b.offsetTop + b.clientHeight > top); return idx === -1 ? 0 : idx; }
function setupSync() { ui.orig.onscroll = () => { if(state.t_sync) return; state.t_sync = requestAnimationFrame(() => { syncScroll(ui.orig, ui.trans); state.t_sync = null; saveProgress(); }); }; ui.trans.onscroll = () => { if(state.t_sync) return; state.t_sync = requestAnimationFrame(() => { syncScroll(ui.trans, ui.orig); state.t_sync = null; }); }; }
const syncScroll = (a, b) => { if(a.scrollHeight - a.clientHeight > 0) b.scrollTop = (a.scrollTop / (a.scrollHeight - a.clientHeight)) * (b.scrollHeight - b.clientHeight); };
const setStatus = (msg) => ui.status.innerText = msg;
const showLoad = () => ui.loader.style.display = 'flex';
const hideLoad = () => ui.loader.style.display = 'none';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const showGlobalStop = (show) => { if (ui.globalStop) ui.globalStop.style.display = show ? 'flex' : 'none'; state.isAudioPlaying = show; };