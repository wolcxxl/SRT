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
    isSyncing: false 
};

let ui = {};

document.addEventListener('DOMContentLoaded', async () => {
    initUI();
    try {
        await initDB();
        await refreshLibrary();
    } catch (e) { console.error("DB Init Error:", e); }

    setupEventListeners();
    setupResizer();
    setupSelectionBar();
    setupNavigationZones();
    setupSwipeGestures();
    
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

        // ВОТ ЗДЕСЬ ИМЯ ПЕРЕМЕННОЙ voiceSrc
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
    if (ui.rateRange && ui.rateVal) {
        ui.rateRange.addEventListener('input', (e) => { ui.rateVal.innerText = e.target.value; });
        ui.rateVal.innerText = ui.rateRange.value;
    }

    if(ui.fileInput) {
        ui.fileInput.addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if(!f) return;
            showLoad();
            try {
                await saveBookToDB(f, { title: f.name });
                await refreshLibrary();
            } catch (err) { alert(err.message); } 
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

    document.getElementById('menu-toggle').onclick = () => document.getElementById('settings-panel').classList.toggle('open');
    
    // Переключение Google/Edge
    ui.voiceSrc.onchange = () => {
        const mode = ui.voiceSrc.value;
        const vs = document.getElementById('voiceSettings');
        if(vs) vs.style.display = (mode === 'edge') ? 'flex' : 'none';
    };

    ui.chapSel.onchange = (e) => loadChapter(parseInt(e.target.value));
    document.getElementById('prevBtn').onclick = () => loadChapter(state.currentIdx - 1);
    document.getElementById('nextBtn').onclick = () => loadChapter(state.currentIdx + 1);

    ui.btnStart.onclick = startTranslation;
    ui.btnRead.onclick = startReading;
    ui.btnStop.onclick = stopAllWork;
    if(ui.globalStop) ui.globalStop.onclick = stopAllWork;

    ui.layoutBtn.onclick = toggleLayout;

    ui.fontFamily.onchange = () => {
        document.body.classList.forEach(cls => { if (cls.startsWith('font-')) document.body.classList.remove(cls); });
        if(ui.fontFamily.value !== 'ui') document.body.classList.add(`font-${ui.fontFamily.value}`);
    };
    document.getElementById('fontSize').onchange = (e) => document.documentElement.style.setProperty('--font-size', e.target.value);
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
    if (!ui.zoneToggle || !ui.zoneLeft || !ui.zoneRight) return;
    const action = state.isZonesEnabled ? 'add' : 'remove';
    ui.zoneToggle.classList[action]('active-state');
    ui.zoneLeft.classList[action]('active');
    ui.zoneRight.classList[action]('active');
}

async function refreshLibrary() {
    const books = await getAllBooks();
    ui.bookGrid.innerHTML = '';
    if(books.length === 0) {
        ui.bookGrid.innerHTML = '<div style="color:#666;width:100%;text-align:center;padding-top:20px">Библиотека пуста</div>';
        return;
    }
    books.sort((a, b) => (b.lastRead || b.date) - (a.lastRead || a.date));
    const frag = document.createDocumentFragment();
    books.forEach(book => {
        const card = document.createElement('div'); card.className = 'book-card';
        card.innerHTML = `<button class="delete-btn">×</button><div class="book-cover">📖</div><div class="book-info"><div class="book-title">${book.name}</div><div class="book-fmt">${book.type.toUpperCase()}</div></div>`;
        card.querySelector('.delete-btn').onclick = async (e) => { e.stopPropagation(); if(confirm(`Удалить "${book.name}"?`)) { await deleteBook(book.id); refreshLibrary(); }};
        card.onclick = () => openBook(book); 
        frag.appendChild(card);
    });
    ui.bookGrid.appendChild(frag);
}

function resetState() {
    clearTimeout(state.saveTimeout);
    if (state.translationObserver) { state.translationObserver.disconnect(); state.translationObserver = null; }
    state.book = null; state.fb2Chapters = []; state.epubChapters = []; state.coverUrl = null; state.currentIdx = 0; state.currentBookId = null;
    ui.orig.innerHTML = ''; ui.trans.innerHTML = ''; ui.chapSel.innerHTML = '';
    if(ui.topNav) ui.topNav.style.display = 'none';
}

async function openBook(bookData) {
    resetState();
    ui.libView.classList.remove('active');
    ui.readerView.classList.add('active');
    state.currentBookId = bookData.id;
    const file = bookData.file;
    const progress = bookData.progress || { chapter: 0, scroll: 0 };
    setStatus(`Загрузка...`); showLoad();
    try {
        const n = file.name.toLowerCase();
        let textOrBuffer;
        if (n.endsWith('.fb2')) { ui.topNav.style.display = 'flex'; textOrBuffer = await file.text(); processFb2Data(textOrBuffer, progress); }
        else if (n.endsWith('.epub')) { ui.topNav.style.display = 'flex'; textOrBuffer = await file.arrayBuffer(); await processEpubData(textOrBuffer, progress); }
        else if (n.endsWith('.zip')) { const res = await loadZip(file); if(res.type === 'epub') { ui.topNav.style.display='flex'; await processEpubData(res.data, progress); } else if(res.type==='fb2') { ui.topNav.style.display='flex'; processFb2Data(res.data, progress); } else { ui.topNav.style.display='none'; renderText(res.data); } }
        else { ui.topNav.style.display = 'none'; if (n.endsWith('.pdf')) textOrBuffer = await parsePdf(await file.arrayBuffer()); else textOrBuffer = await file.text(); renderText(textOrBuffer); }
        setStatus(file.name);
    } catch(err) { console.error(err); alert("Error: " + err.message); setStatus("Ошибка"); } finally { hideLoad(); }
}

function processFb2Data(text, progress) {
    state.fb2Chapters = parseFb2(text);
    fillChapterSelect(state.fb2Chapters);
    loadChapter(progress.chapter || 0, progress.scroll || 0);
}
async function processEpubData(buffer, progress) {
    const data = await parseEpub(buffer);
    state.book = data.book; state.epubChapters = data.chapters;
    if(data.coverUrl) state.coverUrl = data.coverUrl;
    fillChapterSelect(state.epubChapters);
    loadChapter(progress.chapter || 0, progress.scroll || 0);
}
function fillChapterSelect(chapters) {
    ui.chapSel.innerHTML = ''; const frag = document.createDocumentFragment();
    chapters.forEach((c, i) => { const opt = document.createElement('option'); opt.value = i; opt.text = c.title || `Глава ${i + 1}`; frag.appendChild(opt); });
    ui.chapSel.appendChild(frag);
}
async function loadChapter(idx, scrollTop = 0) {
    stopAllWork();
    let max = (state.epubChapters.length || state.fb2Chapters.length) - 1;
    if (idx < 0) idx = 0; if (idx > max && max > 0) idx = max;
    state.currentIdx = idx; ui.chapSel.value = idx;
    if (state.currentBookId) saveProgress(idx, 0);
    showLoad();
    try {
        let text = "";
        if(state.fb2Chapters.length > 0) text = getFb2ChapterText(state.fb2Chapters[idx].content, state.fb2Chapters[idx].images);
        else if(state.epubChapters.length > 0) { text = await getEpubChapterContent(state.book, state.epubChapters[idx]); if (idx === 0 && state.coverUrl) text = `[IMG:${state.coverUrl}]\n\n` + text; }
        renderText(text);
        ui.orig.classList.remove('page-anim'); void ui.orig.offsetWidth; ui.orig.classList.add('page-anim');
        ui.orig.scrollTop = 0; ui.trans.scrollTop = 0;
        if (scrollTop > 0) setTimeout(() => { ui.orig.scrollTop = scrollTop; }, 50);
        setupTranslationObserver();
    } catch(e) { renderText("Error: " + e.message); } finally { hideLoad(); }
}

function renderText(txt) {
    ui.orig.innerHTML = ''; ui.trans.innerHTML = ''; ui.orig.scrollTop = 0;
    const arr = txt.split(/\n\s*\n/).filter(x => x.trim().length > 0);
    const f1 = document.createDocumentFragment(); const f2 = document.createDocumentFragment();
    arr.forEach(s => {
        const imgMatch = s.match(/^\[IMG:(.+?)\]$/);
        if (imgMatch) {
            const createImgBtn = () => { const div = document.createElement('div'); div.className = 'image-stub'; div.dataset.src = imgMatch[1]; div.innerHTML = `<img class="preview" src="${imgMatch[1]}" loading="lazy"><span>📷</span>`; return div; };
            f1.appendChild(createImgBtn()); f2.appendChild(createImgBtn());
        } else {
            const d1 = document.createElement('div'); d1.className = 'orig-p'; d1.textContent = s; f1.appendChild(d1);
            const d2 = document.createElement('div'); d2.className = 'trans-p'; d2.dataset.text = s; d2.innerHTML = `<button class="para-tts-btn">🔊</button><span class="trans-content">${s}</span>`; f2.appendChild(d2);
        }
    });
    ui.orig.appendChild(f1); ui.trans.appendChild(f2);
}

function setupTranslationObserver() {
    if (state.translationObserver) state.translationObserver.disconnect();
    const src = ui.srcLang.value; const tgt = ui.tgtLang.value;
    state.translationObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(async (entry) => {
            if (entry.isIntersecting) {
                const el = entry.target; observer.unobserve(el);
                const text = el.dataset.text; if (!text) return;
                try {
                    const t = await getCachedTranslation(text, src, tgt);
                    if (t && el.isConnected && !el.classList.contains('translated')) requestAnimationFrame(() => applyTranslation(el, t));
                } catch (e) {}
            }
        });
    }, { root: ui.trans, rootMargin: '300px' });
    ui.trans.querySelectorAll('.trans-p:not(.translated):not(.image-stub)').forEach(el => state.translationObserver.observe(el));
}

function applyTranslation(el, text) {
    const btn = el.querySelector('.para-tts-btn');
    if(btn) { while(el.childNodes.length > 1) { el.removeChild(el.lastChild); } el.insertAdjacentText('beforeend', text); } 
    else el.innerHTML = `<button class="para-tts-btn">🔊</button>${text}`;
    el.classList.add('translated');
}

// --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ЗВУКА ---
async function playFullAudio(text, lang) { 
    stopAudio(); 
    showGlobalStop(true); 
    state.isAudioPlaying = true;
    
    // ИСПРАВЛЕНО: ui.voiceSrc вместо ui.voiceSource
    const provider = ui.voiceSrc ? ui.voiceSrc.value : 'google'; 
    const rateEl = document.getElementById('rateRange'); 
    const rate = rateEl ? parseFloat(rateEl.value) : 1.0; 
    
    const cleanText = text.replace(/🔊/g, '').trim();
    if (!cleanText) { showGlobalStop(false); state.isAudioPlaying = false; return; }

    if (provider === 'google') { 
        const chunks = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText]; 
        for (let chunk of chunks) { 
            if(!state.isWorking && !state.isAudioPlaying) break; 
            chunk = chunk.trim(); if(!chunk) continue; 
            
            try {
                // Если Google работает - читаем через него
                await playGoogleSingle(chunk, lang, rate); 
                await sleep(50); // Пауза для стабильности
            } catch (e) {
                // Если Google заблокировал/ошибка - читаем этот кусок устройством (Fallback)
                console.log("Google error, using device fallback for chunk");
                await speakDevice(chunk, lang, 'f', 'native', rate);
            }
        } 
    } else { 
        // Чтение устройством
        let gender = 'f'; 
        if (lang.startsWith('ru') && ui.voiceRu) gender = ui.voiceRu.value; 
        else if (lang.startsWith('en') && ui.voiceEn) gender = ui.voiceEn.value; 
        else if (lang.startsWith('de') && ui.voiceDe) gender = ui.voiceDe.value; 
        await speakDevice(cleanText, lang, gender, provider, rate); 
    } 
    state.isAudioPlaying = false;
    if(!state.isWorking) showGlobalStop(false); 
}

function setupSync() {
    const sync = (source, target) => {
        if (state.isSyncing) return; state.isSyncing = true;
        const sourceParas = Array.from(source.children); const targetParas = Array.from(target.children);
        if (sourceParas.length === 0) { state.isSyncing = false; return; }
        const sourceCenter = source.scrollTop + (source.clientHeight / 3);
        let activeIdx = sourceParas.findIndex(p => p.offsetTop <= sourceCenter && (p.offsetTop + p.clientHeight) >= sourceCenter);
        if (activeIdx !== -1 && targetParas[activeIdx]) {
            const tEl = targetParas[activeIdx]; const sEl = sourceParas[activeIdx];
            let ratio = sEl.clientHeight > 0 ? (sourceCenter - sEl.offsetTop) / sEl.clientHeight : 0;
            target.scrollTop = tEl.offsetTop + (tEl.clientHeight * Math.max(0, Math.min(1, ratio))) - (target.clientHeight / 3);
        }
        setTimeout(() => state.isSyncing = false, 100);
        if (source === ui.orig) saveProgress();
    };
    ui.orig.onscroll = () => requestAnimationFrame(() => sync(ui.orig, ui.trans));
    ui.trans.onscroll = () => requestAnimationFrame(() => sync(ui.trans, ui.orig));
}

function setupResizer() { 
    let isResizing = false; let rAF = null;
    const start = (e) => { isResizing = true; if(e.type === 'touchstart') e.preventDefault(); ui.resizer.classList.add('active'); }; 
    const stop = () => { isResizing = false; ui.resizer.classList.remove('active'); if(rAF) cancelAnimationFrame(rAF); }; 
    const move = (e) => { 
        if(!isResizing || rAF) return;
        rAF = requestAnimationFrame(() => {
            let cy = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY; 
            let cx = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX; 
            const r = ui.container.getBoundingClientRect(); 
            let pct = state.isVertical ? ((cy - r.top) / r.height) * 100 : ((cx - r.left) / r.width) * 100; 
            if(pct > 10 && pct < 90) ui.panel1.style.flex = `0 0 ${pct}%`; 
            rAF = null;
        });
    }; 
    ui.resizer.addEventListener('mousedown', start); document.addEventListener('mouseup', stop); document.addEventListener('mousemove', move); 
    ui.resizer.addEventListener('touchstart', start); document.addEventListener('touchend', stop); document.addEventListener('touchmove', move); 
}

async function handleGlobalClicks(e) {
    const t = e.target;
    if (t.closest('.image-stub')) { const s = t.closest('.image-stub'); if(s.dataset.src) openImageModal(s.dataset.src); return; }
    if(t.classList.contains('para-tts-btn')) { 
        e.stopPropagation(); const p = t.closest('.trans-p'); 
        if(!p.classList.contains('translated')) await doTrans(p); 
        stopAudio(); state.isAudioPlaying = true; t.classList.add('playing'); 
        await playFullAudio(p.innerText, ui.tgtLang.value); 
        t.classList.remove('playing'); showGlobalStop(false); state.isAudioPlaying = false; return;
    }
    if(t.closest('.trans-p') && !t.closest('.image-stub')) { doTrans(t.closest('.trans-p')); return; }
    if(t.closest('.orig-p')) { handleWordClick(e); return; }
    if(t.classList.contains('close-tip') || (!t.closest('#tooltip') && ui.tooltip.style.display === 'block')) ui.tooltip.style.display = 'none';
}

function handleWordClick(e) {
    const sel = window.getSelection(); if (sel.toString().length > 1) return;
    if (sel.isCollapsed) { sel.modify("move", "forward", "character"); sel.modify("move", "backward", "word"); sel.modify("extend", "forward", "word"); }
    const word = sel.toString().trim(); if (word && /^[a-zA-Zа-яА-Я0-9\u00C0-\u00FF'-]+$/.test(word)) showTooltip(e.target, word);
}

async function startTranslation() { if(state.isWorking) return; state.isWorking = true; ui.btnStart.disabled = true; ui.btnStop.disabled = false; const els = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')); const idx = getStartIndex(); for(let i=idx; i<els.length; i++) { if(!state.isWorking) break; if(!els[i].classList.contains('translated')) { await doTrans(els[i]); els[i].scrollIntoView({behavior:"smooth", block:"center"}); await sleep(400); } } stopAllWork(); }
async function startReading() { 
    if(state.isWorking) return; state.isWorking = true; ui.btnStart.disabled = true; ui.btnStop.disabled = false; 
    const els = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')); const idx = getStartIndex(); const lang = ui.tgtLang.value; 
    for(let i=idx; i<els.length; i++) { 
        if(!state.isWorking) break; const el = els[i]; 
        if(!el.classList.contains('translated')) { await doTrans(el); await sleep(300); } 
        document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading')); el.classList.add('reading'); el.scrollIntoView({behavior:"smooth", block:"center"}); 
        const btn = el.querySelector('.para-tts-btn'); if(btn) btn.classList.add('playing'); 
        await playFullAudio(el.innerText, lang); 
        if(btn) btn.classList.remove('playing'); await sleep(200); 
    } stopAllWork(); 
}
async function doTrans(el) { if(el.classList.contains('translated')) return true; el.classList.add('loading'); const text = el.dataset.text; try { let t = await getCachedTranslation(text, ui.srcLang.value, ui.tgtLang.value); if (!t) { t = await translateApi(text, ui.srcLang.value, ui.tgtLang.value); if (t) await saveCachedTranslation(text, ui.srcLang.value, ui.tgtLang.value, t); } applyTranslation(el, t); return true; } catch (e) { el.classList.add('error'); return false; } finally { el.classList.remove('loading'); } }

async function showTooltip(targetEl, text) {
    const rect = targetEl.getBoundingClientRect(); const sel = window.getSelection();
    let left = rect.left, top = rect.bottom;
    if (sel.rangeCount > 0) { const r = sel.getRangeAt(0).getBoundingClientRect(); left = r.left; top = r.bottom; }
    if (left + 250 > window.innerWidth) left = window.innerWidth - 260; if (left < 10) left = 10;
    ui.tooltip.style.top = (top + 5) + 'px'; ui.tooltip.style.left = left + 'px'; ui.tooltip.style.display = 'block';
    ui.tooltip.innerHTML = `<span class="t-word">${text}</span><span>⏳</span>`;
    try {
        let trans, phon;
        try { [trans, phon] = await Promise.all([ translateApi(text, ui.srcLang.value, ui.tgtLang.value), fetchPhonetics(text, ui.srcLang.value) ]); } catch(err) { trans="?"; phon={}; }
        ui.tooltip.innerHTML = `<div class="tt-header"><span class="t-word">${text}</span><button class="t-tts-btn">🔊</button></div>${phon.ipa ? `<span class="t-ipa">[${phon.ipa}]</span>` : ''} <span class="t-trans">${trans}</span><button class="close-tip">X</button>`;
        ui.tooltip.querySelector('.t-tts-btn').onclick = async (e) => { e.stopPropagation(); e.target.classList.add('playing'); await playFullAudio(text, ui.srcLang.value === 'auto' ? 'en' : ui.srcLang.value); e.target.classList.remove('playing'); };
    } catch(e) { ui.tooltip.innerHTML = "Error"; }
}

function setupSelectionBar() { let t; document.addEventListener('selectionchange', () => { clearTimeout(t); t = setTimeout(() => { const s = window.getSelection(); const txt = s.toString().trim(); if(txt.length > 1 && ui.orig.contains(s.anchorNode)) { ui.selBtn.dataset.text = txt; ui.selBar.classList.add('visible'); } else ui.selBar.classList.remove('visible'); }, 300); }); if(ui.selBtn) ui.selBtn.onclick = (e) => { e.preventDefault(); showPopupPhrase(ui.selBtn.dataset.text); ui.selBar.classList.remove('visible'); }; }
async function showPopupPhrase(text) { showTooltip(ui.orig, text); } // Упростили для примера
function openImageModal(src) { if(ui.modalImg) { ui.modalImg.src = src; ui.imageModal.classList.add('visible'); } }
function closeImageModal() { ui.imageModal.classList.remove('visible'); }
function toggleLayout() { state.isVertical = !state.isVertical; if(state.isVertical) { ui.container.style.flexDirection='column'; ui.resizer.style.cssText='width:100%;height:12px;cursor:row-resize'; } else { ui.container.style.flexDirection='row'; ui.resizer.style.cssText='width:12px;height:100%;cursor:col-resize'; } }
function updateLayoutUI() { toggleLayout(); toggleLayout(); } // Хак для сброса
function getStartIndex() { let idx = Array.from(document.querySelectorAll('.trans-p:not(.image-stub)')).findIndex(b => b.offsetTop + b.clientHeight > ui.trans.scrollTop); return idx === -1 ? 0 : idx; }
function saveProgress(ch, sc) { clearTimeout(state.saveTimeout); state.saveTimeout = setTimeout(() => saveProgressNow(ch, sc), 1000); }
function saveProgressNow(ch, sc) { if (state.currentBookId) updateBookProgress(state.currentBookId, ch !== undefined ? ch : state.currentIdx, sc !== undefined ? sc : ui.orig.scrollTop); }
function stopAllWork() { state.isWorking = false; state.isAudioPlaying = false; ui.btnStart.disabled = false; ui.btnRead.disabled = false; ui.btnStop.disabled = true; stopAudio(); showGlobalStop(false); document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing')); document.querySelectorAll('.trans-p.reading').forEach(e => e.classList.remove('reading')); }
const setStatus = (msg) => ui.status.innerText = msg;
const showLoad = () => ui.loader.style.display = 'flex';
const hideLoad = () => ui.loader.style.display = 'none';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const showGlobalStop = (show) => { if (ui.globalStop) ui.globalStop.style.display = show ? 'flex' : 'none'; };