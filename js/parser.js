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

// --- FB2 Parser ---
export function parseFb2(txt) {
    const doc = new DOMParser().parseFromString(txt, "text/xml");
    const body = doc.querySelector("body");
    if (!body) throw new Error("Неверный формат FB2");
    
    const binaries = {};
    doc.querySelectorAll("binary").forEach(bin => {
        const id = bin.getAttribute("id");
        const type = bin.getAttribute("content-type");
        if (id && type) {
            binaries[`#${id}`] = `data:${type};base64,${bin.textContent}`;
        }
    });

    const secs = Array.from(body.querySelectorAll("section"));
    let chapters = [];
    
    if (secs.length > 0) {
        secs.forEach((s, i) => {
            let t = s.querySelector("title")?.textContent || `Глава ${i + 1}`;
            t = t.replace(/[\n\t]/g, ' ').trim();
            if (t.length > 50) t = t.substring(0, 50) + "...";
            chapters.push({ title: t, content: s, images: binaries });
        });
    } else {
        chapters.push({ title: "Текст книги", content: body, images: binaries });
    }
    return chapters;
}

export function getFb2ChapterText(section, images = {}) {
    let result = [];
    function traverse(node) {
        if (node.nodeType === 3) { 
            const text = node.nodeValue.trim();
            if (text) result.push(text);
        } else if (node.nodeType === 1) { 
            if (node.tagName === 'image') {
                const href = node.getAttribute('l:href') || node.getAttribute('xlink:href');
                if (href && images[href]) {
                    result.push(`[IMG:${images[href]}]`);
                }
            } else {
                if (['p', 'v', 'subtitle', 'title'].includes(node.tagName)) {
                    node.childNodes.forEach(traverse);
                    result.push('\n\n'); 
                } else {
                    node.childNodes.forEach(traverse);
                }
            }
        }
    }
    traverse(section);
    return result.join(" ").replace(/\n\s+\n/g, '\n\n').trim();
}

// --- EPUB Parser (Исправленный v2) ---
export async function parseEpub(buffer) {
    const book = ePub(buffer);
    await book.ready;
    
    const meta = book.package.metadata;
    const title = meta.title || "Без названия";
    
    // 1. Извлекаем обложку (если есть)
    let coverUrl = null;
    try {
        coverUrl = await book.coverUrl();
    } catch(e) { console.warn("Cover not found"); }

    // 2. Строим список глав на основе SPINE (гарантирует, что файл существует)
    // Оглавление (TOC) используем только для красивых названий
    const chapters = [];
    
    // Создаем карту оглавления для быстрого поиска названий
    const navItems = await book.loaded.navigation; // Загружаем навигацию
    const tocMap = {};
    
    const mapToc = (items) => {
        items.forEach(item => {
            // Очищаем href от якорей (file.html#part1 -> file.html)
            const cleanHref = item.href.split('#')[0]; 
            tocMap[cleanHref] = item.label.trim();
            if (item.subitems) mapToc(item.subitems);
        });
    };
    if (navItems && navItems.toc) mapToc(navItems.toc);

    // Перебираем физические файлы книги
    book.spine.each((item) => {
        // Пропускаем служебные файлы, если нужно (обычно не требуется)
        const label = tocMap[item.href] || `Глава ${item.index + 1}`;
        
        chapters.push({
            title: label,
            href: item.href,
            index: item.index, // Важно: используем индекс spine для загрузки
            id: item.id
        });
    });

    return { book, chapters, title, coverUrl };
}

export async function getEpubChapterContent(book, chapter) {
    // Загружаем по spine элементу, это надежнее чем по href
    const doc = await book.load(chapter.href); 
    
    // Исправляем картинки
    const images = doc.querySelectorAll('img, image');
    const promises = Array.from(images).map(async (img) => {
        const src = img.getAttribute('src') || img.getAttribute('xlink:href');
        if (src) {
            const path = book.path.resolve(src, chapter.href);
            try {
                const url = await book.archive.createUrl(path);
                img.setAttribute('src', url);
                img.setAttribute('data-processed', 'true');
            } catch (e) {
                console.warn("Img err:", path);
            }
        }
    });
    
    await Promise.all(promises);

    let output = [];
    function traverse(node) {
        if (node.nodeType === 3) {
            let t = node.nodeValue.replace(/\s+/g, ' ');
            if (t.trim()) output.push(t);
        } else if (node.nodeType === 1) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'img' || tag === 'image') {
                const src = node.getAttribute('src') || node.getAttribute('xlink:href');
                if (src && node.getAttribute('data-processed')) {
                    output.push(`\n\n[IMG:${src}]\n\n`);
                }
            } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'br', 'li'].includes(tag)) {
                output.push('\n\n');
                node.childNodes.forEach(traverse);
            } else {
                node.childNodes.forEach(traverse);
            }
        }
    }

    traverse(doc.body);
    return output.join("").replace(/\n\s*\n/g, '\n\n').trim();
}

export async function parsePdf(buffer) {
    const pdf = await pdfjsLib.getDocument(buffer).promise;
    let t = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
        const p = await pdf.getPage(i);
        const c = await p.getTextContent();
        t += c.items.map(s => s.str).join(' ') + "\n\n";
    }
    return t;
}
