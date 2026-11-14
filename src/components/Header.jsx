export function Header({ theme, onToggleTheme, onHome }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <a
        className="wordmark"
        href="#/"
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
      >
        <svg className="wordmark__mark" viewBox="0 0 32 22" aria-hidden="true">
          <rect x="1" y="1" width="30" height="20" rx="2" />
          <line className="wordmark__red" x1="3" y1="6.5" x2="29" y2="6.5" />
          <line className="wordmark__blue" x1="3" y1="11.5" x2="29" y2="11.5" />
          <line className="wordmark__blue" x1="3" y1="16" x2="29" y2="16" />
        </svg>
        Recall
      </a>
      <button type="button" className="button button--quiet" onClick={onToggleTheme} aria-label={`Switch to ${next} mode`}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        <span className="topbar__theme-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
      </button>
    </header>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}
