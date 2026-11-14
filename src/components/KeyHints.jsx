/** Keyboard shortcut reminders. Hidden on touch screens via CSS. */
export function KeyHints({ hints }) {
  return (
    <ul className="key-hints" aria-label="Keyboard shortcuts">
      {hints.map(([key, action]) => (
        <li key={key}>
          <kbd>{key}</kbd> {action}
        </li>
      ))}
    </ul>
  );
}
