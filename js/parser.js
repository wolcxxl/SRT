// js/parser.js

// Настройка PDF.js (если используется)
if(window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

export async function loadZip(f) {
    const z = new JSZip();
    const c = await z.loadAsync(f);
    let t = null, n = "";
    // Ищем файлы книг
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
    
    // Пытаемся найти картинки (binary)
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
            t = t.replace(/[\n\t]/g, ' ').trim(); // Чистим заголовок
            if (t.length > 40) t = t.substring(0, 40) + "...";
            chapters.push({ title: t, content: s, images: binaries });
        });
    } else {
        chapters.push({ title: "Текст книги", content: body, images: binaries });
    }
    return chapters;
}

export function getFb2ChapterText(section, images = {}) {
    // Рекурсивно обходим узлы, чтобы сохранить картинки
    let result = [];
    
    function traverse(node) {
        if (node.nodeType === 3) { // Текст
            const text = node.nodeValue.trim();
            if (text) result.push(text);
        } else if (node.nodeType === 1) { // Элемент
            if (node.tagName === 'image') {
                const href = node.getAttribute('l:href') || node.getAttribute('xlink:href');
                if (href && images[href]) {
                    // Вставляем маркер картинки, который потом обработаем в app.js
                    result.push(`[IMG:${images[href]}]`);
                }
            } else {
                // Если это блочный элемент, добавляем перенос
                if (['p', 'v', 'subtitle', 'title'].includes(node.tagName)) {
                    node.childNodes.forEach(traverse);
                    result.push('\n\n'); // Разделитель параграфов
                } else {
                    node.childNodes.forEach(traverse);
                }
            }
        }
    }
    
    traverse(section);
    return result.join(" ").replace(/\n\s+\n/g, '\n\n').trim();
}

// --- EPUB Parser (Исправленный) ---
export async function parseEpub(buffer) {
    const book = ePub(buffer);
    await book.ready;
    
    // Получаем метаданные (название, автор)
    const meta = book.package.metadata;
    const title = meta.title || "Без названия";

    // Строим навигацию (TOC)
    const nav = await book.loaded.navigation;
    let chapters = [];
    
    // Функция для выпрямления дерева глав (flatten)
    const flatten = (items) => {
        items.forEach(item => {
            // Ищем spine item по href
            const spineItem = book.spine.get(item.href);
            if (spineItem) {
                chapters.push({
                    title: item.label.trim(),
                    href: item.href,
                    index: spineItem.index
                });
            }
            if (item.subitems && item.subitems.length > 0) {
                flatten(item.subitems);
            }
        });
    };

    if (nav.toc && nav.toc.length > 0) {
        flatten(nav.toc);
    } else {
        // Если TOC пустой, берем просто список файлов (Spine)
        book.spine.each((item) => {
            chapters.push({
                title: `Глава ${item.index + 1}`,
                href: item.href,
                index: item.index
            });
        });
    }

    // Удаляем дубликаты по индексу (иногда TOC ссылается на одно и то же)
    chapters = chapters.filter((v, i, a) => a.findIndex(t => t.index === v.index) === i);
    // Сортируем по порядку в книге
    chapters.sort((a, b) => a.index - b.index);

    return { book, chapters, title };
}

export async function getEpubChapterContent(book, chapter) {
    const doc = await book.load(chapter.href);
    
    // 1. Исправляем картинки
    // epub.js не резолвит пути к картинкам автоматически при .load(),
    // нам нужно достать их из архива и превратить в Blob URL
    const images = doc.querySelectorAll('img');
    const promises = Array.from(images).map(async (img) => {
        const src = img.getAttribute('src');
        if (src) {
            // Получаем абсолютный путь внутри epub
            const path = book.path.resolve(src, chapter.href);
            try {
                // Просим epub.js создать blob url
                const url = await book.archive.createUrl(path);
                img.setAttribute('src', url);
                img.setAttribute('data-processed', 'true');
            } catch (e) {
                console.warn("Не удалось загрузить картинку:", path);
            }
        }
    });
    
    await Promise.all(promises);

    // 2. Преобразуем DOM в текст с маркерами картинок
    let output = [];
    
    function traverse(node) {
        if (node.nodeType === 3) { // Текст
            let t = node.nodeValue.replace(/\s+/g, ' ');
            if (t.trim()) output.push(t);
        } else if (node.nodeType === 1) { // Элемент
            if (node.tagName.toLowerCase() === 'img') {
                const src = node.getAttribute('src');
                if (src && node.getAttribute('data-processed')) {
                    output.push(`\n\n[IMG:${src}]\n\n`);
                }
            } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'br', 'li'].includes(node.tagName.toLowerCase())) {
                output.push('\n\n'); // Начало блока
                node.childNodes.forEach(traverse);
            } else {
                node.childNodes.forEach(traverse);
            }
        }
    }

    traverse(doc.body);
    
    // Чистим результат от лишних пробелов и пустых строк
    return output.join("").replace(/\n\s*\n/g, '\n\n').trim();
}

// --- PDF Parser ---
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
