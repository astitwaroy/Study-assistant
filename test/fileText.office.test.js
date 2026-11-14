// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { docxText, pptxSlides, readStudyFile } from '../src/lib/fileText.js';

const bytes = async (name) => readFile(path.resolve('test/fixtures', name));

describe('reading PowerPoint files', () => {
  it('reads visible slides in presentation order, with speaker notes', async () => {
    const slides = await pptxSlides(await bytes('slides.pptx'), JSZip);
    expect(slides).toEqual([
      'Photosynthesis\nLight energy becomes chemical energy\nTakes place in chloroplasts',
      "The Calvin cycle\nHappens in the stroma\nRuBisCO fixes CO2 onto RuBP\nSpeaker notes: Stress that it doesn't need light directly.",
    ]);
  });

  it('works through readStudyFile', async () => {
    const file = new File([await bytes('slides.pptx')], 'Lecture 5.pptx');
    expect(await readStudyFile(file)).toMatchObject({ kind: 'pptx', unit: 'slide', name: 'Lecture 5.pptx' });
  });

  it('explains a damaged or fake .pptx', async () => {
    await expect(pptxSlides(new TextEncoder().encode('not a zip'), JSZip)).rejects.toThrow(/couldn't be opened as a PowerPoint/);
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(pptxSlides(await zip.generateAsync({ type: 'uint8array' }), JSZip)).rejects.toThrow(/doesn't look like a PowerPoint/);
  });
});

describe('reading Word files', () => {
  it('reads paragraphs and table cells in order', async () => {
    expect(await docxText(await bytes('notes.docx'), JSZip)).toBe(
      [
        'Cell respiration',
        'Glycolysis happens in the cytoplasm and makes 2 ATP.',
        'The Krebs cycle happens in the mitochondrial matrix.',
        'Stage',
        'Location',
        'Electron transport chain',
        'Inner mitochondrial membrane',
      ].join('\n'),
    );
  });
});
