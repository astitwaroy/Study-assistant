// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { StudyGuide } from '../src/components/StudyGuide.jsx';
import { normalizeGuide } from '../src/lib/schema.js';

beforeEach(() => localStorage.clear());

const guide = normalizeGuide([
  { type: 'checklist', title: 'Key points', items: ['Light becomes chemical energy', 'It happens in chloroplasts'] },
  { type: 'chart', title: 'Molecules', unit: 'molecules', data: [{ label: 'CO2', value: 6 }, { label: 'Glucose', value: 1 }] },
  { type: 'timeline', title: 'Steps', events: [{ when: 'Step 1', what: 'Absorb light' }, { when: 'Step 2', what: 'Split water' }] },
]).blocks;
const set = { id: 's_guide', guide };

describe('StudyGuide', () => {
  it('renders each block type', () => {
    render(<StudyGuide set={set} />);
    expect(screen.getByRole('heading', { name: 'Key points' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Molecules, in molecules' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Glucose: 1' })).toBeInTheDocument();
    expect(screen.getByText('Split water')).toBeInTheDocument();
  });

  it('saves checklist ticks', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StudyGuide set={set} />);
    await user.click(screen.getByLabelText('It happens in chloroplasts'));
    expect(screen.getByText('1 of 2 ticked')).toBeInTheDocument();
    unmount();
    render(<StudyGuide set={set} />);
    expect(screen.getByLabelText('It happens in chloroplasts')).toBeChecked();
  });

  it('offers the chart as a table', async () => {
    const user = userEvent.setup();
    render(<StudyGuide set={set} />);
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByRole('table')).toHaveTextContent('Glucose1');
    expect(screen.getByRole('columnheader', { name: 'Value (molecules)' })).toBeInTheDocument();
  });
});
