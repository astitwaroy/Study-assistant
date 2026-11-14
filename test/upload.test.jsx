// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { NotesForm } from '../src/components/NotesForm.jsx';

function Harness({ initial = '' }) {
  const [draft, setDraft] = useState({ input: initial, mode: 'flashcards', count: 10 });
  return <NotesForm draft={draft} onChange={setDraft} counts={[5, 10]} running={false} onSubmit={() => {}} />;
}

const pptx = async () => new File([await readFile(path.resolve('test/fixtures/slides.pptx'))], 'Lecture 5.pptx');
const fileInput = () => document.querySelector('input[type=file]');
const notes = () => screen.getByLabelText('Your notes or a topic');

describe('uploading a file', () => {
  it('puts the slides into the notes box and lets you choose slides', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(fileInput(), await pptx());

    await waitFor(() => expect(notes().value).toMatch(/^Photosynthesis/));
    expect(notes().value).toMatch(/Speaker notes: Stress that/);
    expect(screen.getByText('Lecture 5.pptx')).toBeInTheDocument();
    expect(screen.getByText('2 slides')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Use slides from'), '2');
    expect(notes().value).toMatch(/^The Calvin cycle/);
    expect(notes().value).not.toMatch(/Photosynthesis/);
  });

  it('gives your earlier notes back when you remove the file', async () => {
    const user = userEvent.setup();
    render(<Harness initial="My own notes" />);
    await user.upload(fileInput(), await pptx());
    await waitFor(() => expect(notes().value).toMatch(/^Photosynthesis/));
    expect(screen.getByText(/get your earlier notes back/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(notes().value).toBe('My own notes');
    expect(screen.queryByText('Lecture 5.pptx')).not.toBeInTheDocument();
  });

  it('explains files it cannot read and leaves the notes alone', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial="Keep me" />);
    await user.upload(fileInput(), new File(['x'], 'old deck.ppt'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/older \.ppt format/);
    expect(notes().value).toBe('Keep me');
  });
});
