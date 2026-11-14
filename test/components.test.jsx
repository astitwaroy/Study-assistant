// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FlashcardDeck } from '../src/components/FlashcardDeck.jsx';
import { Quiz } from '../src/components/Quiz.jsx';
import { restoreSet } from '../src/hooks/useSavedSets.js';

beforeEach(() => localStorage.clear());

const quizSet = {
  id: 's_quiz',
  mode: 'quiz',
  title: 'Cells',
  version: 1,
  items: [
    { id: 'q1', type: 'mcq', question: 'Powerhouse of the cell?', options: ['Nucleus', 'Mitochondria'], answerIndex: 1, explanation: 'It makes ATP.' },
    { id: 'q2', type: 'true_false', statement: 'Plant cells have walls.', answer: true },
  ],
};

describe('Quiz', () => {
  it('lets you retake only what you missed', async () => {
    const user = userEvent.setup();
    render(<Quiz set={quizSet} />);

    await user.click(screen.getByRole('button', { name: /Nucleus/ }));
    expect(screen.getByText(/Not quite. The answer is Mitochondria/)).toBeInTheDocument();
    expect(screen.getByText('It makes ATP.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next question' }));

    await user.keyboard('t');
    expect(screen.getByText('Right.')).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: 'You got 1 of 2 right' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retake the 1 you missed' }));
    expect(screen.getByText(/Retake 1: question/)).toHaveTextContent('1 of 1');
    expect(screen.getByText('Powerhouse of the cell?')).toBeInTheDocument();
  });
});

describe('FlashcardDeck', () => {
  const deckSet = {
    id: 's_deck',
    mode: 'flashcards',
    title: 'Cells',
    version: 1,
    items: [
      { id: 'c1', type: 'flashcard', front: 'Front one', back: 'Back one' },
      { id: 'c2', type: 'flashcard', front: 'Front two', back: 'Back two' },
    ],
  };

  it('flips, grades and offers a review of the cards still being learned', async () => {
    const user = userEvent.setup();
    render(<FlashcardDeck set={deckSet} />);

    const card = screen.getByRole('button', { name: /Question: Front one/ });
    await user.click(card);
    expect(screen.getByRole('button', { name: /Answer: Back one/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Still learning' }));
    await user.keyboard('2');
    expect(screen.getByRole('heading', { name: 'You know 1 of 2 cards' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review the 1 still learning' }));
    expect(screen.getByRole('button', { name: /Question: Front one/ })).toBeInTheDocument();
    expect(screen.getByText(/Reviewing/)).toHaveTextContent('1 of 1');
  });

  it('remembers progress across remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FlashcardDeck set={deckSet} />);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    unmount();
    render(<FlashcardDeck set={deckSet} />);
    expect(screen.getByText('1 known')).toBeInTheDocument();
  });
});

describe('restoreSet', () => {
  it('re-validates stored sets like model output', () => {
    expect(restoreSet({ id: 'x', mode: 'quiz', items: 'nope' })).toBeNull();
    expect(restoreSet({ id: 'x', mode: 'essay', items: [] })).toBeNull();
    const restored = restoreSet({ id: 'x', mode: 'flashcards', title: 'T', items: [{ id: 'keep', front: 'a', back: 'b' }, { front: '' }] });
    expect(restored.items).toEqual([{ id: 'keep', type: 'flashcard', front: 'a', back: 'b' }]);
  });
});

describe('typed questions', () => {
  const typedSet = {
    id: 's_typed',
    mode: 'quiz',
    title: 'Cells',
    version: 1,
    items: [{ id: 't1', type: 'fill_blank', prompt: 'The Calvin cycle uses ATP and ____.', answers: ['NADPH'], explanation: 'From the light reactions.' }],
  };

  it('treats a near miss as "almost" until the person counts it', async () => {
    const user = userEvent.setup();
    render(<Quiz set={typedSet} />);
    await user.type(screen.getByLabelText('Your answer'), 'NADH{Enter}');
    expect(screen.getByText(/Almost. The expected answer is "NADPH"/)).toBeInTheDocument();
    expect(screen.getByText('0 right')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /It was a typo/ }));
    expect(screen.getByText('Counted as right.')).toBeInTheDocument();
    expect(screen.getByText('1 right')).toBeInTheDocument();
  });

  it('resumes on the same question after a remount', async () => {
    const user = userEvent.setup();
    const twoQuestions = { ...quizSet, id: 's_resume' };
    const { unmount } = render(<Quiz set={twoQuestions} />);
    await user.click(screen.getByRole('button', { name: /Mitochondria/ }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    unmount();
    render(<Quiz set={twoQuestions} />);
    expect(screen.getByText(/Picked up where you left off/)).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  });
});
