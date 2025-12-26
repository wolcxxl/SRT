const voiceProfiles = {
    'ru': { m: ['Dmitry', 'Pavel', 'Ivan', 'Male', 'Rus'], f: ['Svetlana', 'Alina', 'Tatyana', 'Female', 'Milena'] },
    'en': { m: ['Guy', 'Stefan', 'Christopher', 'Male'], f: ['Aria', 'Jenny', 'Michelle', 'Female', 'Google US'] },
    'de': { m: ['Conrad', 'Stefan', 'Male'], f: ['Katja', 'Marlene', 'Female'] }
};

let currentAudio = null;
let audioResolve = null;

export function getBestVoice(lang, genderPref, mode) {
    if (!window.speechSynthesis) return null;
    const allVoices = window.speechSynthesis.getVoices();
    // Упрощенный код языка (ru-RU -> ru)
    const code = lang.split('-')[0].toLowerCase();
    
    let candidates = allVoices.filter(v => v.lang.toLowerCase().startsWith(code));

    if (mode === 'edge') {
        let hq = candidates.filter(v => v.name.includes("Natural") || v.name.includes("Microsoft") || v.name.includes("Online"));
        if (hq.length > 0) candidates = hq;
    } 

    const profiles = voiceProfiles[code];
    const keywords = profiles ? profiles[genderPref] : [];
    
    let match = candidates.find(v => keywords.some(k => v.name.includes(k)));
    if (!match && candidates.length > 0) match = candidates[0];
    
    return match;
}

export function stopAudio() {
    // Останавливаем нативный синтез
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    
    // Останавливаем аудио-файл (Google)
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0; // Сброс на начало
        currentAudio = null;
    }
    
    // Если кто-то ждал окончания — отпускаем его
    if (audioResolve) {
        audioResolve();
        audioResolve = null;
    }
}

export function playGoogleSingle(text, lang, rate) {
    return new Promise((resolve) => {
        // Сброс предыдущего
        stopAudio(); 
        
        // Сохраняем resolve, чтобы вызвать его, если нажмут "Стоп"
        audioResolve = resolve;

        // Формируем URL. Добавил client=tw-ob, он стабильнее
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
        const audio = new Audio(url);
        
        audio.playbackRate = rate;
        currentAudio = audio;

        audio.onended = () => {
            currentAudio = null;
            audioResolve = null;
            resolve();
        };

        // ГЛАВНОЕ ИСПРАВЛЕНИЕ:
        audio.onerror = async () => {
            console.warn("Google TTS Error/Blocked. Falling back to Device TTS.");
            currentAudio = null;
            
            // Если Гугл забанил или ошибка сети — читаем нативным голосом!
            // Это спасет от бесконечного цикла ошибок.
            await speakDevice(text, lang, 'f', 'native', rate);
            
            audioResolve = null;
            resolve();
        };

        audio.play().catch(e => {
            console.error("Audio play error:", e);
            // Если автовоспроизведение запрещено, тоже пробуем нативный
            speakDevice(text, lang, 'f', 'native', rate).then(resolve);
        });
    });
}

export function speakDevice(text, lang, gender, mode, rate) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        
        // Не делаем stopAudio() здесь, иначе он сбросит сам себя при рекурсии
        if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
        
        audioResolve = resolve;

        const u = new SpeechSynthesisUtterance(text);
        
        // Нормализация языка для API
        let targetLang = lang;
        if (lang === 'en') targetLang = 'en-US';
        if (lang === 'de') targetLang = 'de-DE';
        if (lang === 'ru') targetLang = 'ru-RU';

        const voice = getBestVoice(targetLang, gender, mode);
        if (voice) u.voice = voice;
        
        u.lang = targetLang;
        u.rate = rate;

        // Обработчики событий
        u.onend = () => {
            audioResolve = null;
            resolve();
        };
        
        u.onerror = (e) => {
            console.error("Device TTS error", e);
            audioResolve = null;
            resolve();
        };

        window.speechSynthesis.speak(u);

        // Хак для Chrome, который любит останавливать длинную речь через 15 сек
        const t = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
                clearInterval(t);
                // resolve вызывается в onend, тут дублировать не надо, только чистим таймер
            } else {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 14000);
    });
}