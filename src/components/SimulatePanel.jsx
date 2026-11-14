const SCENARIOS = [
  ['none', 'Off: use the real answer'],
  ['slow', 'Slow to start (13 seconds)'],
  ['stall', 'Goes quiet halfway through'],
  ['truncated', 'Cut off halfway through'],
  ['midstream_error', 'Connection drops halfway through'],
  ['malformed', 'Broken JSON the first time'],
  ['not_json', 'Plain text instead of JSON'],
  ['prose', 'JSON wrapped in chatty text'],
  ['wrong_shape', 'Renamed fields and some bad items'],
  ['empty', 'An empty list'],
  ['insufficient', 'Says the notes are too thin'],
  ['http_500', 'Provider error (HTTP 500)'],
  ['rate_limit', 'Rate limited (HTTP 429)'],
];

/** Development-only: make the next answer misbehave on purpose. */
export function SimulatePanel({ value, onChange }) {
  return (
    <details className="simulate" open={value !== 'none' || undefined}>
      <summary>Test failure handling</summary>
      <label className="simulate__field">
        <span>Make the next answer</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {SCENARIOS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="simulate__hint">
        Simulated answers come from the built-in stand-in model, not your provider. This panel is hidden when the
        server runs with ALLOW_SIMULATE=false.
      </p>
    </details>
  );
}
