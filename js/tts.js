// tts.js

const voiceProfiles = {
    'ru': { m: ['Dmitry', 'Pavel', 'Ivan', 'Male', 'Rus'], f: ['Svetlana', 'Alina', 'Tatyana', 'Female', 'Milena'] },
    'en': { m: ['Guy', 'Stefan', 'Christopher', 'Male'], f: ['Aria', 'Jenny', 'Michelle', 'Female', 'Google US'] },
    'de': { m: ['Conrad', 'Stefan', 'Male'], f: ['Katja', 'Marlene', 'Female'] }
};

let currentAudio = null;
let audioResolve = null;
let speechTimeout = null;

export function getBestVoice(lang, genderPref, mode) {
    if (!window.speechSynthesis) return null;
    const allVoices = window.speechSynthesis.getVoices();
    const code = lang.split('-')[0].toLowerCase();
    
    let candidates = allVoices.filter(v => v.lang.toLowerCase().startsWith(code));

    // Если режим Edge - ищем качественные голоса
    if (mode === 'edge') {
        let hq = candidates.filter(v => v.name.includes("Natural") || v.name.includes("Microsoft") || v.name.includes("Online") || v.name.includes("Google"));
        if (hq.length > 0) candidates = hq;
    } 

    const profiles = voiceProfiles[code];
    const keywords = profiles ? profiles[genderPref] : [];
    
    let match = candidates.find(v => keywords.some(k => v.name.includes(k)));
    if (!match && candidates.length > 0) match = candidates[0];
    
    return match;
}

// Жесткая остановка всего
export function stopAudio() {
    // 1. Останавливаем нативный синтез
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    
    // 2. Останавливаем аудио-файл (Google)
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = ""; // Важно для сброса буфера на мобильных
        currentAudio = null;
    }
    
    // 3. Очищаем таймеры
    if (speechTimeout) {
        clearTimeout(speechTimeout);
        speechTimeout = null;
    }
    
    // 4. Сбрасываем промис
    if (audioResolve) {
        audioResolve();
        audioResolve = null;
    }
}

// Вставьте в js/tts.js

export function playGoogleSingle(text, lang, rate) {
    return new Promise((resolve, reject) => { // Добавили reject
        stopAudio(); 
        audioResolve = resolve;

        const failTimeout = setTimeout(() => {
            // Если таймаут — это ошибка, переключаемся на Device
            reject("Timeout"); 
        }, 5000); 

        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
        const audio = new Audio(url);
        
        audio.playbackRate = rate;
        currentAudio = audio;

        audio.onended = () => {
            clearTimeout(failTimeout);
            currentAudio = null;
            resolve();
        };

        audio.onerror = () => {
            clearTimeout(failTimeout);
            currentAudio = null;
            // ВАЖНО: Возвращаем ошибку, чтобы app.js переключил режим
            reject("Google Blocked"); 
        };

        audio.play().catch(e => {
            clearTimeout(failTimeout);
            // Ошибка воспроизведения (политика браузера) — тоже реджект
            reject(e);
        });
    });
}

export function speakDevice(text, lang, gender, mode, rate) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        
        // ВАЖНО: Cancel должен быть синхронным перед созданием нового Utterance
        window.speechSynthesis.cancel();
        
        audioResolve = resolve;

        const u = new SpeechSynthesisUtterance(text);
        
        // Нормализация языка
        let targetLang = lang;
        if (lang === 'en') targetLang = 'en-US';
        if (lang === 'de') targetLang = 'de-DE';
        if (lang === 'ru') targetLang = 'ru-RU';

        const voice = getBestVoice(targetLang, gender, mode);
        if (voice) u.voice = voice;
        
        u.lang = targetLang;
        u.rate = rate;

        u.onend = () => {
            if (speechTimeout) clearTimeout(speechTimeout);
            resolve();
        };
        
        u.onerror = (e) => {
            console.error("Device TTS error", e);
            if (speechTimeout) clearTimeout(speechTimeout);
            resolve();
        };

        window.speechSynthesis.speak(u);

        // Хак для Chrome/Android: если речь длинная, она может "зависнуть".
        // Пингуем движок каждые 10 секунд.
        speechTimeout = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
                clearInterval(speechTimeout);
                resolve();
            } else {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 10000);
    });
}