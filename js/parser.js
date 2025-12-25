// Настройка PDF.js (ссылаемся на глобальный объект, так как он загружен через CDN)
if(window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

export async function loadZip(f) {
    const z = new JSZip();
    const c = await z.loadAsync(f);
    let t = null, n = "";
    for (let k in c.files) {
        if (k.match(/\.(fb2|epub|txt)$/i) && !c.files[k].dir) {
            t = c.files[k];
            n = k.toLowerCase();
            break;
        }
    }
    if (!t) throw new Error("Нет книг в архиве");
    
    if (n.endsWith('.epub')) return { type: 'epub', data: await t.async("arraybuffer") };
    if (n.endsWith('.fb2')) return { type: 'fb2', data: await t.async("string") };
    return { type: 'txt', data: await t.async("string") };
}

export function parseFb2(txt) {
    const doc = new DOMParser().parseFromString(txt, "text/xml");
    const body = doc.querySelector("body");
    if (!body) throw new Error("Bad FB2");
    
    const secs = Array.from(body.querySelectorAll("section"));
    let chapters = [];
    
    if (secs.length > 0) {
        secs.forEach((s, i) => {
            let t = s.querySelector("title")?.textContent || `Glava ${i + 1}`;
            if (t.length > 20) t = t.substring(0, 20) + "...";
            chapters.push({ title: t, content: s });
        });
    } else {
        chapters.push({ title: "Текст", content: body });
    }
    return chapters;
}

export function getFb2ChapterText(section) {
    let txt = "";
    const ps = section.querySelectorAll("p,v,subtitle");
    if (ps.length > 0) ps.forEach(p => txt += p.textContent + "\n\n");
    else txt = section.textContent;
    return txt;
}

export async function parsePdf(buffer) {
    const pdf = await pdfjsLib.getDocument(buffer).promise;
    let t = "";
    // Ограничение 30 страниц для производительности
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
        const p = await pdf.getPage(i);
        const c = await p.getTextContent();
        t += c.items.map(s => s.str).join(' ') + "\n\n";
    }
    return t;
}