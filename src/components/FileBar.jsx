import { useId } from 'react';

const UNIT = { page: ['page', 'pages'], slide: ['slide', 'slides'] };

/** What happened to the uploaded file, and which pages or slides are in the notes box. */
export function FileBar({ upload, limit, textLength }) {
  const fromId = useId();
  const toId = useId();

  if (upload.status === 'reading') {
    const { progress } = upload;
    return (
      <div className="file-bar" role="status">
        <p className="file-bar__line">
          <span className="spinner" aria-hidden="true" />
          Reading <strong>{upload.name}</strong>
          {progress && progress.total > 1 ? `, page ${progress.done} of ${progress.total}` : ''}…
        </p>
        <button type="button" className="button button--small" onClick={upload.remove}>
          Cancel
        </button>
      </div>
    );
  }

  if (upload.status === 'error') {
    return (
      <div className="file-bar file-bar--error" role="alert">
        <p className="file-bar__line">
          <strong>{upload.name}:</strong> {upload.message}
        </p>
        <button type="button" className="button button--small" onClick={upload.remove}>
          Dismiss
        </button>
      </div>
    );
  }

  if (upload.status !== 'ready') return null;

  const [one, many] = UNIT[upload.unit] ?? [];
  const count = upload.parts.length;
  const ranged = Boolean(one) && count > 1;
  const everything = !ranged || (upload.from === 1 && upload.to === count);
  const tooLong = textLength > limit;

  return (
    <div className="file-bar" role="status">
      <div className="file-bar__top">
        <p className="file-bar__line">
          <FileIcon />
          <strong className="file-bar__name">{upload.name}</strong>
          {ranged && (
            <span className="file-bar__meta">
              {count} {count === 1 ? one : many}
            </span>
          )}
        </p>
        <button type="button" className="button button--small" onClick={upload.remove}>
          Remove
        </button>
      </div>

      {ranged && (
        <div className="file-bar__range">
          <label htmlFor={fromId}>Use {many} from</label>
          <select id={fromId} value={upload.from} onChange={(e) => upload.chooseRange(Number(e.target.value), upload.to)}>
            {upload.parts.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <label htmlFor={toId}>to</label>
          <select id={toId} value={upload.to} onChange={(e) => upload.chooseRange(upload.from, Number(e.target.value))}>
            {upload.parts.map((_, i) => (
              <option key={i} value={i + 1} disabled={i + 1 < upload.from}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="file-bar__note">
        {tooLong
          ? ranged
            ? `That's more than one set can use (${limit.toLocaleString()} characters). Choose fewer ${many}.`
            : `That's more than one set can use (${limit.toLocaleString()} characters). Trim the notes below to the part you want.`
          : everything
            ? 'All of its text is in the notes box, where you can check or trim it.'
            : `The text from ${many} ${upload.from} to ${upload.to} is in the notes box. The rest doesn't fit in one set, so make another set for it.`}
        {upload.truncated && ' Only the first 500 pages were read.'}
        {upload.previousText?.trim() && ' Remove the file to get your earlier notes back.'}
      </p>
    </div>
  );
}

function FileIcon() {
  return (
    <svg className="file-bar__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
