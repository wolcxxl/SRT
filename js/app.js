import { initDB, saveBookToDB, getAllBooks, deleteBook } from './db.js';
import { translateApi, fetchPhonetics } from './api.js';
import { loadZip, parseFb2, getFb2ChapterText, parsePdf } from './parser.js';
import { speakDevice, playGoogleSingle, stopAudio } from './tts.js';

// --- Глобальное состояние (State) ---
const state = {
    book: null,
    fb2Chapters: [],
    spine: null, // для epub
    currentIdx: 0,
    isWorking: false,
    isAudioPlaying: false,
    isVertical: true, // Режим отображения
    t_sync: null // Для синхронизации скролла
};

// --- Ссылки на UI элементы ---
// ВАЖНО: Мы получаем элементы только когда DOM загружен, поэтому объект пустой, 
// а заполним мы его в функции initUI()
let ui = {};

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Сначала находим все элементы (чтобы избежать null ошибок)
    initUI();
    
    // 2. Инициализируем базу данных
    await initDB();
    refreshLibrary();
    
    // 3. Вешаем обработчики событий
    setupEventListeners();
    setupResizer();
    setupSelectionBar();
    
    // 4. Глобальный клик (делегирование)
    document.body.addEventListener('click', handleGlobalClicks);

    // 5. Исправление для Chrome/Edge (голоса могут не подгрузиться сразу)
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
            console.log("Голоса обновлены"); 
            // Можно добавить логику обновления списков, если нужно
        };
    }
});

function initUI() {
    ui = {
        libView: document.getElementById('library-view'),
        readerView: document.getElementById('reader-view'),
        bookGrid: document.getElementById('bookGrid'),
        fileInput: document.getElementById('libFileInput'),
        status: document.getElementById('statusLine'),
        loader: document.getElementById('loader'),
        
        // Панели
        container: document.getElementById('container'),
        panel1: document.getElementById('panel1'),
        panel2: document.getElementById('panel2'),
        orig: document.getElementById('origPanel'),
        trans: document.getElementById('transPanel'),
        resizer: document.getElementById('resizer'),
        
        // Навигация и меню
        chapSel: document.getElementById('chapterSelect'),
        tooltip: document.getElementById('tooltip'),
        selBar: document.getElementById('selection-bar'),
        selBtn: document.getElementById('translateSelBtn'),
        
        // Настройки
        voiceSrc: document.getElementById('voiceSource'),
        voiceRu: document.getElementById('voiceRu'),
        voiceEn: document.getElementById('voiceEn'),
        voiceDe: document.getElementById('voiceDe'),
        
        // --- ИСПРАВЛЕНИЕ СКОРОСТИ ---
        rateRange: document.getElementById('rateRange'),
        rateVal: document.getElementById('rateVal'),
        // -----------------------------
        
        srcLang: document.getElementById('srcLang'),
        tgtLang: document.getElementById('tgtLang'),
        fontFamily: document.getElementById('fontFamily'),
        
        // Кнопки управления
        btnStart: document.getElementById('btnStart'),
        btnRead: document.getElementById('btnRead'),
        btnStop: document.getElementById('btnStop'),
        globalStop: document.getElementById('global-stop-btn'),
        layoutBtn: document.getElementById('layoutBtn')
    };
}

// --- Настройка событий ---
function setupEventListeners() {
    // Загрузка файла
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

    // Навигация
    document.getElementById('backToLib').onclick = () => {
        ui.readerView.classList.remove('active');
        ui.libView.classList.add('active');
        document.getElementById('settings-panel').classList.remove('open');
        stopAllWork();
    };

    document.getElementById('menu-toggle').onclick = () => {
        document.getElementById('settings-panel').classList.toggle('open');
    };
    
    // Настройки голоса (показать/скрыть расширенные настройки)
    ui.voiceSrc.onchange = () => {
        const mode = ui.voiceSrc.value;
        document.getElementById('voiceSettings').style.display = (mode === 'edge') ? 'flex' : 'none';
    };

    // --- ВАЖНОЕ ИСПРАВЛЕНИЕ СКОРОСТИ ---
    if (ui.rateRange && ui.rateVal) {
        ui.rateRange.oninput = () => {
            ui.rateVal.innerText = ui.rateRange.value;
        };
    } else {
        console.error("Элементы управления скоростью не найдены в HTML!");
    }
    // ------------------------------------

    // Кнопки плеера
    ui.btnStart.onclick = startTranslation;
    ui.btnRead.onclick = startReading;
    ui.btnStop.onclick = stopAllWork;
    if(ui.globalStop) ui.globalStop.onclick = stopAllWork;
    
    // Главы
    ui.chapSel.onchange = (e) => loadChapter(parseInt(e.target.value));
    document.getElementById('prevBtn').onclick = () => loadChapter(state.currentIdx - 1);
    document.getElementById('nextBtn').onclick = () => loadChapter(state.currentIdx + 1);

    // Вид и шрифты
    ui.layoutBtn.onclick = toggleLayout;
    
    document.getElementById('fontSize').onchange = (e) => 
        document.documentElement.style.setProperty('--font-size', e.target.value);
        
    document.getElementById('boldToggle').onclick = (e) => {
        document.body.classList.toggle('font-bold');
        e.target.classList.toggle('active-state');
    };
    
    ui.fontFamily.onchange = () => {
        document.body.className = document.body.className.replace(/font-\w+/g, '');
        if(ui.fontFamily.value !== 'ui') document.body.classList.add(`font-${ui.fontFamily.value}`);
    };

    setupSync();
    updateLayoutUI(); 
}

// --- Библиотека ---
async function refreshLibrary() {
    const books = await getAllBooks();
    ui.bookGrid.innerHTML = '';
    if(books.length === 0) {
        ui.bookGrid.innerHTML = '<div style="color:#666;width:100%;text-align:center;padding-top:20px">Библиотека пуста. Нажмите "+ Книга"</div>';
        return;
    }
    books.forEach(book => {
        const card = document.createElement('div'); 
        card.className = 'book-card';
        card.innerHTML = `
            <button class="delete-btn" data-id="${book.id}">×</button>
            <div class="book-cover">📖</div>
            <div class="book-info">
                <div class="book-title">${book.name}</div>
                <div class="book-fmt">${book.type}</div>
            </div>`;
        
        card.querySelector('.delete-btn').onclick = async (e) => {
            e.stopPropagation();
            if(confirm("Удалить книгу?")) { await deleteBook(book.id); refreshLibrary(); }
        };
        card.onclick = () => openBook(book.file);
        ui.bookGrid.appendChild(card);
    });
}

// --- Открытие книги ---
async function openBook(file) {
    ui.libView.classList.remove('active');
    ui.readerView.classList.add('active');
    setStatus(`Загрузка: ${file.name}`);
    showLoad();
    
    try {
        const n = file.name.toLowerCase();
        document.getElementById('controls').style.display = 'flex';
        
        if(n.endsWith('.fb2')) {
             const text = await file.text();
             processFb2Data(text);
        } else if(n.endsWith('.epub')) {
             await processEpub(await file.arrayBuffer());
        } else if(n.endsWith('.pdf')) {
             document.getElementById('controls').style.display = 'none';
             const text = await parsePdf(await file.arrayBuffer());
             renderText(text);
        } else if(n.endsWith('.zip')) {
             const res = await loadZip(file);
             if(res.type === 'epub') await processEpub(res.data);
             else if(res.type === 'fb2') processFb2Data(res.data);
             else renderText(res.data);
        } else {
             renderText(await file.text());
        }
        setStatus(file.name);
    } catch(err) {
        alert(err.message);
        setStatus("Ошибка открытия");
    } finally {
        hideLoad();
    }
}

function processFb2Data(text) {
    state.fb2Chapters = parseFb2(text);
    ui.chapSel.innerHTML = '';
    state.fb2Chapters.forEach((c, i) => ui.chapSel.add(new Option(c.title, i)));
    loadChapter(0);
}

async function processEpub(buffer) {
    state.book = ePub(buffer);
    await state.book.ready;
    state.spine = state.book.spine.spineItems;
    ui.chapSel.innerHTML = '';
    state.spine.forEach((_, i) => ui.chapSel.add(new Option(`${i+1}`, i)));
    loadChapter(0);
}

async function loadChapter(idx) {
    stopAllWork();
    if(idx < 0) idx = 0;
    
    state.currentIdx = idx;
    ui.chapSel.value = idx;
    
    if(state.spine && idx >= state.spine.length) return;
    if(state.fb2Chapters.length > 0 && idx >= state.fb2Chapters.length) return;

    if(state.fb2Chapters.length > 0) {
        renderText(getFb2ChapterText(state.fb2Chapters[idx].content));
    } else if(state.spine) {
        showLoad();
        try {
            const doc = await state.spine[idx].load(state.book.load.bind(state.book));
            let h = doc.body?.innerHTML || new XMLSerializer().serializeToString(doc);
            let t = h.replace(/<(br|div|p|h\d)[^>]*>/gi, '\n')
                     .replace(/<[^>]+>/g, '')
                     .replace(/&nbsp;/g,' ')
                     .replace(/\n\s*\n/g, '\n\n');
            renderText(t);
        } catch(e) { console.error(e); }
        hideLoad();
    }
}

// --- Рендеринг текста ---
function renderText(txt) {
    ui.orig.innerHTML = ''; 
    ui.trans.innerHTML = ''; 
    ui.orig.scrollTop = 0;
    
    const arr = txt.split(/\n\s*\n/).filter(x => x.trim().length > 1);
    const f1 = document.createDocumentFragment();
    const f2 = document.createDocumentFragment();
    
    arr.forEach(s => {
        const d1 = document.createElement('div'); 
        d1.className = 'orig-p'; 
        d1.innerHTML = s.replace(/([a-zA-Zа-яА-Я0-9\u00C0-\u00FF'-]+)/g, '<span class="word" data-word="$1">$1</span>'); 
        f1.appendChild(d1);
        
        const d2 = document.createElement('div'); 
        d2.className = 'trans-p'; 
        d2.dataset.text = s;
        d2.innerHTML = `<button class="para-tts-btn">🔊</button>${s}`;
        f2.appendChild(d2);
    });
    
    ui.orig.appendChild(f1);
    ui.trans.appendChild(f2);
}

// --- Логика перевода и чтения ---

function stopAllWork() {
    state.isWorking = false;
    state.isAudioPlaying = false;
    ui.btnStart.disabled = false;
    ui.btnRead.disabled = false;
    ui.btnStop.disabled = true;
    
    stopAudio();
    showGlobalStop(false);
    
    document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
    document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading'));
}

async function startTranslation() {
    if(state.isWorking) return;
    state.isWorking = true;
    ui.btnStart.disabled = true;
    ui.btnStop.disabled = false;
    
    const els = Array.from(document.querySelectorAll('.trans-p'));
    const idx = getStartIndex();
    
    for(let i=idx; i<els.length; i++) {
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
    ui.btnStart.disabled = true;
    ui.btnStop.disabled = false;
    
    const els = Array.from(document.querySelectorAll('.trans-p'));
    const idx = getStartIndex();
    const lang = ui.tgtLang.value;
    
    for(let i=idx; i<els.length; i++) {
        if(!state.isWorking) break;
        const el = els[i];
        
        if(!el.classList.contains('translated')) { await doTrans(el); await sleep(300); }
        
        document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading'));
        el.classList.add('reading');
        el.scrollIntoView({behavior:"smooth", block:"center"});
        
        const btn = el.querySelector('.para-tts-btn');
        if(btn) btn.classList.add('playing');
        
        const textToRead = el.innerText.replace('🔊','').trim();
        await playFullAudio(textToRead, lang);
        
        if(btn) btn.classList.remove('playing');
        await sleep(200);
    }
    stopAllWork();
}

async function doTrans(el) {
    if(el.classList.contains('translated')) return true;
    el.classList.add('loading', 'current');
    try {
        const t = await translateApi(el.dataset.text, ui.srcLang.value, ui.tgtLang.value);
        el.innerHTML = `<button class="para-tts-btn">🔊</button>${t}`;
        el.classList.add('translated');
        return true;
    } catch {
        el.classList.add('error');
        return false;
    } finally {
        el.classList.remove('loading', 'current');
    }
}

async function playFullAudio(text, lang) {
    showGlobalStop(true);
    const provider = ui.voiceSrc.value;
    const rate = parseFloat(ui.rateRange.value); // Читаем актуальную скорость
    
    if (provider === 'google') {
        const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
        for (let chunk of chunks) {
             if(!state.isWorking && !state.isAudioPlaying) break;
             chunk = chunk.trim(); if(!chunk) continue;
             if (chunk.length > 180) {
                 const sub = chunk.match(/.{1,180}(?:\s|$)/g);
                 if(sub) { for(let s of sub) await playGoogleSingle(s, lang, rate); continue; }
             }
             await playGoogleSingle(chunk, lang, rate);
        }
    } else {
        let gender = 'f';
        if (lang.startsWith('ru')) gender = ui.voiceRu.value;
        else if (lang.startsWith('en')) gender = ui.voiceEn.value;
        else if (lang.startsWith('de')) gender = ui.voiceDe.value;
        await speakDevice(text, lang, gender, provider, rate);
    }
    
    if(!state.isWorking) showGlobalStop(false);
}

// --- Обработка кликов (Event Delegation) ---
async function handleGlobalClicks(e) {
    if(e.target.classList.contains('word')) {
        const word = e.target.dataset.word;
        showTooltip(e.target, word);
    }
    else if(e.target.classList.contains('para-tts-btn')) {
        e.stopPropagation();
        const p = e.target.closest('.trans-p');
        
        if(!p.classList.contains('translated')) await doTrans(p);
        
        stopAudio();
        state.isAudioPlaying = true;
        e.target.classList.add('playing');
        
        const text = p.innerText.replace('🔊', '').trim();
        await playFullAudio(text, ui.tgtLang.value);
        
        e.target.classList.remove('playing');
        showGlobalStop(false);
        state.isAudioPlaying = false;
    }
    else if(e.target.closest('.trans-p') && !e.target.classList.contains('para-tts-btn')) {
        const p = e.target.closest('.trans-p');
        doTrans(p);
    }
    else if(e.target.classList.contains('close-tip') || (!e.target.closest('#tooltip') && ui.tooltip.style.display === 'block') && e.target.id !== 'translateSelBtn') {
        ui.tooltip.style.display = 'none';
        document.querySelectorAll('.word.active').forEach(x => x.classList.remove('active'));
    }
}

async function showTooltip(el, text) {
    document.querySelectorAll('.word.active').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    
    const rect = el.getBoundingClientRect();
    ui.tooltip.style.top = (rect.bottom + 5) + 'px';
    let l = rect.left;
    if (l + 250 > window.innerWidth) l = window.innerWidth - 260;
    ui.tooltip.style.left = l + 'px';
    ui.tooltip.style.transform = 'none';
    ui.tooltip.style.display = 'block';
    
    ui.tooltip.innerHTML = `<span class="t-word">${text}</span><span>⏳</span>`;
    
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
            <button class="close-tip">X</button>`;
            
        ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => {
            e.stopPropagation();
            e.target.classList.add('playing');
            await playFullAudio(text, targetLang);
            e.target.classList.remove('playing');
        };
    } catch(e) { ui.tooltip.innerHTML = "Error"; }
}

// --- Выделение текста ---
let selText = "";
let selTimeout;

function setupSelectionBar() {
    document.addEventListener('selectionchange', () => {
        clearTimeout(selTimeout);
        selTimeout = setTimeout(() => {
            const sel = window.getSelection();
            const txt = sel.toString().trim();
            if(txt && txt.length > 1 && ui.orig.contains(sel.anchorNode)) {
                selText = txt;
                ui.selBar.classList.add('visible');
            } else {
                ui.selBar.classList.remove('visible');
            }
        }, 300);
    });

    if(ui.selBtn) {
        ui.selBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if(selText) {
                showPopupPhrase(selText);
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
    
    ui.tooltip.innerHTML=`<span class="t-word">${text.substring(0,50)}...</span><span>⏳</span>`;
    
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
            <button class="close-tip">X</button>`;
            
         ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => {
            e.stopPropagation();
            e.target.classList.add('playing');
            await playFullAudio(safeText, lang);
            e.target.classList.remove('playing');
        };
    } catch(e) { ui.tooltip.innerHTML="Error"; }
}

// --- Ресайзер ---
function setupResizer() {
    let isResizing = false;
    
    const startResize = (e) => {
        isResizing = true;
        if(e.type === 'touchstart') e.preventDefault();
        ui.resizer.classList.add('active');
    };
    
    const stopResize = () => {
        isResizing = false;
        ui.resizer.classList.remove('active');
    };
    
    const doResize = (e) => {
        if(!isResizing) return;
        let cy = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
        let cx = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const r = ui.container.getBoundingClientRect();
        
        if(state.isVertical) {
            let pct = ((cy - r.top) / r.height) * 100;
            if(pct > 10 && pct < 90) {
                ui.panel1.style.flex = `0 0 ${pct}%`;
                ui.panel2.style.flex = '1';
            }
        } else {
            let pct = ((cx - r.left) / r.width) * 100;
            if(pct > 10 && pct < 90) {
                ui.panel1.style.flex = `0 0 ${pct}%`;
                ui.panel2.style.flex = '1';
            }
        }
    };
    
    ui.resizer.addEventListener('mousedown', startResize);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('mousemove', doResize);
    
    ui.resizer.addEventListener('touchstart', startResize);
    document.addEventListener('touchend', stopResize);
    document.addEventListener('touchmove', doResize);
}

function toggleLayout() {
    state.isVertical = !state.isVertical;
    updateLayoutUI();
}

function updateLayoutUI() {
    if (state.isVertical) {
        ui.container.style.flexDirection = 'column';
        ui.resizer.style.width = '100%'; 
        ui.resizer.style.height = '12px'; 
        ui.resizer.style.cursor = 'row-resize';
        ui.layoutBtn.innerText = '⬍';
    } else {
        ui.container.style.flexDirection = 'row';
        ui.resizer.style.width = '12px'; 
        ui.resizer.style.height = '100%'; 
        ui.resizer.style.cursor = 'col-resize';
        ui.layoutBtn.innerText = '⬄';
    }
    ui.panel1.style.flex = '1';
    ui.panel2.style.flex = '1';
}

// --- Утилиты ---
function getStartIndex() {
    const blocks = Array.from(document.querySelectorAll('.trans-p'));
    const top = ui.trans.scrollTop;
    let idx = blocks.findIndex(b => b.offsetTop + b.clientHeight > top);
    return idx === -1 ? 0 : idx;
}

function setupSync() {
    ui.orig.onscroll = () => { 
        if(state.t_sync) return; 
        state.t_sync = requestAnimationFrame(() => { 
            syncScroll(ui.orig, ui.trans); 
            state.t_sync = null; 
        }); 
    };
    ui.trans.onscroll = () => { 
        if(state.t_sync) return; 
        state.t_sync = requestAnimationFrame(() => { 
            syncScroll(ui.trans, ui.orig); 
            state.t_sync = null; 
        }); 
    };
}

const syncScroll = (a, b) => { 
    if(a.scrollHeight - a.clientHeight > 0) {
        b.scrollTop = (a.scrollTop / (a.scrollHeight - a.clientHeight)) * (b.scrollHeight - b.clientHeight); 
    }
};

const setStatus = (msg) => ui.status.innerText = msg;
const showLoad = () => ui.loader.style.display = 'flex';
const hideLoad = () => ui.loader.style.display = 'none';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const showGlobalStop = (show) => {
    if (ui.globalStop) ui.globalStop.style.display = show ? 'flex' : 'none';
    state.isAudioPlaying = show;
};