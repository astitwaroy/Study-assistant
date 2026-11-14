/**
 * Turning an uploaded file into study notes, entirely in the browser.
 *
 * The file never leaves the person's machine: we extract its text here and
 * put it in the notes box, where they can check and trim it before anything
 * is sent to the model. That also keeps the server provider-agnostic: every
 * model gets plain text, whatever the file was.
 *
 * Each reader returns `parts`: one string per PDF page or slide (so the
 * person can pick a range when a long file doesn't fit), or a single part
 * for Word and text files.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

export const ACCEPT = [
  '.pdf',
  '.pptx',
  '.docx',
  '.txt',
  '.md',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
].join(',');

const SUPPORTED = 'PDF, PowerPoint (.pptx), Word (.docx) and text files';

export class FileReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileReadError';
  }
}

export function fileKind(file) {
  const extension = (file.name.split('.').pop() ?? '').toLowerCase();
  if (extension === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (extension === 'pptx') return 'pptx';
  if (extension === 'docx') return 'docx';
  if (extension === 'ppt' || extension === 'pps') return 'ppt';
  if (extension === 'doc') return 'doc';
  if (['txt', 'md', 'markdown', 'text'].includes(extension) || file.type?.startsWith('text/')) return 'text';
  return 'unknown';
}

/**
 * @returns {Promise<{name: string, kind: string, unit: 'page'|'slide'|'part', parts: string[], truncated?: boolean}>}
 * @throws {FileReadError} with a message meant for the person
 */
export async function readStudyFile(file, { onProgress, signal, loadPdfjs = loadBrowserPdfjs } = {}) {
  if (file.size === 0) throw new FileReadError('That file is empty.');
  if (file.size > MAX_FILE_BYTES) {
    throw new FileReadError(`That file is ${Math.round(file.size / 1024 / 1024)} MB. Recall reads files up to 25 MB.`);
  }

  const kind = fileKind(file);
  let result;
  if (kind === 'pdf') {
    result = { unit: 'page', ...(await readPdf(await file.arrayBuffer(), { onProgress, signal, loadPdfjs })) };
  } else if (kind === 'pptx') {
    result = { unit: 'slide', parts: await pptxSlides(await file.arrayBuffer(), await loadJSZip()) };
  } else if (kind === 'docx') {
    result = { unit: 'part', parts: [await docxText(await file.arrayBuffer(), await loadJSZip())] };
  } else if (kind === 'text') {
    result = { unit: 'part', parts: [tidy(await file.text())] };
  } else if (kind === 'ppt') {
    throw new FileReadError(
      'Recall can read .pptx files but not the older .ppt format. Open it in PowerPoint, Keynote or Google Slides and save it as .pptx or PDF.',
    );
  } else if (kind === 'doc') {
    throw new FileReadError(
      'Recall can read .docx files but not the older .doc format. Open it in Word or Google Docs and save it as .docx or PDF.',
    );
  } else {
    throw new FileReadError(`Recall can read ${SUPPORTED}.`);
  }

  if (!result.parts.some((part) => part.trim())) {
    throw new FileReadError(
      kind === 'pdf'
        ? "This PDF has no selectable text. It's probably scanned pages, which are pictures of text. Try a PDF you can select text in, or paste the notes instead."
        : 'There is no text in this file to make questions from.',
    );
  }
  return { name: file.name, kind, ...result };
}

/** Joins the chosen parts (1-based, inclusive) into notes text. */
export function joinParts(parts, from = 1, to = parts.length) {
  return parts
    .slice(from - 1, to)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** The longest run of parts from the start whose text fits in `limit` characters. */
export function partsThatFit(parts, limit) {
  let to = 0;
  for (let n = 1; n <= parts.length; n++) {
    if (joinParts(parts, 1, n).length > limit) break;
    to = n;
  }
  return Math.max(1, to);
}

/* ---------- PDF ---------- */

async function loadBrowserPdfjs() {
  // Loaded only when someone picks a PDF: pdf.js is large and most visits never need it.
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function readPdf(data, { onProgress, signal, loadPdfjs = loadBrowserPdfjs } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    task.destroy();
    if (err?.name === 'PasswordException') {
      throw new FileReadError('This PDF is password-protected. Remove the password, or save an unlocked copy, then try again.');
    }
    throw new FileReadError("This file couldn't be read as a PDF. It may be damaged.");
  }

  try {
    const total = Math.min(doc.numPages, MAX_PDF_PAGES);
    const pages = [];
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(pdfPageText(content.items));
      page.cleanup();
      onProgress?.({ done: n, total });
    }
    return { parts: dropRepeatedLines(pages), truncated: doc.numPages > total };
  } finally {
    task.destroy(); // frees the worker and the parsed document
  }
}

/**
 * pdf.js text items -> text. pdf.js marks the end of every printed line;
 * lines that carry on a sentence ("...Each" / "enzyme has...") are joined
 * back up, while lines after a full stop, colon or heading stay separate.
 */
export function pdfPageText(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue; // marked-content markers
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return tidy(tidy(text).replace(/([^.!?:;\n])\n(?=[a-z(])/g, '$1 '));
}

/**
 * Removes running headers, footers and page numbers: short lines that repeat
 * at the top or bottom of most pages ("Biology 101 - Lecture 5", "Page 3").
 * Only short lines count, so a sentence that happens to open every page
 * ("Chapter 3. Cells use enzymes to…") is kept.
 */
const MAX_HEADER_LENGTH = 60;

export function dropRepeatedLines(pages) {
  if (pages.length < 3) return pages;
  const normalize = (line) => line.trim().toLowerCase().replace(/\d+/g, '#');
  const short = (line) => line.trim().length <= MAX_HEADER_LENGTH;
  const edgeCounts = new Map();
  for (const page of pages) {
    const lines = page.split('\n').filter((l) => l.trim());
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].filter(short).map(normalize));
    for (const key of edges) edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }
  const repeated = new Set([...edgeCounts].filter(([, count]) => count >= Math.ceil(pages.length * 0.6)).map(([key]) => key));
  const isPageNumber = (line) => /^(page\s*)?#(\s*(of|\/)\s*#)?$/.test(normalize(line));

  return pages.map((page) => {
    const lines = page.split('\n');
    const keep = (line, i) => {
      const nearEdge = i < 2 || i >= lines.length - 2;
      return !(nearEdge && short(line) && (repeated.has(normalize(line)) || isPageNumber(line)));
    };
    return tidy(lines.filter(keep).join('\n'));
  });
}

/* ---------- PowerPoint and Word (zip files of XML) ---------- */

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
};

async function loadJSZip() {
  return (await import('jszip')).default;
}

async function openZip(data, JSZip, what) {
  try {
    return await JSZip.loadAsync(data);
  } catch {
    throw new FileReadError(`This file couldn't be opened as a ${what} file. It may be damaged.`);
  }
}

async function readXml(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return new DOMParser().parseFromString(await file.async('text'), 'application/xml');
}

/** Relationship id -> target path, resolved against the folder of the part that owns them. */
async function readRels(zip, relsPath, baseDir) {
  const doc = await readXml(zip, relsPath);
  const map = new Map();
  if (!doc) return map;
  for (const rel of doc.getElementsByTagNameNS(NS.rel, 'Relationship')) {
    map.set(rel.getAttribute('Id'), { target: resolvePath(baseDir, rel.getAttribute('Target')), type: rel.getAttribute('Type') ?? '' });
  }
  return map;
}

function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function drawingParagraphs(root) {
  const lines = [];
  for (const p of root.getElementsByTagNameNS(NS.a, 'p')) {
    const text = [...p.getElementsByTagNameNS(NS.a, 't')].map((t) => t.textContent).join('');
    if (text.trim()) lines.push(text.trim());
  }
  return lines;
}

/** One string per visible slide, in presentation order, with speaker notes. */
export async function pptxSlides(data, JSZip) {
  const zip = await openZip(data, JSZip, 'PowerPoint');
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new FileReadError("This doesn't look like a PowerPoint (.pptx) file.");

  // Slide order lives in presentation.xml, not in the file names.
  const rels = await readRels(zip, 'ppt/_rels/presentation.xml.rels', 'ppt');
  let paths = [...presentation.getElementsByTagNameNS(NS.p, 'sldId')]
    .map((el) => rels.get(el.getAttributeNS(NS.r, 'id'))?.target)
    .filter(Boolean);
  if (paths.length === 0) {
    paths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  }

  const slides = [];
  for (const path of paths) {
    const slide = await readXml(zip, path);
    if (!slide || slide.documentElement.getAttribute('show') === '0') continue; // hidden slide

    const lines = drawingParagraphs(slide);
    const slideDir = path.slice(0, path.lastIndexOf('/'));
    const slideRels = await readRels(zip, `${slideDir}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`, slideDir);
    const notesPath = [...slideRels.values()].find((rel) => rel.type.endsWith('/notesSlide'))?.target;
    const notes = notesPath ? await speakerNotes(zip, notesPath) : [];

    const text = [lines.join('\n'), notes.length ? `Speaker notes: ${notes.join(' ')}` : ''].filter(Boolean).join('\n');
    slides.push(tidy(text));
  }
  return slides;
}

/** Only the notes body, not the slide-number or thumbnail placeholders. */
async function speakerNotes(zip, path) {
  const doc = await readXml(zip, path);
  if (!doc) return [];
  const lines = [];
  for (const shape of doc.getElementsByTagNameNS(NS.p, 'sp')) {
    const placeholder = shape.getElementsByTagNameNS(NS.p, 'ph')[0];
    if (placeholder?.getAttribute('type') === 'body') lines.push(...drawingParagraphs(shape));
  }
  return lines;
}

/** A Word document's text, paragraph by paragraph (table cells included). */
export async function docxText(data, JSZip) {
  const zip = await openZip(data, JSZip, 'Word');
  const doc = await readXml(zip, 'word/document.xml');
  if (!doc) throw new FileReadError("This doesn't look like a Word (.docx) file.");
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(NS.w, 'p')) {
    let text = '';
    for (const node of p.getElementsByTagNameNS(NS.w, '*')) {
      if (node.localName === 't') text += node.textContent;
      else if (node.localName === 'tab') text += '\t';
      else if (node.localName === 'br') text += '\n';
    }
    if (text.trim()) lines.push(text.trim());
  }
  return tidy(lines.join('\n'));
}

/* ---------- shared ---------- */

function tidy(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
