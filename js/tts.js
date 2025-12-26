const voiceProfiles = {
    'ru': { m: ['Dmitry', 'Pavel', 'Ivan', 'Male'], f: ['Svetlana', 'Alina', 'Tatyana', 'Female'] },
    'en': { m: ['Guy', 'Stefan', 'Christopher', 'Male'], f: ['Aria', 'Jenny', 'Michelle', 'Female'] },
    'de': { m: ['Conrad', 'Stefan', 'Male'], f: ['Katja', 'Marlene', 'Female'] }
};

let currentAudio = null;
let audioResolve = null;

export function getBestVoice(lang, genderPref, mode) {
    if (!window.speechSynthesis) return null;
    const allVoices = window.speechSynthesis.getVoices();
    const code = lang === 'en' ? 'en' : (lang === 'de' ? 'de' : 'ru');
    let candidates = allVoices.filter(v => v.lang.toLowerCase().startsWith(code));

    if (mode === 'edge') {
        let hq = candidates.filter(v => v.name.includes("Natural") || v.name.includes("Microsoft") || v.name.includes("Online"));
        if (hq.length > 0) candidates = hq;
    } 

    const keywords = voiceProfiles[code] ? voiceProfiles[code][genderPref] : [];
    let match = candidates.find(v => keywords.some(k => v.name.includes(k)));
    if (!match && candidates.length > 0) match = candidates[0];
    return match;
}

export function stopAudio(fullStop = true) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (audioResolve) { audioResolve(); audioResolve = null; }
}

export function playGoogleSingle(text, lang, rate) {
    return new Promise((resolve) => {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        audioResolve = resolve;

        const audio = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`);
        audio.playbackRate = rate;
        currentAudio = audio;

        audio.onended = () => { currentAudio = null; resolve(); };
        audio.onerror = () => { console.warn("Google blocked"); currentAudio = null; resolve(); };
        audio.play().catch(() => resolve());
    });
}

export function speakDevice(text, lang, gender, mode, rate) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        window.speechSynthesis.cancel();
        audioResolve = resolve;

        const u = new SpeechSynthesisUtterance(text);
        const targetLang = lang === 'en' ? 'en-US' : (lang === 'de' ? 'de-DE' : 'ru-RU');
        const voice = getBestVoice(lang, gender, mode);

        if (voice) u.voice = voice;
        u.lang = targetLang;
        u.rate = rate;

        u.onend = resolve;
        u.onerror = resolve;
        window.speechSynthesis.speak(u);

        // Хак для длинных текстов, чтобы не прерывалось
        const t = setInterval(() => {
            if (!window.speechSynthesis.speaking) { clearInterval(t); resolve(); }
        }, 500);
    });
}