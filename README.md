# Zapisy na larpy (LARP sign-on)

The live sign-on form for **Krak-ON 2026**, served at
[zapisy.krak-on.info](https://zapisy.krak-on.info). Built from the open-source
[**larpsign-frontend**](https://github.com/Gandi24/larpsign-frontend) template —
running your own event's sign-on form starts there, not here.

A static, **Polish-language** sign-up form that guides players to the larps they'll
enjoy — even if they never read the programme. The flow:

1. **Kto się zapisuje** — name, contact, birthdate (18+ check), and character
   preferences.
2. **Preferencje** — rate ~32 theme tags on a −2…+2 scale (Nie znoszę → Uwielbiam).
3. **Triggery** — tick the ones that affect you (yes/no), organized into ~11
   collapsible categories (77 triggers total — too many to show as one flat list).
4. **Sloty** — in each of the 4 timeslots, the larps are auto-ranked by a computed
   **dopasowanie %** (from your ratings) and show a **bold trigger list** (yours
   flagged in red) plus a 🌐 badge on any non-Polish larp. Click up to 4 per
   slot, in priority order, and choose a **ticket tier** for each.
5. **Afterparty** and **zgody** (consents) — optional afterparty interest, plus
   the required/optional GDPR consents.

The whole form autosaves to your browser's local storage as you go (a small
"Zachowano dane" badge, top-right, confirms it) — close the tab by accident
and reopen the page later, and your answers are still there. Nothing is sent
anywhere until you actually submit.

This repo is the **frontend only** — 100% static, hosted on **GitHub Pages**.
Submissions are stored in a **private GitHub repo** via a small **Google Apps
Script Web App**, which lives in a separate repo:
[**zapisy-krak-on-backend**](https://github.com/Gandi24/zapisy-krak-on-backend). Setting
the whole thing up — both repos — takes **no terminal, no CLI, and no new
unfamiliar platform**: everything is clicking through GitHub's and Google's
own web UIs, and both are free at festival scale. It is **GDPR-aware**:
explicit opt-in consent, a privacy notice (controller, purpose, storage),
and an erasure contact.

```
zapisy-krak-on-frontend (this repo, GitHub Pages)   zapisy-krak-on-backend repo          Private GitHub repo
┌─────────────────────────────┐               ┌────────────────────┐        ┌───────────────────┐
│ index.html (shell + consent)│               │ Code.gs             │        │ submissions/*.json │
│ config.js  (public config)  │──POST text/──▶│ (deployed as an     │──PUT──▶│ (audit trail via   │
│ larps.json (content/data)   │  plain (JSON  │  Apps Script Web    │ commit │  git history)      │
│ app.js / submit-outcome.js  │  string body) │  App; holds token)  │        └───────────────────┘
│ styles.css                  │               └─────────────────────┘
└─────────────────────────────┘
```

## Why not commit straight from the browser?

A GitHub write-token in client-side JS is readable by anyone who visits the page,
and GitHub auto-revokes tokens it finds in repos. Apps Script keeps the token
server-side, in a Script Property, never in code. The browser only ever talks to
the Apps Script Web App — see
[zapisy-krak-on-backend](https://github.com/Gandi24/zapisy-krak-on-backend) for that side.

## Files

| File                        | What it is                                              |
|-----------------------------|--------------------------------------------------------|
| `index.html`                | Page shell (Polish) + consent gate                     |
| `styles.css`                | Styling                                                |
| `assets/krakon-logo.svg`    | Krak-ON's own logo (white), shown in the top masthead — swap for your event's own mark if forking this template |
| `larps.json`                | **Edit this** — preference tags, triggers, character preferences, ticket tiers, and the 4 timeslots with their larps |
| `config.js`                 | **Edit this** — event name, organiser, rules link, endpoint URL, shared secret |
| `app.js`                    | Form engine (ratings, triggers, slot matching, submit/download) |
| `submit-outcome.js`         | Pure "what does this response mean to the player" logic, shared with `tests/` |
| `tests/`                    | Node tests for `submit-outcome.js` (`npm test`) — nothing else in this repo is tested |

The Apps Script backend (`Code.gs`) and its own tests live in the separate
[zapisy-krak-on-backend](https://github.com/Gandi24/zapisy-krak-on-backend) repo, not here.

## 1. Try it locally (no backend)

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

With `submitEndpoint` empty in `config.js`, **Wyślij zgłoszenie** downloads the
answers as a `.json` file instead of sending them — handy for testing.

## 2. Deploy the frontend to GitHub Pages

1. Fork this repo (or use it as a template) — e.g. into `<you>/zapisy-krak-on-frontend`.
2. Repo → **Settings → Pages** → Source: `main` / root → Save.
3. Your form is at `https://<you>.github.io/zapisy-krak-on-frontend/`.

> Note: `config.js` and `larps.json` are public — that's fine for the event
> data and settings, but see the caveat on `submitSecret` in step 3: it's a
> *deterrent*, not a real secret, precisely because this file is public.

`config.js`'s `submissionsOpen` (default `true`) gates the submit action
without hiding the form — set it to `false` and set `submissionsOpenAt` to a
short date string (e.g. `"1 października"`) to let people browse and fill
the form ahead of time while blocking the actual send, with both the reason
and the date shown to them.

## 3. Deploy the submission backend

The backend is a separate repo, deployed separately:
[**zapisy-krak-on-backend**](https://github.com/Gandi24/zapisy-krak-on-backend). Fork it
and follow its README — no terminal needed there either, same "click through
web UIs" story, about five minutes. It ends with a Web App URL and a shared
secret you made up.

Once you have both, paste them into **this** repo's `config.js` →
`submitEndpoint` and `submitSecret` (must match `zapisy-krak-on-backend`'s
`SUBMIT_SECRET` exactly), then commit + push so Pages redeploys. Submissions
will then land as files under `submissions/` in the private repo you set up
while following zapisy-krak-on-backend's instructions.

`submitSecret` is **not real security** — `config.js` is a public file, so
anyone can read it. It only deters casual/automated abuse of the endpoint;
see zapisy-krak-on-backend's README ("Shared secret") for exactly what it does and
doesn't protect against, and why that's still worth doing for a short-lived
festival form.

## Editing the data — `larps.json`

Everything content-related lives here; no code changes needed.

- `preferenceTags` — `[{ id, label }]`. Each becomes one −2…+2 rating row. The `id`
  is what larps reference in their `tags`.
- `triggerGroups` — `[{ id, label, triggers: [string] }]`. Each group becomes
  one collapsible category in the triggers step; each string inside it
  becomes one yes/no checkbox. Larps reference triggers by the plain string
  (no group indirection) in their own `triggers` array — a trigger only
  needs to exist in *some* group's list to be usable by a larp.
- `characterPreferences` — `[string]`. Each becomes one yes/no checkbox
  ("what characters do you want to play") — informational for casting, not
  used in matching.
- `ticketTiers` — `[{ id, label, price }]`. Each becomes one option in the
  per-slot-pick ticket dropdown. `price` is a display string only — this
  form has no payment processing.
- `timeslots` — `[{ id, name, time, larps: [...] }]`. Each larp has
  `name`, `players`, `tags` (ids from `preferenceTags`), `triggers`
  (plain strings, matching one from some group in `triggerGroups`), an
  optional `language` (a free-form string — omit entirely for a
  Polish-language larp, don't set it to a "Polski" value), and an optional
  `time` (same format as the slot's own `time`, for the rare larp whose
  actual hours differ from the rest of the slot). Both, when set, show as a
  badge (`🌐`/`🕐`) next to the larp's name everywhere it appears — purely
  informational, not collected from the player.

**How dopasowanie % is computed:** the average of the player's ratings for that
larp's `tags`, rescaled from [−2, +2] to [0, 100]. No ratings yet → 50% (neutral).
Larps in a slot are sorted by this, so the best matches float to the top.

> `preferenceTags`/`triggerGroups` hold Krak-ON's real 2026 programme data,
> unified from the organiser's own per-larp tags/triggers (not guessed from
> titles). See `.scratch/tag-trigger-unification/` if you're
> doing this unification pass again for a different event's programme.

## What a submission contains

```jsonc
{
  "meta": { "event", "submittedAt", "schemaVersion": 8 },
  "identity": { "firstName", "lastName", "preferredAddress", "email", "phone", "birthdate" },
  "characterPreferences": ["Kobiece", ...],
  "wantsNpc": false,
  "goldenTicket": { "priorities": ["<larp name>", ...] },   // 0-3, temporary feature
  "afterparty": { "friday": true, "saturday": false },      // plain optional booleans
  "consent": {
    "rodoNoticeRead": true, "strefazajecInformed": true, "rulesRead": true,
    "photoVideo": { "choice": "tak", "other": "" },
    "marketingEmail": { "choice": "inne", "other": "nie" },
    "timestamp"
  },
  "preferences": { "scifi": 2, "romans": -2, ... },   // tag id -> rating
  "triggers": ["Izolacja i osamotnienie", ...],        // the player's triggers
  "choices": {                                          // per timeslot, ordered
    "nd_rano": [
      { "priority": 1, "name", "ticketTier": "wsparcia", "likeliness": 83, "triggerConflicts": [...] }
    ]
  }
}
```

`triggerConflicts` lists the player's triggers that the chosen larp contains — a
flag for the casting crew.

## GDPR notes for the organiser

- **Consent** is recorded with each submission — three required
  confirmations (`consent.rodoNoticeRead`, `consent.strefazajecInformed`,
  `consent.rulesRead`) plus a shared timestamp. The form reproduces Centrum
  Kultury Podgórza's own official RODO notice and strefazajec.pl disclosure
  verbatim rather than a custom summary — see `DESIGN.md`'s "GDPR / consent" section.
- **Retention:** the reproduced official RODO notice states concrete periods
  (5 years for accounting/tax records, 3 months for camera-monitoring
  footage, until withdrawal for consent-based processing — see `DESIGN.md`'s "GDPR / consent" section).
  Deleting the file from the private repo removes the data; there's no
  automated expiry job enforcing those periods.
- **Erasure requests** come to `controller.email` (shown in the footer) as
  this project's own practical contact; find the person's file and delete it
  (and any local copies/exports). The reproduced official notice also names
  Centrum Kultury Podgórza's own contact channels for RODO purposes generally.
- **Minimise:** identity fields are limited to what's needed for casting,
  emergency contact, and 18+ verification (name, address form, e-mail, phone,
  birthdate), plus preferences.
- **Photo/video consent** (`consent.photoVideo`) and **marketing-email
  consent** (`consent.marketingEmail`) are each a required *question*
  (`{ choice: "tak"|"inne", other }`), not a required *agreement* — a player
  can decline (answer "Inne" with e.g. "nie") and still register. Only
  use/publish a person's photos, or email them event info, if
  `choice === "tak"`, and honor a later withdrawal independently (don't touch
  their event registration for it).
- Keep the submissions repo **private** and limit who has access.

## Running the tests

Node's built-in test runner, no dependencies to install:

```bash
npm test
```

This covers `interpretSubmitOutcome()` in `submit-outcome.js` — the client
side of the submit contract. The server side (`buildSubmissionRequest()`) has
its own tests in the [zapisy-krak-on-backend](https://github.com/Gandi24/zapisy-krak-on-backend)
repo. Everything else in this project is still verified manually (open it in
a browser), matching how the rest of the codebase works. CI
(`.github/workflows/test.yml`) runs `npm test` on every push and PR.
