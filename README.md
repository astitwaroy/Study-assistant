# Recall: a study assistant

Paste your notes (or name a topic) and Recall asks an LLM for flashcards or a quiz. You flip through the cards, take the quiz, and keep retesting what you got wrong until nothing's left.

It isn't a chatbot. The model returns JSON, the app validates it item by item, and React renders flip cards, multiple-choice and true/false questions, scores and retest rounds from that data. Most of the code is about what happens when the model's answer is broken, partial, slow, or missing.

<!-- Add a screenshot or GIF here, e.g. docs/demo.gif -->

## Setup

Requires **Node.js 22.12 or newer** (`node -v`).

```bash
npm install
npm start
```

Then open http://localhost:5173. `npm start` runs two processes: the Vite dev server for the React app and a small Express server on port 8787 that calls the model. Vite proxies `/api` to Express, so the browser never sees an API key.

**With no `.env` file, the app runs in demo mode** with a built-in stand-in model, so the commands above work with no key. To use a real model:

```bash
cp .env.example .env
# set LLM_PROVIDER and LLM_API_KEY, then restart npm start
```

| Provider | `LLM_PROVIDER` | Key | Default model |
| --- | --- | --- | --- |
| Google Gemini (free tier) | `gemini` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini-flash-latest` |
| Groq (free tier) | `groq` | [console.groq.com/keys](https://console.groq.com/keys) | `openai/gpt-oss-20b` |
| OpenRouter | `openrouter` | [openrouter.ai/keys](https://openrouter.ai/keys) | set `LLM_MODEL` yourself |
| Ollama (local, free) | `ollama` | none | `llama3.2` (run `ollama pull llama3.2` first) |
| Any OpenAI-compatible API | `custom` | as needed | set `LLM_BASE_URL` and `LLM_MODEL` |

Override the model with `LLM_MODEL`. If a model rejects JSON mode, the server retries without it automatically.

Other scripts:

```bash
npm test            # 100 unit, hook and component tests (Vitest)
npm run lint        # ESLint, including the React hooks rules
npm run build       # production build into dist/
npm run serve       # serve dist/ and the API from one Express process (port 8787)
```

### Deploying

Any Node host works as one web service: build with `npm install && npm run build`, start with `npm run serve`, and set `LLM_PROVIDER` and `LLM_API_KEY` as environment variables. `npm run serve` turns off the failure simulator.

## Using it

1. Paste notes, pick a sample, or type a topic.
2. Choose **Flashcards** or **Quiz** and how many, then **Make flashcards** (or Ctrl/Cmd + Enter). Items appear as they stream in.
3. **Flashcards:** click the card (or press Space) to flip it. Mark it **Still learning** (1) or **Got it** (2). At the end, review only the ones you're still learning.
4. **Quiz:** answer with a click, number keys or A–D (T/F for true/false). Each answer shows the correct option and the model's explanation. At the end, **Retake the ones you missed**. Options are reshuffled on retakes so you learn the answer, not its position.
5. **Change this set** sends a follow-up instruction ("add 3 harder questions on the Calvin cycle"). The model returns edits to the existing set instead of a new one, and you can undo them.
6. Sets and flashcard progress are saved in your browser under **Your sets**.

## How it works

```
Browser                                              Server (Express)                 Provider
───────                                              ────────────────                 ────────
NotesForm ─▶ useGeneration.run() ─▶ POST /api/generate ─▶ validate request
                │                                    build prompt (server/prompt.js)
                │                                    streamChat() ────────────────────▶ /chat/completions
                │   ◀── NDJSON: start, delta…, done/error ◀── SSE deltas ◀──────────── (stream: true)
                ▼
     raw text ─▶ previewSet()   (while streaming: complete items only)
              ─▶ interpretSet() (at the end)
                    parseModelJson ─▶ normalizeSet ─▶ ok | insufficient | empty | invalid
                    └─ if that fails: salvage complete items from the raw text
                ▼
          StudyView ─▶ FlashcardDeck | Quiz ─▶ RefinePanel (edits as ops)
```

The server is deliberately thin: it holds the key, validates the request, enforces timeouts and a rate limit, and forwards the model's raw text. **Parsing and validation happen in the client** (`src/lib/`), so the UI can render items while they stream and choose how to degrade when something goes wrong.

```
server/
  index.js        Express app, error handler, static serving for production
  generate.js     POST /api/generate: NDJSON streaming, timeouts, client-abort handling
  llm.js          OpenAI-compatible streaming client, JSON-mode fallback, error mapping
  prompt.js       Prompts and the JSON contract (mirrors src/lib/schema.js)
  mock.js         Demo model plus the deliberate failure scenarios
src/
  lib/parse.js       Extract JSON from model text; pull complete items out of partial JSON
  lib/schema.js      Validate and normalise every item; the model-to-UI contract
  lib/interpret.js   Pipeline: parse → normalise → salvage
  lib/refine.js      Apply follow-up edits (add/update/remove ops)
  lib/quiz.js, deck.js   Pure reducers for quiz rounds and flashcard passes
  hooks/useGeneration.js Request lifecycle, retries, stale-response protection
  components/        Views and UI pieces
test/                Vitest suites for all of the above
```

## Handling bad AI output

| What goes wrong | What the person sees | Where |
| --- | --- | --- |
| JSON wrapped in prose or code fences | Nothing; it parses | `parse.js` `parseModelJson` |
| Trailing commas, comments | Nothing; repaired | `parse.js` `repairJson` |
| Broken JSON (bad quotes, missing commas) | One automatic retry with a stricter prompt; then an error with **Try again** and the raw answer | `useGeneration.js`, `interpret.js` |
| One bad item breaks the whole document | The readable items are kept, with a note | `interpret.js` `salvageSet` |
| Answer cut off (`finish_reason: length`) | Complete items are kept: "you have 7 of the 10 you asked for" | `interpret.js` |
| Plain text, no JSON | Automatic retry, then an error with the raw text | `interpret.js` |
| Wrong field names (`term`/`definition`, `choices`, `correct_answer: "B"`, `"A) …"` prefixes, `"2"` as a string) | Accepted and normalised | `schema.js` |
| Unclear answer key (index out of range, bare number, duplicate options, two options marked correct) | That question is **dropped, never guessed**, and listed under "See what was left out" | `schema.js` `resolveAnswer` |
| Empty or duplicate items, over 40 items | Dropped with a reason; capped | `schema.js` `normalizeItems` |
| Quiz items in flashcard mode | Converted to cards | `schema.js` `asFlashcard` |
| Model says the notes aren't enough | A specific "not enough here" state with the model's reason | `status: "insufficient"` in the prompt |
| Empty list | Its own empty state with **Try again** | `normalizeSet` |
| Slow first token | After 10 s, "Still working…" with **Cancel**; server gives up after 45 s with no tokens | `useGeneration.js`, `generate.js` |
| Stream stalls mid-answer | Server idle timeout (20 s) sends a `stalled` error; the items that arrived can still be studied | `generate.js`, `ErrorPanel` |
| Provider down, 5xx, bad key, unknown model, 429 | Specific message per case; retry only when it can help; 429 shows a countdown | `server/errors.js`, `src/lib/errors.js` |
| API server not running | "Can't reach the Recall server" plus a banner from the health check | `api.js`, `useServerHealth.js` |
| A newer request starts while an old one is in flight | The old request is aborted **and** its late result is ignored | `useGeneration.js` |
| A follow-up edit finishes after the set changed | Not applied; the person is told | `RefinePanel.jsx` |
| Corrupt or old data in localStorage | Re-validated with the same normaliser and skipped | `useSavedSets.js` `restoreSet` |
| A render bug anyway | Error boundary with a reload button; saved sets are untouched | `ErrorBoundary.jsx` |

### Stale responses

Every `run()` in `useGeneration` gets an incrementing id. Starting a new run aborts the previous `AbortController` (which also cancels the upstream provider request on the server, so tokens stop being billed). Because an abort can lose a race with a response that has already arrived, every callback also checks `isCurrent()` before touching state. `test/useGeneration.test.jsx` has a fake transport that ignores aborts and answers out of order to prove the older response is dropped.

### Trying the failures yourself

In development, **Test failure handling** (below the form) makes the next answer misbehave: slow start, stall, cut-off, dropped connection, broken JSON, plain text, chatty wrapper, wrong field names, empty, "not enough", HTTP 500, or 429. These come from the built-in mock even when a real provider is configured. The panel is hidden and the parameter ignored when the server runs with `npm run serve` or `ALLOW_SIMULATE=false`.

## Stretch goals

- **Different block types:** quizzes mix multiple-choice and true/false items, each with its own renderer (`QUESTION_RENDERERS` in `Quiz.jsx`). Unknown types are rejected in `schema.js` before they reach React.
- **Streaming:** items appear as soon as each one is complete, using a string-aware scanner over the partial JSON (`extractCompleteElements`).
- **Refinement loop:** follow-up instructions return `add`/`update`/`remove` ops against short refs (`r1`, `r2`) rather than internal ids. Untouched items keep their ids and progress. Edits can be undone.
- **Save and reload:** sets and flashcard progress persist in localStorage; links like `#/set/<id>` work with the back button.
- **Polish:** dark mode (remembered, no flash on load), keyboard shortcuts, card-flip animation that respects reduced motion, visible focus, mobile layout.

## Known limitations

- Demo mode is not a model. It has hand-written content for the photosynthesis sample and builds simple fill-in-the-blank questions from other notes. Use a real provider to judge question quality.
- Recall checks that each question is well formed, not that it's true. A model can still state a wrong fact confidently; the footer says so.
- Quiz progress inside a round isn't saved (flashcard progress is). Applying an edit restarts the current deck or quiz.
- The streaming preview re-scans the whole response on every chunk. That's fine for the few KB a set takes, not for very long outputs.
- The rate limit is in memory, per process. Several server instances would need a shared store.
- Saved sets live in one browser's localStorage. There are no accounts or sync.
- Keyboard use was tested; screen reader use was not tested thoroughly.
- JSON mode and streaming support differ by provider and model. The server falls back when JSON mode is rejected, but a model that ignores the format will lean on the retry and salvage paths.

## What I'd do next

- Use JSON-schema structured outputs on providers that support them with streaming, and keep the current path as a fallback.
- Spaced repetition (for example SM-2) instead of "still learning / got it".
- Export to Anki or CSV.
- Browser end-to-end tests (Playwright) for the failure scenarios, run in CI.
- PDF and image input.

## AI usage

<!--
  Be specific and honest here; it counts in your favour.
  Replace or extend this with what you actually did yourself.
-->

I built this with Claude (Anthropic) as a coding assistant. Claude generated most of the first implementation from the assignment brief: the Express proxy, the parsing and validation pipeline, the React components and styles, the test suites, and the first draft of this README. It also checked the provider documentation for Gemini and Groq.

What I did myself: _(fill in: what you reviewed line by line, what you changed or rewrote, which decisions you made, what you tested with a real API key)_.

## Time spent

_(fill in your actual hours)_
