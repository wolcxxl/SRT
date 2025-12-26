export async function translateApi(text, sl, tl) {
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(u);
    const d = await r.json();
    return d[0].map(x => x[0]).join('');
}

export async function fetchPhonetics(word, lang) {
    // Если это не английский, фонетику API часто не дает, можно сразу вернуть пустоту
    if (!lang.startsWith('en')) return {}; 

    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${word}`);
        
        // ВАЖНО: Если статус 404, просто возвращаем пустой объект, не ругаясь в консоль
        if (res.status === 404) return {}; 
        
        if (!res.ok) throw new Error('API Error');
        
        const data = await res.json();
        // ... ваша логика парсинга ...
        // (Обычно возвращается data[0].phonetic или data[0].phonetics...)
        return { 
            ipa: data[0]?.phonetic || '', 
            // ... 
        };
    } catch (e) {
        // Заглушаем ошибку, чтобы она не краснила консоль
        return {};
    }
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