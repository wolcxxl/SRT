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

export function stopAudio() {
    // 1. Сначала отменяем таймеры
    if (speechTimeout) { clearTimeout(speechTimeout); speechTimeout = null; }

    // 2. Останавливаем нативный синтез
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    
    // 3. Останавливаем Google Audio
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = ""; 
        currentAudio = null;
    }
    
    // 4. Сбрасываем промис (освобождаем очередь)
    if (audioResolve) {
        audioResolve();
        audioResolve = null;
    }
}

export function playGoogleSingle(text, lang, rate) {
    return new Promise((resolve, reject) => {
        stopAudio(); 
        audioResolve = resolve;

        // Если Google тупит дольше 6 секунд — сбрасываем
        const failTimeout = setTimeout(() => {
            reject("Timeout"); 
        }, 6000); 

        // client=gtx работает стабильнее, чем tw-ob
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx&dt=t`;
        
        const audio = new Audio(url);
        audio.playbackRate = rate;
        currentAudio = audio;

        audio.onended = () => {
            clearTimeout(failTimeout);
            currentAudio = null;
            resolve();
        };

        audio.onerror = (e) => {
            clearTimeout(failTimeout);
            currentAudio = null;
            // Реджектим промис, чтобы app.js переключился на Device
            reject("Google Error"); 
        };

        audio.play().catch(e => {
            clearTimeout(failTimeout);
            reject(e); // Ошибка автоплея или сети
        });
    });
}

export function speakDevice(text, lang, gender, mode, rate) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        
        // ВАЖНО: Останавливаем предыдущее и ждем 50мс перед стартом нового.
        // Это лечит ошибку "interrupted" на мобильных.
        window.speechSynthesis.cancel();
        
        setTimeout(() => {
            audioResolve = resolve;

            const u = new SpeechSynthesisUtterance(text);
            let targetLang = lang;
            if (lang === 'en') targetLang = 'en-US';
            if (lang === 'de') targetLang = 'de-DE';
            if (lang === 'ru') targetLang = 'ru-RU';

            const voice = getBestVoice(targetLang, gender, mode);
            if (voice) u.voice = voice;
            
            u.lang = targetLang;
            u.rate = rate;

            // Если произойдет конец или ошибка — завершаем
            const finish = () => {
                if (speechTimeout) clearTimeout(speechTimeout);
                resolve();
            };

            u.onend = finish;
            u.onerror = (e) => {
                console.warn("Device TTS warning:", e.error);
                finish();
            };

            window.speechSynthesis.speak(u);

            // Пинг-понг для Chrome, чтобы не зависал на длинных текстах
            speechTimeout = setInterval(() => {
                if (!window.speechSynthesis.speaking) {
                    clearInterval(speechTimeout);
                    finish();
                } else {
                    window.speechSynthesis.pause();
                    window.speechSynthesis.resume();
                }
            }, 10000);
        }, 50); // <-- Небольшая задержка перед стартом
    });
}