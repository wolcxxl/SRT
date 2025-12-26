export async function translateApi(text, sl, tl) {
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(u);
    const d = await r.json();
    return d[0].map(x => x[0]).join('');
}

export async function fetchPhonetics(word, lang) {
    const w = word.toLowerCase().replace(/[.,!?;:()"]/g, '');
    if (!w) return { ipa: null, cyr: null };

    if (lang === 'en' || lang === 'auto') {
        try {
            const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`);
            if (r.ok) {
                const d = await r.json();
                return { ipa: d[0].phonetic, cyr: transliterateEn(w) };
            }
        } catch { }
    }
    if (lang === 'de') return { ipa: germanToIPA(w), cyr: transliterateDe(w) };
    return { ipa: null, cyr: null };
}

function germanToIPA(w) {
    let s = w.toLowerCase();
    s = s.replace(/sch/g, 'ʃ').replace(/ch/g, 'ç').replace(/ei/g, 'aɪ').replace(/ie/g, 'iː').replace(/eu/g, 'ɔʏ').replace(/äu/g, 'ɔʏ').replace(/au/g, 'aʊ').replace(/ä/g, 'ɛ').replace(/ö/g, 'ø').replace(/ü/g, 'y').replace(/ß/g, 's').replace(/j/g, 'j').replace(/v/g, 'f').replace(/w/g, 'v').replace(/z/g, 'ts').replace(/sp/g, 'ʃp').replace(/st/g, 'ʃt');
    return `[${s}]`;
}

function transliterateDe(w) {
    let s = w.toLowerCase();
    s = s.replace(/sch/g, 'ш').replace(/ch/g, 'х').replace(/ei/g, 'ай').replace(/ie/g, 'i').replace(/eu/g, 'ой').replace(/äu/g, 'ой').replace(/au/g, 'ау').replace(/ä/g, 'э').replace(/ö/g, 'ё').replace(/ü/g, 'ю').replace(/ß/g, 'сс').replace(/j/g, 'й').replace(/v/g, 'ф').replace(/w/g, 'в').replace(/z/g, 'ц').replace(/sp/g, 'шп').replace(/st/g, 'шт').replace(/h/g, 'х');
    return s;
}

function transliterateEn(w) {
    const map = { 'sh': 'ш', 'ch': 'ч', 'th': 'з', 'ph': 'ф', 'oo': 'у', 'ee': 'и', 'ea': 'и', 'ck': 'к', 'qu': 'кв', 'a': 'а', 'b': 'б', 'c': 'к', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г', 'h': 'х', 'i': 'и', 'j': 'дж', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т', 'u': 'ю', 'v': 'в', 'w': 'в', 'x': 'кс', 'y': 'й', 'z': 'з' };
    let s = w;
    for (let k in map) s = s.replace(new RegExp(k, 'g'), map[k]);
    return s;
}