import { useId } from 'react';

/** A radio group styled as a segmented control, so it works with arrow keys for free. */
export function SegmentedControl({ label, options, value, onChange }) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="segmented__legend">{label}</legend>
      <div className="segmented__track">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
