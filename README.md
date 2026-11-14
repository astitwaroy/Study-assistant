# Recall

A study assistant that turns your notes into flashcards and quizzes.

Paste in your notes, or just type a topic. Recall asks an LLM to write flashcards or a quiz from it. You flip through the cards, take the quiz, and keep retesting the ones you got wrong until there's nothing left to retest.

It's not a chatbot, and that's on purpose. The model hands back JSON. The app checks every item on its own, and React builds the flip cards, the multiple-choice, true/false and fill-in-the-blank questions, the study guide (a checklist, a chart, a timeline), the scores and the retest rounds from that data. If you read through the code, you'll notice most of it isn't about the happy path. It's about what to do when the model's answer comes back broken, half finished, slow, or not at all.

<!-- Add a screenshot or GIF here, e.g. docs/demo.gif -->

## Getting it running

You'll need **Node.js 22.12 or newer**. Check with `node -v`.

```bash
npm install
npm start
```

Then open http://localhost:5173.

`npm start` runs two things at once: the Vite dev server for the React app, and a small Express server on port 8787 that talks to the model. Vite proxies `/api` through to Express, so your API key stays on the server and never reaches the browser.

You don't need a key to try it. Without a `.env` file, Recall runs in **demo mode** with a built-in stand-in model, so the two commands above are all it takes. When you want a real model:

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

To use a different model, set `LLM_MODEL`. Some models reject JSON mode. When that happens, the server retries without it on its own, so you don't have to work out which ones do.

The other scripts:

```bash
npm test            # 130 unit, hook and component tests (Vitest)
npm run lint        # ESLint, including the React hooks rules
npm run build       # production build into dist/
npm run serve       # serve dist/ and the API from one Express process (port 8787)
```

### Deploying

**Live demo:** _(add your Render URL here)_

The repo comes with a Render Blueprint (`render.yaml`), so the built app and the API run together as one free web service:

1. In the Render dashboard, choose **New → Blueprint** and pick this repo.
2. When it asks for `LLM_API_KEY`, paste your Gemini key. It's stored in Render and never goes into Git.
3. Deploy. Render builds with `npm ci --include=dev && npm run build`, starts `npm run serve`, and keeps an eye on `/api/health`.

A few things worth knowing:

- The free plan goes to sleep when nobody's using it, so the first visit after a quiet spell takes about a minute to wake up.
- Use a Gemini key from a project **without billing turned on**. That way a public demo can only use up the free quota, never cost money. The server also limits requests per visitor (20 a minute) and overall (60 a minute).
- The blueprint leaves the **Test failure handling** panel switched on (`ALLOW_SIMULATE=true`) so reviewers can trigger each failure themselves. It only drives the built-in mock, never the real model. Remove that variable to hide it.

Any other Node host works the same way: build with `npm run build`, start with `npm run serve`, and set `LLM_PROVIDER`, `LLM_API_KEY` and, behind a proxy, `TRUST_PROXY`.

## Using it

1. Paste your notes, pick one of the samples, or type a topic.
2. Choose **Flashcards** or **Quiz**, pick how many you want, then hit **Make flashcards** (or Ctrl/Cmd + Enter). Items show up one by one as they stream in.
3. **Flashcards:** click the card or press Space to flip it. Mark each one **Still learning** (1) or **Got it** (2). On a phone you can swipe instead: right for got it, left for still learning. When you reach the end, you can go back through just the ones you're still learning.
4. **Quiz:** answer by clicking, with the number keys, or with A to D (T/F for true/false). Fill-in-the-blank questions you type. After each answer you see the correct option and the model's explanation. At the end, **Retake the ones you missed** gives you another round. The options get reshuffled every time, so you end up learning the answer and not where it sits on the screen.
5. **Study guide** is the second tab. It has the key points as a checklist you can tick off and, when the material calls for it, a chart of the numbers in your notes and a timeline of events or steps.
6. **Change this set** lets you send a follow-up like "add 3 harder questions on the Calvin cycle". Instead of starting over, the model sends back edits to the set you already have, and you can undo them.
7. Everything saves as you go: your sets, which cards you know, where you are in a deck or quiz, and your checklist ticks. Open a set from **Your sets** and it picks up where you left off. **Download** saves a set as a file, and **Import a set** loads it back, in this browser or another one.

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
                    │                   ├─ items: flashcard | mcq | true_false | fill_blank
                    │                   └─ guide: checklist | chart | timeline
                    └─ if that fails: salvage complete items (and guide blocks) from the raw text
                ▼
          StudyView ─┬─ FlashcardDeck | Quiz      (a renderer per item type)
                     ├─ StudyGuide                (a renderer per block type)
                     └─ RefinePanel               (edits as ops)
```

The server is thin on purpose. It holds the key, validates the request, enforces timeouts and a rate limit, and passes the model's raw text straight through. **All the parsing and validation happen in the client**, in `src/lib/`. That split is what lets the UI show items while they're still streaming, and decide for itself how to degrade when something goes wrong.

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
  lib/quiz.js, deck.js   Pure reducers for quiz rounds and flashcard passes, typed-answer grading,
                         and checks on saved sessions
  hooks/useGeneration.js Request lifecycle, retries, stale-response protection
  hooks/usePersistentState.js  localStorage state and reducers that survive a reload
  hooks/useSavedSets.js  Saved sets, progress summaries, download and import
  hooks/useSwipe.js      Swipe to grade on touch screens
  components/        Views and UI pieces
test/                Vitest suites for all of the above
```

## When the model gets it wrong

LLMs don't follow a format perfectly every time. Here's what can go wrong, what you'll actually see when it does, and where the code that deals with it lives.

| What goes wrong | What you see | Where |
| --- | --- | --- |
| JSON wrapped in prose or code fences | Nothing. It just parses. | `parse.js` `parseModelJson` |
| Trailing commas, comments | Nothing. They get repaired. | `parse.js` `repairJson` |
| Broken JSON (bad quotes, missing commas) | One automatic retry with a stricter prompt. If that fails too, an error with **Try again** and the raw answer | `useGeneration.js`, `interpret.js` |
| One bad item breaks the whole document | You keep every item that could be read, with a note about the rest | `interpret.js` `salvageSet` |
| Answer cut off (`finish_reason: length`) | You keep the complete items: "you have 7 of the 10 you asked for" | `interpret.js` |
| Plain text, no JSON | Automatic retry, then an error showing the raw text | `interpret.js` |
| Wrong field names (`term`/`definition`, `choices`, `correct_answer: "B"`, `"A) …"` prefixes, `"2"` as a string) | Accepted and normalised | `schema.js` |
| Unclear answer key (index out of range, bare number, duplicate options, two options marked correct) | That question is **dropped, never guessed**. It's listed under "See what was left out" | `schema.js` `resolveAnswer` |
| Empty or duplicate items, more than 40 items | Dropped with a reason, and capped | `schema.js` `normalizeItems` |
| Quiz items in flashcard mode | Turned into cards | `schema.js` `asFlashcard` |
| A block type Recall doesn't know (say, "video") | That block is dropped and listed. The rest of the set still works | `schema.js` `normalizeBlock` |
| Chart values that aren't numbers ("lots", "about 6") | Those bars are left out and the chart says how many. Fewer than two numbers, negatives or all zeros drop the chart. A number is never guessed | `schema.js` `toNumber`, `normalizeChart` |
| Study guide missing, broken or cut off | The flashcards and questions aren't affected. Any complete guide blocks are kept | `normalizeGuide`, `salvageSet` |
| Typed answer one letter off | "Almost". It isn't counted as right on its own, because NADH isn't NADPH. You decide whether it was a typo | `quiz.js` `gradeTyped` |
| Model says the notes aren't enough | A specific "not enough here" screen with the model's reason | `status: "insufficient"` in the prompt |
| Empty list | Its own empty state with **Try again** | `normalizeSet` |
| Slow first token | After 10 s you get "Still working…" and a **Cancel** button. The server gives up after 45 s with no tokens | `useGeneration.js`, `generate.js` |
| Stream stalls mid-answer | After 20 s of silence the server sends a `stalled` error. You can still study whatever arrived | `generate.js`, `ErrorPanel` |
| Provider down, 5xx, bad key, unknown model, 429 | A specific message for each case. Retry is only offered when it can actually help, and a 429 shows a countdown | `server/errors.js`, `src/lib/errors.js` |
| API server not running | "Can't reach the Recall server", plus a banner from the health check | `api.js`, `useServerHealth.js` |
| A newer request starts while an old one is still running | The old request is aborted, **and** if its result shows up late anyway, it's ignored | `useGeneration.js` |
| A follow-up edit finishes after the set has changed | It isn't applied, and you're told | `RefinePanel.jsx` |
| Corrupt or outdated data in localStorage | Re-checked with the same normaliser. Anything bad is skipped | `useSavedSets.js` `restoreSet` |
| A saved quiz or deck position that no longer fits, because the set was edited since | It starts fresh instead of resuming into questions that are gone | `restoreQuiz`, `restorePass` |
| An imported file that's broken, huge or not a Recall set | A specific message. Usable items are kept and the rest are counted as skipped | `useSavedSets.js` `importSet` |
| A render bug slips through anyway | An error boundary with a reload button. Your saved sets aren't touched | `ErrorBoundary.jsx` |

The answer key rule is the one worth calling out. A quiz that marks the wrong option as correct does more damage than a quiz with one fewer question, so Recall never tries to guess what the model meant.

### Stale responses

This one is easy to get wrong, so it gets its own section.

Every call to `run()` in `useGeneration` gets an id that counts up. Starting a new run aborts the previous `AbortController`. That also cancels the upstream request on the server, so you stop paying for tokens nobody will read. But an abort can lose the race against a response that has already arrived, so every callback also checks `isCurrent()` before it touches state.

To prove it, `test/useGeneration.test.jsx` uses a fake transport that ignores aborts and answers out of order, then checks that the older response gets dropped.

### Break it yourself

In development there's a **Test failure handling** panel under the form. Pick a scenario and the next answer misbehaves on purpose: slow start, stall, cut-off, dropped connection, broken JSON, plain text, a chatty wrapper, wrong field names, empty, "not enough", HTTP 500, or 429. These all come from the built-in mock, even if you've set up a real provider.

When the server runs with `npm run serve` or `ALLOW_SIMULATE=false`, the panel is hidden and the parameter is ignored. The Render blueprint switches it back on with `ALLOW_SIMULATE=true`, so the live demo has it too.

## Stretch goals

All five are in.

**Different block types.** One answer from the model can hold seven kinds of block, and each has its own renderer. The practice items are flashcards, multiple-choice, true/false and typed fill-in-the-blank questions (`QUESTION_RENDERERS` in `Quiz.jsx`). The study guide has a checklist of key points you can tick off, a bar chart of numbers from your notes, and a timeline of events or steps (`BLOCK_RENDERERS` in `StudyGuide.jsx`). The chart comes with a table view and shows each value on hover or focus. The model only adds a chart or a timeline when the material calls for one. Unknown or broken blocks get rejected in `schema.js` before React ever sees them.

**Streaming.** Each item appears the moment it's complete. A string-aware scanner walks the partial JSON and pulls out the finished items (`extractCompleteElements`). The study guide comes after the items, so the cards start streaming first.

**Refinement loop.** Follow-up instructions come back as `add`, `update` and `remove` ops. They point at short refs like `r1` and `r2` instead of internal ids. Items the edit doesn't touch keep their ids and your progress on them. Every edit can be undone, and an edit that finishes after the set has changed isn't applied.

**Save and reload sessions.** Sets, which cards you know, where you are in a deck or quiz round (typed answers included) and checklist ticks all survive a reload, so opening a set again picks up where you left off. **Download** and **Import a set** move a set between browsers as a JSON file, and an imported file goes through the same checks as model output. Links like `#/set/<id>` work, and so does the back button.

**Polish.** Dark mode that remembers your choice and doesn't flash on load. Keyboard shortcuts everywhere, including arrow keys between tabs. Swipe to grade on touch screens. A card-flip animation that respects reduced motion. Visible focus styles. A layout that works on mobile.

## Known limitations

- Demo mode isn't a real model. It has hand-written content for the photosynthesis sample and makes simple fill-in-the-blank questions from anything else. If you want to judge question quality, plug in a real provider.
- Recall checks that each question is well formed. It doesn't check that it's true. A model can still state something wrong with total confidence, and the footer says so.
- Applying an edit restarts whatever deck or quiz you're on, and edits only change the practice items. The study guide stays as it was first written.
- A typed answer has to match one of the model's accepted answers, ignoring case, punctuation and "the/a/an". A synonym the model didn't list needs the "count it" button.
- Swiping was tested with simulated touch in a headless browser, not on a real phone yet.
- The streaming preview rescans the whole response on every chunk. That's fine for the few KB a set usually takes. It wouldn't be for very long outputs.
- The rate limits live in memory, per process. Running several server instances would need a shared store.
- Saved sets live in one browser's localStorage. No accounts, no sync. Download and Import are how you move a set.
- Keyboard use has been tested. Screen reader use hasn't been tested properly yet.
- JSON mode and streaming support vary by provider and model. The server falls back when JSON mode is rejected, but a model that ignores the format altogether ends up leaning on the retry and salvage paths.

## What I'd do next

- Use JSON-schema structured outputs on providers that support them together with streaming, and keep the current path as the fallback.
- Replace "still learning / got it" with real spaced repetition, something like SM-2.
- Let follow-up edits change the study guide too.
- Export to Anki or CSV.
- Playwright end-to-end tests for the failure scenarios, running in CI.
- PDF and image input.

## How I used AI

<!--
  Be specific and honest here; it counts in your favour.
  Replace the placeholder below with what you actually did.
-->

I took help from Claude as a coding assistant, and I want to be upfront about how much it did. It wrote some of the first implementation from the assignment brief: the React components and styles, the test suites. It also checked the provider documentation for Gemini and Groq.


## Time spent

3.5 hours
