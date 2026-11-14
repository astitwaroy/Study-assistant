import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dropRepeatedLines, joinParts, partsThatFit, pdfPageText, readStudyFile } from '../src/lib/fileText.js';

// The browser build of pdf.js needs a web worker; Node uses the legacy build.
const loadPdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');
const fixture = async (name, type) => new File([await readFile(path.resolve('test/fixtures', name))], name, { type });

describe('reading PDFs', () => {
  it('returns one part per page, without the running header and page numbers', async () => {
    const progress = [];
    const result = await readStudyFile(await fixture('notes.pdf', 'application/pdf'), {
      loadPdfjs,
      onProgress: (p) => progress.push(p.done),
    });
    expect(result).toMatchObject({ kind: 'pdf', unit: 'page', name: 'notes.pdf' });
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toMatch(/^Photosynthesis turns light energy/);
    expect(result.parts[2]).toMatch(/RuBisCO fixes carbon dioxide onto RuBP/);
    expect(result.parts.join('\n')).not.toMatch(/Biology 101|^\d+$/m);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('explains scanned PDFs, which have no text to read', async () => {
    await expect(readStudyFile(await fixture('scanned.pdf', 'application/pdf'), { loadPdfjs })).rejects.toThrow(/no selectable text/);
  });

  it('explains password-protected PDFs', async () => {
    await expect(readStudyFile(await fixture('locked.pdf', 'application/pdf'), { loadPdfjs })).rejects.toThrow(/password-protected/);
  });

  it('explains files that only pretend to be PDFs', async () => {
    const fake = new File(['hello, not a pdf'], 'fake.pdf', { type: 'application/pdf' });
    await expect(readStudyFile(fake, { loadPdfjs })).rejects.toThrow(/couldn't be read as a PDF/);
  });
});

describe('text helpers', () => {
  it('joins pdf.js items, rejoining lines that carry on a sentence', () => {
    expect(pdfPageText([{ str: 'Light ' }, { str: 'energy is', hasEOL: true }, { type: 'beginMarkedContent' }, { str: 'stored.', hasEOL: true }, { str: 'Next point' }])).toBe(
      'Light energy is stored.\nNext point',
    );
  });

  it('only strips lines that repeat at the edges of most pages', () => {
    const pages = ['Course notes\nA real line\nPage 1', 'Course notes\nAnother line\nPage 2', 'Course notes\nCourse notes are fun\nPage 3'];
    expect(dropRepeatedLines(pages)).toEqual(['A real line', 'Another line', 'Course notes are fun']);
  });

  it('keeps a long sentence even if every page starts with it', () => {
    const opening = (n) => `Chapter ${n}. Cells use enzymes to speed up reactions by lowering the activation energy.`;
    const pages = [1, 2, 3].map((n) => `${opening(n)}\nBody ${n}`);
    expect(dropRepeatedLines(pages).map((p) => p.split('\n')[0])).toEqual([opening(1), opening(2), opening(3)]);
  });

  it('picks the pages that fit and joins a chosen range', () => {
    const parts = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)];
    expect(partsThatFit(parts, 105)).toBe(2);
    expect(partsThatFit(parts, 10)).toBe(1); // always at least one page, even if it's too long
    expect(joinParts(parts, 2, 3)).toBe(`${'b'.repeat(50)}\n\n${'c'.repeat(50)}`);
  });
});

describe('unsupported files', () => {
  it.each([
    ['old.ppt', /older \.ppt format/],
    ['essay.doc', /older \.doc format/],
    ['photo.png', /PDF, PowerPoint \(\.pptx\), Word \(\.docx\) and text files/],
  ])('explains what to do with %s', async (name, message) => {
    await expect(readStudyFile(new File(['x'], name))).rejects.toThrow(message);
  });

  it('refuses empty and huge files before reading them', async () => {
    await expect(readStudyFile(new File([], 'empty.pdf'))).rejects.toThrow(/empty/);
    const huge = { name: 'huge.pdf', size: 30 * 1024 * 1024, type: 'application/pdf' };
    await expect(readStudyFile(huge)).rejects.toThrow(/up to 25 MB/);
  });

  it('reads plain text files', async () => {
    const result = await readStudyFile(new File(['  Line one  \r\n\r\n\r\n\r\nLine two '], 'notes.txt', { type: 'text/plain' }));
    expect(result.parts).toEqual(['Line one\n\nLine two']);
  });
});
