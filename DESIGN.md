# Design Document — LARP Sign-On Form

A Polish-language sign-up form for a LARP (live-action role-play) festival.
A player who has never read the programme rates what themes they enjoy,
flags their personal triggers, and the form ranks every larp in every
timeslot by computed fit — so they can pick their top choices per slot
without prior knowledge of the games.

This document covers both the system's architecture and reasoning (the
*why*) and its concrete contracts — data model, algorithm, validation
rules, payload shape (the *what*). See the Deployment status section for
what's actually live right now.

**This is one of two repos.** This one (`zapisy-krak-on-frontend`) is the static
site. The submission backend lives in a separate repo,
[`zapisy-krak-on-backend`](https://github.com/Gandi24/zapisy-krak-on-backend), so it can
be forked/versioned independently — this document covers the whole system's
architecture (both repos), since the two are meaningless without each other,
but code changes to the backend happen over there, not here.

## 1. Architecture overview

```
zapisy-krak-on-frontend (GitHub Pages, static)      zapisy-krak-on-backend repo      Private GitHub repo
┌─────────────────────────────┐               ┌────────────────────┐    ┌───────────────────┐
│ index.html (shell + consent)│               │ Code.gs             │    │ submissions/*.json │
│ config.js  (public config)  │──POST text/──▶│ holds GH_TOKEN      │─PUT▶│ (audit trail via   │
│ larps.json (content/data)   │  plain (JSON  │ (Script Property)   │commit│  git history)     │
│ app.js     (all logic)      │  string body) │ always HTTP 200,    │     └───────────────────┘
│ submit-outcome.js (pure)    │               │ ok:true/false body  │
│ styles.css                  │               └─────────────────────┘
└─────────────────────────────┘
```

Three deploy targets (two repos, three destinations), two trust boundaries:
- **Frontend** (`zapisy-krak-on-frontend`) is 100% static and public — no secrets,
  no server-side logic, hostable on GitHub Pages with zero build step.
- **Backend** (`zapisy-krak-on-backend`'s `Code.gs`) is a single Google Apps Script
  Web App whose only job is to hold a write-scoped GitHub token server-side
  and forward validated submissions as commits. It has no database, no auth
  of its own, no admin API.
- **Storage** is a third, separate private GitHub repo each organiser creates
  for themselves — not part of either codebase, just an empty repo submissions
  get committed into.

This is a two-tier system deliberately kept as thin as possible: the "database"
*is* a private git repo, and "browsing submissions" means browsing that repo
(or `git log` / GitHub's file UI). There is currently no reviewer/admin tool
beyond that — see the Known gaps section for that gap and the Extension
points table for where it will hook in.

## 2. Why a relay in between (not a direct browser→GitHub write)

A GitHub write-token embedded in client JS is readable by any visitor and
GitHub's secret-scanning auto-revokes tokens it finds published in a repo.
Apps Script is the minimal server needed to keep that token off the client
while adding as little else as possible. This is the load-bearing security
boundary of the whole system — see `README.md` "Why not commit straight from
the browser?".

Corollary: `config.js` and `larps.json` are *intentionally* public. They hold
no PII and no secrets, so they don't need the relay in front of them — only
fetched directly by the browser at load time.

**Why Apps Script instead of Cloudflare Workers** (the original choice, used
until this migration): Workers required Wrangler CLI, Node, and a Cloudflare
account — real setup friction for a non-technical organiser, and an
unfamiliar platform to sign up for and trust. Apps Script deploys entirely
through script.google.com's web UI (no terminal, ever) on a Google account
almost every organiser already has, and is free at this project's scale. The
trade-off is real, not free: Apps Script Web Apps cannot return custom HTTP
status codes (every response comes back as 200), and can't set custom CORS
response headers (forcing the `text/plain` content-type workaround in
`app.js`) — both handled explicitly in the request/response contract below,
rather than papered over.

## 3. The request/response contract (why it looks the way it does)

Two Apps Script constraints shape this contract, not preference:

- **No custom CORS headers** → the client sends `Content-Type:
  text/plain;charset=utf-8` instead of `application/json`, which avoids the
  browser's CORS preflight (`OPTIONS`) that Apps Script can't answer
  correctly. The body is still the JSON payload as a string; the server
  parses it itself. This also means there is no `ALLOWED_ORIGIN`-style
  origin lockdown available on this backend — see the Known gaps section.
- **No custom HTTP status codes** → every response is HTTP 200, so
  success/failure is carried in the body as `{ ok: true, path }` or
  `{ ok: false, error }`. `interpretSubmitOutcome()` (`submit-outcome.js`) is
  the client-side function that reads this field; `buildSubmissionRequest()`
  (`Code.gs`, in the `zapisy-krak-on-backend` repo) is the server-side function that
  produces it. Both are pure — no `fetch`/DOM on the client side, no Apps
  Script globals on the server side — which is what makes them unit-testable
  (see the Non-functional requirements section).

**Request envelope.** The client `POST`s `{ secret, submission }` as a
JSON-stringified string body, where `submission` is the payload described in
the Submission payload shape section and `secret` is `config.js`'s
`submitSecret`. Handled server-side by `doPost(e)` (`Code.gs`), `POST` only.

**Two delivery paths**, chosen by whether `config.js → submitEndpoint` is
set:
- **Set**: the envelope above is `POST`ed to the endpoint (the Apps Script
  Web App) — see the checks and responses below.
- **Empty** (local/dev): "Wyślij zgłoszenie" immediately downloads the
  payload as a `.json` file instead of posting anywhere — the documented
  no-backend testing mode (see `README.md`'s testing instructions).

"Pobierz moje odpowiedzi" (download) is always available regardless of
`submitEndpoint`, independent of submit — lets a player keep/backup their
answers or hand-deliver the file if the network path fails.

**Server-side checks, in order:**
1. Body must parse as JSON → else `{ ok: false, error: "invalid_json" }`.
2. `secret` must match the `SUBMIT_SECRET` Script Property exactly → else
   `{ ok: false, error: "unauthorized" }`. Fails **closed**: an unconfigured
   `SUBMIT_SECRET` rejects every request rather than admitting them. This
   check runs before `submission` is inspected at all, and `secret` is
   discarded afterward — it never appears in what gets committed to GitHub.
3. `submission.consent.rodoNoticeRead === true &&
   submission.consent.strefazajecInformed === true &&
   submission.consent.rulesRead === true` → else
   `{ ok: false, error: "consent_required" }`. This is the **only**
   server-side content validation of `submission`; name/preferences/choices
   are not re-checked.

This request validation and payload-shaping lives entirely in the pure
function `buildSubmissionRequest(rawBody, deps)` — given the raw body plus
injected time/randomness/base64-encoding/expected-secret, it returns either a
rejection or the exact GitHub Contents API request to send (built from
`submission` only). No Apps Script globals, so it's covered by
`zapisy-krak-on-backend`'s own `tests/build-submission-request.test.js` without a
live deployment.

**On success**: commits the payload as
`submissions/<ISO-timestamp-with-dashes>-<6-char-random>.json` to the
configured **private** GitHub repo via the Contents API, using a server-held
fine-grained PAT (`GH_TOKEN`, an Apps Script Script Property — never in
code). Content is base64-encoded with an explicit UTF-8 charset
(`Utilities.base64Encode(str, Utilities.Charset.UTF_8)`), since submissions
routinely contain Polish diacritics. Returns `{ ok: true, path }`.

**On GitHub API failure**: `{ ok: false, error: "github_write_failed", detail }`
(detail is GitHub's raw response body, not sanitized before returning to the
client), still as HTTP 200.

**Client-side handling of the response**: on `ok: false`, an unparseable
response, or a network failure, the submit button is re-enabled and an error
is shown with a suggestion to use "Pobierz moje odpowiedzi" instead. On
`ok: true`, the form is replaced with a thank-you message.

## 4. Why "commit JSON files to a private repo" instead of a real database

- Zero infrastructure to run or pay for beyond the relay (already free-tier
  scale for a single festival's submission volume).
- Git history *is* the audit log — every submission's exact content and time
  is preservable/diffable without extra tooling.
- Deletion for GDPR erasure is a single file delete + commit — matches the
  README's documented erasure process exactly.
- Access control piggybacks on GitHub repo permissions — no separate auth
  system to build or secure.

Trade-off accepted: no query/filter/dedup capability, no concurrent-write
safety beyond GitHub's own API semantics, and reading submissions means
opening files by hand (fine at festival scale — dozens to low hundreds of
entries — not fine at meetup-registration-app scale).

## 5. Data model — `larps.json`

```jsonc
{
  "preferenceTags": [{ "id": "scifi", "label": "Science fiction" }, ...],   // 32 tags
  "triggerGroups": [
    { "id": "przemoc", "label": "Przemoc", "triggers": ["Przemoc", "Gore", ...] }
    // 11 groups, 77 triggers total
  ],
  "characterPreferences": ["Kobiece", "Męskie", "Niebinarne"],
  "ticketTiers": [
    { "id": "wsparcia", "label": "Bilet Wsparcia", "price": "140 zł" }
  ],
  "timeslots": [
    {
      "id": "pt_wieczor", "name": "Piątek wieczór", "time": "18:00–22:00 (4h)",
      "larps": [
        { "name": "La Candela",
          "availableSlots": { "female": 0, "male": 0, "unisex": 32 },
          "tags": ["taniec_ruch", "cialo", "emocje"],
          "triggers": ["Śmierć", "Żałoba", "Ciemność"] },
        { "name": "Gra ludowa", "language": "Białoruski",
          "availableSlots": { "female": 0, "male": 0, "unisex": 14 },
          "tags": ["historia", "komedia"], "triggers": [...] }
      ]
    }
  ]
}
```

- `preferenceTags[].id` is the join key used by `larps[].tags`.
- `triggerGroups[].triggers` is a flat string catalogue *within* each group,
  purely for the collapsible-category UI (see the Form flow section);
  `larps[].triggers` is a flat array of trigger strings (no group
  indirection) that must match one of those strings verbatim —
  matching/highlighting logic (`getTriggers()`, `triggersHTML()`) works
  exactly as it did with the old flat `triggers` list, unaware groups exist.
  Only the *catalogue's* rendering is grouped.
- `larps[].availableSlots` is `{ female, male, unisex }`: how many slots
  are still **available** — locked to women, to men, or open to anyone —
  after Golden Ticket holders were cast by hand. It is not the full cast.
  This file is the **single source** for it — the backend's assignment
  algorithm (`zapisy-krak-on-backend/scripts/assignment`) reads it from here
  to fill seats, so edit it here only. The form shows it on every larp card
  (`seatsHTML()` in `app.js`). All zeros means the larp is full: it shows a
  "taken by Golden Ticket holders" note and can't be picked, and a saved
  draft silently drops it.
- `characterPreferences` is a flat string catalogue (like the old
  `triggers`), rendered as a checkbox group; the player's ticks are
  collected but not joined against any per-larp data — it's informational
  for casting, not part of matching.
- `larps[].language` (singular, optional string) marks a larp as **not**
  Polish — its absence means Polish, not "unknown". Purely display: it
  drives the `🌐 <language>` badge next to the larp's name (see Matching &
  display algorithm), nothing else reads it and it isn't collected from the
  player.
- `larps[].time` (optional string, same format as `timeslots[].time`) —
  purely display, for the rare larp whose actual hours differ from its
  slot's own window (e.g. starts an hour early). Drives the `🕐 <time>`
  badge next to the larp's name (see Matching & display algorithm);
  absence means "same as the slot."
- `ticketTiers[]` is `{ id, label, price }`; `id` is the join key used by
  each slot pick's `ticketTier` in the submission (see Submission payload
  shape). Price is a display string, not a machine-parsed amount — this
  system has no payment processing; ticket choice is informational for the
  organiser same as everything else.
- Currently 4 timeslots holding Krak-ON's real 2026 programme (26 larps) —
  `preferenceTags` (32 entries) and `triggerGroups` (11 groups, 77 triggers)
  were unified together with the organiser from that event's actual
  per-larp tag/trigger data (`_note` in `larps.json` records the source and
  date), not guessed from titles. Each larp's `availableSlots` are
  entered by the organiser: the cast from their sheet minus the Golden
  Ticket holders already placed in it.

## 6. Form flow

1. **Kto się zapisuje** — first name, last name, preferred form of address,
   email, and phone number (all required); birthdate (required, for 18+
   verification); which character genders the player is willing to play,
   ticked from `larps.json → characterPreferences` (at least one required);
   an optional "chcę zgłosić się jako NPC" checkbox, and an optional
   "Komandos larpowy" checkbox (willing to fill in last-minute for a
   dropout), and an optional "Wolontariusze" checkbox (willing to volunteer
   at the festival while not playing any larp).
2. **Preferencje** — rate every `preferenceTags` entry on a 5-point scale,
   −2..+2: `Nie znoszę / Raczej nie / Obojętne / Lubię / Uwielbiam`. Defaults
   to 0 (neutral).
3. **Triggery** — tick any number of triggers from `larps.json →
   triggerGroups`, presented as 11 collapsible categories (e.g. "Przemoc",
   "Zdrowie psychiczne i trauma") rather than one flat list — 77 triggers is
   too many to scan un-grouped. A collapsed category shows up to 3 of its
   checked trigger names plus a "+N" overflow count, so a player never has
   to reopen a category to remember what they ticked there.
4. **Sloty** — for each of the 4 timeslots (fixed in `larps.json`), larps are
   listed under "Pozostałe" sorted by descending match %. The player adds up
   to **4 per slot** into a "Twoje wybory" tray, where order is priority
   (drag via ▲/▼, remove via ✕), and picks a **ticket tier** (required) from
   `larps.json → ticketTiers` for each picked larp. Adding/removing re-sorts
   the remaining list live.
5. **Afterparty** — two independent, optional checkboxes ("Chcę wziąć udział
   w afterparty w piątek"/"w sobotę"), independent of slot picks. This is the
   one place the form deliberately diverges from the official Krak-ON form's
   own tri-state Tak/Nie/Może control, in favor of a simpler plain-checkbox
   shape — a deliberate, standing choice, not a bug to "fix" back to match
   the official form.
6. **Prywatność i zgoda** — five questions, each following one repeated
   visual shape: a **bold** statement of what's being asked, then an
   *optional* supplementary section (an expandable `<details>` for the long
   official text, a plain paragraph, or nothing), then the *unbolded*
   selectable option(s) that answer it. Three required checkboxes carry
   Centrum Kultury Podgórza's own text copied verbatim, not a paraphrase —
   see the GDPR / consent section for the full detail. Then, same shape: a
   photo/video question and a marketing-email question, both required to
   *answer* but not to agree — "Wyrażam zgodę" or "Inne" with free text, via
   the shared `getYesOtherAnswer`/`validateYesOtherAnswer`/`wireYesOtherField`
   helpers (see State management & validation) — wording matches the
   official form's "Wyrażam zgodę"/"Inne" options exactly, not a generic
   "Tak".
8. Submit — see the Submission payload shape section.

Changing any preference rating or trigger checkbox live-recomputes match %
and re-sorts every slot (a `change` listener on the form; see Matching &
display algorithm).

## 7. Matching & display algorithm

`likeliness()` and `dislikesFor()` run entirely in `app.js`, recomputed on
every `change` event, *before* any submission happens. Reasons:

- Instant feedback loop: a player expects re-sorting the instant they touch a
  rating slider, no round-trip.
- Nothing about the algorithm is secret — it's a simple average-then-rescale
  over public data (`larps.json`), so there is no reason to hide it
  server-side.
- It keeps the relay dumb (see Why a relay in between) — the backend never
  needs to know about tags, triggers, or matching logic, only "is this a
  valid consented submission?"

The computed `likeliness`/`dislikes`/`triggerConflicts` *are* re-embedded into
the submission payload at submit time (`collect()`), so the organiser sees a
frozen snapshot of what the player saw, not just raw preference numbers they'd
have to recompute themselves.

**The −2..+2 rating buttons show a face icon, not the number.** `faceIcon(v)`
draws a two-dot-eyes-plus-one-mouth-curve SVG where the mouth's control point
is a direct function of `v` (frown "∩" for negative, smile "◡" for positive,
flat at 0) — one small function generates all 5 positions, not five hand-drawn
icons. Unselected buttons also get a faint diverging red/green background tint
(`segTint(v)`, using the page's existing `--danger`/`--ok` colors at low
alpha) so the row reads left-to-right as dislike→like before a player reads
any label. This is a deliberately *bipolar* red-green use, unlike the match-%
bars' single-hue ramp — it's safe here because each of the 5 positions is also
distinguished by shape (a different mouth curve) and fixed left-to-right
order, not by color alone, so it doesn't have the color-only-encoding problem
a continuous red-green gradient would. The tint is applied via a `--tint`
custom property set inline per button, consumed by
`.seg span { background: var(--tint, #fff); }`, specifically so it can't
out-specificity `.seg input:checked + span { background: var(--accent); }` —
setting `background` directly inline would have.

**Match % (`likeliness`)**: for a larp with tag set `T`, average the player's
ratings for `T` (0 if unrated tag, though the UI defaults every rating to 0
anyway), then rescale that average from `[-2, +2]` to `[0, 100]`:

```
pct = round( ((avg_rating + 2) / 4) * 100 )
```

A larp with no tags scores a flat 50 (neutral). Label bands:
`≥80 Świetnie pasuje · ≥60 Pasuje · ≥40 Może być · <40 Raczej nie dla Ciebie`.

**Dislike warning**: any tag on the larp that the player rated **exactly −2**
("Nie znoszę") is surfaced as a "👎 Możesz nie polubić: …" note, separate from
match %. Deliberately narrowed to −2 only (not −1) per commit `8c06ee6` — a
mild dislike (−1) already drags the average down and isn't worth a standalone
warning.

**Trigger conflicts**: any trigger on the larp that the player has ticked is
shown inline on every card, bolded, red, prefixed `⚠`, both in "Twoje wybory"
and "Pozostałe". This is a safety flag, computed independently of match %.

**Language badge**: a larp whose `language` field is set (i.e. not Polish)
shows a `🌐 <language>` badge right next to its name, in both "Twoje wybory"
and "Pozostałe" (`languageBadgeHTML()` in `app.js`). This is unconditional,
not gated behind any player input — it's information about the larp itself,
not a personalized warning, so there's no "which languages do you know"
question backing it. Absence of the field means Polish, not "unknown."

**Time badge**: a larp whose `time` field is set shows a `🕐 <time>` badge
right next to its name, same two places (`timeBadgeHTML()` in `app.js`). For
a larp whose actual hours differ from its slot's own displayed window (e.g.
it starts earlier), the slot header's time stays the general window; this
badge overrides it visibly per-larp rather than silently under-informing the
player.

**Sort order**: within a slot, un-picked larps ("Pozostałe") are sorted purely
by descending match %. Picked larps ("Twoje wybory") keep the player's manual
priority order, not match %.

## 8. State management & validation

- `data` — the fetched `larps.json`, loaded once at `init()`, treated as
  read-only for the session.
- `selections` — `{ slotId: [{ name, ticketTier }, ...] }`, the only mutable
  app state, holding picks in priority order (array position = priority).
  This is the single source of truth for the "Twoje wybory" tray. `validate()`
  checks each pick's `ticketTier` by DOM position (`.ticket-select` elements
  in tray order), not by re-querying with the larp name as a selector value —
  deliberately, since larp names can contain characters (parens, quotes) that
  would need escaping in an attribute selector otherwise.
- Ratings and triggers are **not** mirrored into JS state — they're read
  live from the DOM (`getRatings()`, `getTriggers()`) whenever needed. This
  means the DOM *is* the source of truth for those two, and `selections` is
  the only thing kept outside it.
- Render pattern: any state change calls the relevant `render*()` function,
  which does a full `innerHTML` replace of its container (no diffing, no
  virtual DOM, no component framework). At this data volume (4 slots, 26
  larps, 32 tags, 77 triggers across 11 groups) full re-render is cheap
  enough that this is a reasonable, low-complexity choice rather than a
  limitation to fix.
- `larpByName(slot, name)` — larps are looked up **by name string**, not id.
  This is a latent footgun: two larps with the same name in the same slot
  would collide in `selections`. Fine today (all names are unique per slot in
  `larps.json`), but if that invariant is ever violated, picks/removal would
  silently misbehave. Worth an `id` field if the content set grows or is
  edited by non-engineers.
- `touched` (a `Set` of field ids) and `submitAttempted` (a bool) — the state
  behind "don't shame an empty required field before the player has reached
  it." The form has `novalidate`, so the browser's own validation bubbles
  never appear; `fieldMessage()`/`setFieldError()` render the same
  information as an inline `<p class="field-error">` instead, deliberately,
  because a native bubble can't be middle-ground-styled to match the rest of
  the page and disappears on its own timing, not the page's. A field only
  starts showing a live error after its first `blur` (text/date/tel) or
  `change` (checkbox groups, ticket `<select>`s) — checked against `touched`,
  not against whether the field is currently empty — so tabbing through the
  form without typing anything doesn't light up in red immediately behind the
  cursor. `validate()` (run on submit) treats every field as touched at once,
  which is also what flips `submitAttempted`, so any later slot-list
  re-render (add/remove/reorder) knows to keep re-showing ticket errors via
  `revalidateTickets()` instead of going silent just because the DOM under it
  was rebuilt.
- `submit-outcome.js` deliberately sits *outside* this state entirely — it's
  a pure function of a parsed response body, loaded as its own `<script>` tag
  before `app.js` so it can be `require()`d directly by Node tests without
  pulling in `window`/`document` (see the Non-functional requirements
  section).
- `storage` (a `localStorage` handle, or `null` if unavailable) backs the
  draft-autosave feature ("zapisz i wróć później" — see below). It's probed
  once (`draftStorage()`) rather than assumed present, because `localStorage`
  throws synchronously in private-browsing contexts in some browsers — a
  thrown probe just means autosave silently does nothing, never a broken
  page. Deliberately **not** a manual "Save" button: a button is exactly the
  thing someone forgets to click right before an accidental tab close, so
  every `input`/`change` on the form schedules a debounced (~600ms) write
  instead, plus an explicit `scheduleSave()` call after `onSlotAction`
  (button clicks on the tray don't fire `input`/`change` on the form the way
  a text field or checkbox does). Consent checkboxes are excluded from the
  saved/restored shape on purpose — a returning player re-confirms consent
  rather than inheriting it silently. The visible feedback is a single small
  fixed badge (`#draft-badge`, top-right, hidden until a draft exists) rather
  than a page-width bar: the first version of this was a sticky top banner
  with a "Zacznij od nowa" reset button, but that read as more prominent than
  the feature warranted for something this low-stakes, and a manual reset
  control wasn't wanted at all — the draft already clears itself on
  successful submit, which is the only "reset" this needs.

### Selection rules

- Max **4 picks per slot** (`MAX_PICKS`), independent per slot.
- A larp already picked in a slot cannot be re-added; disabled `+ Dodaj` once
  the slot tray hits 4.
- Reordering is via ▲/▼ (swap with neighbor); ✕ removes and reflows.
- Each pick carries its own **ticket tier** (`selections[slotId][i].ticketTier`,
  a `ticketTiers[].id`), chosen from a `<select>` in the tray item. Unset by
  default; submit is blocked until every current pick has one.
- No cross-slot exclusivity — a player may pick larps that would clock-conflict
  outside this tool; the sign-on has no concept of "you can only attend one
  slot's worth of larps across the whole festival" beyond the per-slot cap.

### Validation rules

**Client-side validation** (`validate()`, blocks submit until satisfied):
- First name, last name, preferred address, email (format-checked via the
  input's own `checkValidity()`, not just non-empty), phone, and birthdate
  all non-empty.
- At least one `characterPreferences` checkbox ticked.
- All three RODO/consent checkboxes checked: the official privacy-notice
  read-confirmation (`#consent-rodo`), the strefazajec.pl payment-processor
  acknowledgement (`#consent-strefazajec`), and the regulamin read-confirmation
  (`#consent-rules`).
- The photo/video question and the marketing-email question each have a
  selection — "Wyrażam zgodę" or "Inne" (`getYesOtherAnswer(name).choice !== null`,
  shared by both via `validateYesOtherAnswer`/`wireYesOtherField`). The
  *content* isn't validated: "Inne" with an empty free-text field still counts
  as answered — only an *answer* is required, not agreement.
- Every current slot pick has a `ticketTier` selected (checked per slot, in
  tray-item DOM order — see the `selections` bullet above for why by
  position, not by name).

**Validation timing**: each required field/group gets its own inline message
(a `<p class="field-error">`, `aria-describedby`-linked to its control) rather
than relying solely on the one bottom-of-form status line. A field only shows
its error once the player has *touched* it — first `blur` for text/date/tel
inputs, first `change` for the checkbox groups and ticket `<select>`s — so an
untouched, empty required field stays neutral on page load rather than
greeting the player with a wall of red. Once touched (or once a submit has
been attempted, which marks every field touched at once), the message updates
live on every further `input`/`change`, disappearing the moment the field
becomes valid. Re-rendering the slots list (add/remove/reorder a pick)
rebuilds its DOM from scratch, which would otherwise silently drop a showing
ticket error — `revalidateTickets()` re-applies it immediately after, but
only once a submit has already been attempted, keeping the same "don't shame
early" rule consistent across re-renders.

No validation requires *any* slot picks, ratings, or triggers themselves — a
player who adds zero larps to any slot can still submit, as long as the
identity/consent fields above are satisfied (a pick, once added, does require
its ticket tier).

### Draft autosave ("zapisz i wróć później")

The whole form autosaves to `localStorage` (key `larpsign:draft:v1`) on every
`input`/`change`, debounced ~600ms, with no manual save button — a button can
be forgotten right before an accidental tab close; autosave can't be. On page
load, a saved draft (if any) restores identity fields, ratings, triggers,
character preferences, the NPC, Komandos larpowy and Wolontariusze checkboxes, slot picks
+ ticket tiers, and afterparty choices before `renderSlots()` runs.

**Deliberately excluded from save/restore**: the consent checkboxes (general,
rules-read, photo/video, marketing). A returning player re-confirms consent
explicitly rather than inheriting a stale, un-reviewed agreement.

**Visible feedback**: a small fixed badge, top-right corner (`#draft-badge`),
hidden until a draft exists. It reads "Zachowano dane · HH:MM" after any
autosave, or the same text using the saved timestamp on restore — one visual
language for both "just saved" and "restored from earlier," no separate
"restored" message. There is no manual clear/reset control; the draft clears
itself automatically on successful submission (both the real backend path and
the local-download fallback), so a later visit never tries to restore an
already-submitted form.

**Defensive handling**: storage access is probed once at load (`draftStorage()`)
and every read/write is wrapped in `try`/`catch` — private browsing, storage
quota, or a corrupted stored value all degrade to "autosave silently does
nothing" rather than breaking the page. Restoring also drops any saved pick
whose slot or larp no longer exists in the current `larps.json` (content may
have changed since the draft was saved).

## 9. Submission payload shape

**Submission payload** (`schemaVersion: 10`):

```jsonc
{
  "meta": { "event", "submittedAt" /* ISO */, "schemaVersion": 10 },
  "identity": {
    "firstName", "lastName", "preferredAddress", "email", "phone",
    "birthdate" // "YYYY-MM-DD" from <input type=date>, no auto age-check
  },
  "characterPreferences": ["<characterPreferences string>", ...],
  "wantsNpc": false,
  "wantsStandin": false, // "Komandos larpowy" — willing to fill in last-minute for a dropout
  "wantsVolunteer": false, // "Wolontariusze" — willing to volunteer at the festival while not playing any larp
  "afterparty": {
    "friday": true,   // plain optional booleans — unchecked is a valid false
    "saturday": false
  },
  "consent": {
    "rodoNoticeRead": true,       // confirms the official RODO notice (verbatim — see GDPR / consent)
    "strefazajecInformed": true,  // confirms the strefazajec.pl payment-processor disclosure (verbatim)
    "rulesRead": true,            // confirms the event regulamin
    "photoVideo": { "choice": "tak", "other": "" },        // choice: "tak" | "inne" | null (null only pre-validation)
    "marketingEmail": { "choice": "inne", "other": "nie" }, // same shape as photoVideo, same validation
    "timestamp" /* ISO */
  },
  "preferences": { "<tagId>": -2..2, ... },       // every tag, defaults included
  "triggers": ["<trigger string>", ...],           // only the ticked ones
  "choices": {
    "<slotId>": [
      {
        "priority": 1,                             // 1-based, matches tray order
        "name": "<larp name>",
        "ticketTier": "<ticketTiers[].id>",         // null only if collected pre-validation
        "likeliness": 83,                           // match % at submit time
        "triggerConflicts": ["<trigger string>", ...],
        "dislikes": ["<tag label>", ...]             // -2-rated tags on this larp
      }
    ]
  },
  // Readable names for every slot/tier in larps.json, for the confirmation
  // email — the backend has no access to larps.json, so it reads them here.
  "timeslotLabels": { "<slotId>": "<name> <time>", ... },
  "ticketTierLabels": { "<tierId>": "<label>", ... }
}
```

## 10. GDPR / consent

- **Confirmation email is transactional, not marketing.** After a
  submission is committed to GitHub, the backend emails the player a summary
  of what was recorded (picks with timeslot and ticket names, NPC / Komandos
  / Wolontariusze / afterparty choices, and the controller contact for
  corrections or erasure). It's sent regardless of `consent.marketingEmail`,
  because it only confirms the submission the player just made. Sent through
  a Brevo transactional template — so Brevo processes players' email
  addresses; the privacy notice must cover that. Data built by
  `buildConfirmationEmailRequest()` in the backend's `Code.gs`.
- **Lawful basis**: explicit opt-in consent, three checkboxes required,
  timestamped and stored with every submission — confirming the official
  RODO notice (`rodoNoticeRead`), the strefazajec.pl payment-processor
  disclosure (`strefazajecInformed`), and the event regulamin (`rulesRead`),
  each its own distinct purpose. `photoVideo` (promotional photo/video use)
  is a required *question*, not a required *consent* — the player must pick
  "Wyrażam zgodę" or "Inne" (with optional free text for nuance, e.g. partial
  consent), but either answer, including a declining "Inne", satisfies
  validation. `marketingEmail` follows the identical pattern. Keeping
  photo/video and marketing-email as their own fields (rather than folding
  them into the general consents) matters because each is a distinct purpose
  under GDPR from processing data for casting — consent (or its refusal) for
  a distinct purpose must be freely given, separable, and not a condition of
  using the service, which is also why answering the question is required
  but *agreeing* is not.
- **Transparency, and why the wording is copied rather than written**: the
  privacy-notice and consent copy in this form is deliberately taken verbatim
  from Krak-ON's own published sources rather than independently worded,
  because running an event and being its RODO data controller are different
  questions with different answers, and getting either the controller's
  identity or the legal basis wrong independently would be a real compliance
  mistake, not just a copy-editing one. Concretely: the full official
  "Informacja dotycząca przetwarzania danych osobowych" (Centrum Kultury
  Podgórza's own RODO notice, sections I-X — administrator, IOD, legal basis
  and purposes, data-subject rights, retention, recipients,
  automated-decision and third-country disclosures) is reproduced verbatim in
  a `<details>` block, not paraphrased or summarized. The strefazajec.pl
  payment-processor statement is likewise verbatim, with its full text
  serving as the checkbox's own label rather than a summary of it. If
  `config.js.rulesUrl` is set, a note above the third checkbox links to the
  regulamin directly ("Regulamin wydarzenia dostępny jest pod adresem: ...").
- **`config.js.controller.name`** (shown in the footer as the practical
  erasure-request contact) reads "Stowarzyszenie Terra Futura oraz Centrum
  Kultury Podgórza" — matched to the wording of the general-consent checkbox
  on the real, currently live Krak-ON Google sign-on form, the most specific
  and current source available for what this form's own consent covers. The
  verbatim RODO notice reproduced in `index.html` separately names Centrum
  Kultury Podgórza as administrator alone; the two may simply be scoped
  differently (the festival's general consent vs. this specific venue's own
  RODO administrator role) but that hasn't been independently confirmed with
  the organiser — worth resolving with them before changing either value.
- **Data minimization**: name, email, phone, and birthdate are all mandatory
  — a wider set than a nickname-only design would need, adopted to match a
  real festival's actual needs (emergency contact, 18+ verification for
  legally-required age-gating). No further PII beyond what's described in
  this document is collected.
- **Storage location disclosure**: this form's own processing chain (Google
  Apps Script relay, data transits but is not persisted there, and GitHub as
  the actual storage, both USA-based) is not separately disclosed to the
  player in the form's own copy — the official RODO notice (§V, "Odbiorcy
  danych osobowych") covers processors in general terms. If this becomes a
  compliance concern, it belongs in the organiser's own regulamin/RODO text,
  not as separately-invented copy in this codebase.
- **Retention**: the official RODO notice's own §VI states concrete retention
  periods (accounting/tax documentation: 5 years after the year of the event;
  camera-monitoring recordings: no more than 3 months; consent-based
  processing: until withdrawal) — reproduced verbatim as part of the notice.
  `config.js` carries no separate `retention` field; the notice is the single
  source for this. *Enforced manually regardless*: deleting the JSON file in
  the private repo is this project's own deletion mechanism, there is no
  automated expiry job.
- **Erasure**: the official notice's own §I/§II give the authoritative
  contact channels (Centrum Kultury Podgórza, `sekretariat@ckpodgorza.pl`,
  and its Inspektor Ochrony Danych at `iod@ckpodgorza.pl`);
  `controller.email` in `config.js`, shown in the footer, is this project's
  own practical contact for erasure requests specifically about a `larpsign`
  submission — manual process either way (organiser finds and deletes the
  file(s) for that person).
- **Public files contain no secrets**: `config.js` and `larps.json` are
  served publicly via GitHub Pages and must never carry tokens or
  participant data — only `zapisy-krak-on-backend`'s `Code.gs`'s `GH_TOKEN` (an
  Apps Script Script Property) touches write credentials.
- **No sync mechanism**: if Krak-ON's regulamin or official sign-on form
  change their wording later, this form's copy needs to move with it by
  hand — there's no mechanism that keeps them in sync automatically, and
  there isn't a good one available (both are normal web pages, not an API).

## 11. Known gaps / deliberately deferred

These are absent by omission, not oversight — flagging them so a future
session doesn't have to rediscover them by reading code:

- **Confirmation email is best-effort.** It's sent only after the GitHub
  commit succeeds, and a failed send never fails the submission — but there's
  no retry, and the player isn't told it failed. Brevo's free plan quota
  (300/day) could stop confirmations for the rest of a sign-up-rush day;
  failures show in Apps Script's Executions log and Brevo's transactional
  logs.
- **Only full larps are blocked in the form.** A larp whose
  `availableSlots` are all 0 can't be picked; otherwise
  nothing stops more players from prioritizing a larp than it has seats —
  seats are only enforced afterwards, by the backend's assignment algorithm.
- **No cross-slot conflict detection.** Nothing ties timeslots to real
  wall-clock overlap or warns about anything beyond the 4-slot structure
  already defined.
- **No dedup / resubmission handling.** The backend writes a new timestamped
  file per POST; a player submitting twice (e.g. after a network error retry)
  produces two files. No "upsert by identity" concept exists.
- **No rate limiting.** A correctly-secreted request still isn't
  rate-limited — repeated valid-looking POSTs all succeed. Acceptable for a
  low-traffic festival form; would need real hardening (e.g. Turnstile) for a
  more exposed deployment.
- **No origin restriction is possible, and it wouldn't have meant what it
  looked like anyway.** Apps Script Web Apps deployed with "Access:
  Everyone" accept requests from any origin, with no equivalent of an
  `ALLOWED_ORIGIN` lockdown available. Worth being precise about what this
  costs: CORS is a browser-enforced rule about which page's JS may *read a
  response*, never a server-side access control — an origin allowlist never
  stops a direct `curl` either. It's a real regression in one specific way,
  though: because the frontend sends `text/plain` to dodge Apps Script's
  CORS limitation (see the Request/response contract section), the browser
  treats it as a "simple request" and skips the preflight entirely — meaning
  *any* third-party website could embed hidden JS that silently POSTs to
  this endpoint from an unsuspecting visitor's browser, no read of the
  frontend's source required. The shared secret below exists specifically
  to close that gap (a blind cross-site POST won't know the secret), on top
  of the unlisted-URL mitigation both backends have always relied on.
- **Shared secret (`SUBMIT_SECRET` / `config.js`'s `submitSecret`) — a
  deterrent, not real security, and documented as such.** Because
  `config.js` is a public file served as-is by GitHub Pages, this secret is
  trivially readable by anyone who opens it — it does **not** stop a
  determined actor who reads the frontend's source, only the CSRF-style
  blind POST above and casual/automated scanning. This was a deliberate,
  informed trade-off for this project's actual shape: a short-lived,
  per-festival deployment where "stops opportunistic abuse without adding a
  captcha/verification service" was judged worth it over real bot protection
  (e.g. reCAPTCHA/Turnstile, verified server-side) — which remains the
  documented next step (see the rate-limiting bullet above) if a deployment
  ever needs more than this.
- **GitHub Actions deliberately doesn't automate the Apps Script deploy
  itself.** Investigated and rejected: Google's `clasp` CLI can push code to
  an *existing* Apps Script deployment non-interactively once credentials
  exist, but obtaining those credentials requires an interactive browser
  login — and Google has actively disabled the headless variant of that flow
  that used to work. Service-account auth (which can run headlessly) only
  works for Google Workspace accounts with an admin, not the personal Gmail
  accounts individual organisers actually have. A Web App's "Execute as" /
  "Who has access" settings also can only be set for the first time through
  script.google.com's own UI. Net result: there is no way to provision a
  stranger's brand-new Apps Script Web App without *someone* touching either
  a terminal or script.google.com's UI at least once — automating it would
  either not work reliably or would reintroduce the terminal requirement
  this migration specifically eliminated. CI's job is limited to keeping the
  pure functions correct; deploy stays the manual walkthrough in each repo's
  README.
- **No admin/reviewing UI.** Organisers read submissions as raw JSON files in
  the private repo. Because that repo is already private and admin-only,
  `git clone` access to it already *is* the authorization check — the
  intended next tool is a script living in that same private repo, run
  locally against the cloned `submissions/` files, not a hosted viewer. No
  new hosting or auth system is needed for a first version of this.
- **Shared multi-tenant backend — considered, not built.** If per-organiser
  self-hosting (the model this document describes) turns out to be too much
  setup friction in practice, the considered fallback is a single backend the
  original maintainer personally operates, with other organisers onboarding
  via a single-use, cryptographically random (UUIDv4) invite code — redeemed
  atomically, sent as a POST body field (never a URL), over HTTPS, optionally
  time-boxed. This was deliberately not pursued now: it trades away
  per-organiser data ownership questions (does each organiser's data still
  land in their own repo, or centralize under repos the maintainer
  controls?) and meaningfully increases the maintainer's GDPR
  processor/controller responsibility across every event using it. Recorded
  here so a future session doesn't have to rediscover this reasoning from
  scratch.
- **Ticket tiers are informational only, no payment processing.**
  `ticketTiers` (added modeling a reference festival's Google Form) captures
  which tier a player intends to buy per pick — it does not charge anyone,
  check inventory, or enforce the reference form's own rule that
  Social-ticket availability is capped by how many Support tickets were
  bought. If a real event needs that, it's a manual reconciliation the
  organiser does from submitted data, same as capacity (`availableSlots`, above) —
  not logic this form implements.
- **The tag/trigger vocabulary is a hand-curated unification, not a raw
  import or a guess.** `larps.json`'s `preferenceTags` (32) and
  `triggerGroups` (11 groups, 77 triggers) were built together with the
  organiser from Krak-ON's actual 2026 programme data, not guessed from
  titles. The generation script and full raw→final mapping are checked in
  at `.scratch/tag-trigger-unification/` as a reference for redoing this
  process for a future event's programme — see that folder's own README for
  why it won't just re-run against new data as-is. Specific past decisions
  live in `git log`, not here.
- **Character-preference and marketing-consent state is a folksonomy risk in
  miniature, but small enough not to need the tag-unification treatment
  above.** `characterPreferences` stayed a flat 3-item list; no unification
  was needed at this scale.
- **A player-facing warning can be about the player, or about the larp —
  worth checking which before building one.** A conditional, personalized
  warning (like the trigger-conflict flag) only makes sense when the thing
  being warned about depends on player input. When it's a fixed fact about
  the larp itself instead — as the language and time badges are (see
  Matching & display algorithm) — an unconditional badge is the simpler,
  correct shape, with no new question needed to gate it.

## 12. Extension points (where to make common changes)

| Change | Where |
|---|---|
| Add/edit larps, timeslots, tags, triggers, character preferences, ticket tiers | `larps.json` only |
| Event name, controller contact, rules link, endpoint URL | `config.js` only |
| Change match % formula or scale bands | `likeliness()` / `likeLabel()` in `app.js` |
| Change max picks per slot | `MAX_PICKS` in `app.js` |
| Change submission schema | `collect()` in `app.js` **and** update this doc's Submission payload shape section + bump `schemaVersion` |
| Change storage backend or add validation | `Code.gs` in the `zapisy-krak-on-backend` repo |
| Change the confirmation email's wording or look | the transactional template in Brevo; the data it gets comes from `buildConfirmationEmailRequest()` in the backend's `Code.gs` (labels from `timeslotLabels`/`ticketTierLabels` in `collect()` here) |
| Change the submit request/response contract | keep `submit-outcome.js` here and `buildSubmissionRequest()` in `zapisy-krak-on-backend`'s `Code.gs` in sync — see the Request/response contract section, and update both repos |
| Add a results-review/casting tool | a script reading the cloned private submissions repo locally — see the Known gaps section |
| Visual restyle | `styles.css` (CSS custom properties in `:root` drive the palette) |
| Deploy any change to `app.js`, `submit-outcome.js`, `config.js` or `styles.css` | bump the `?v=` value on their tags in `index.html`, so browsers don't mix cached old files with new ones |
| Rebrand for a different event | replace `assets/krakon-logo.svg` and swap `.masthead`'s background/logo in `index.html`; `styles.css`'s `--accent`/`--navy` already happen to be Krak-ON's real brand colors (pink `#ec398b`, navy), not neutral defaults — pick your own if forking for another event |

## 13. Non-functional requirements

- **No build step**: plain HTML/CSS/JS, static-hostable as-is (GitHub
  Pages). `npm test` (below) runs only during development and ships nothing
  to the site — `package.json` carries no dependencies.
- **No backend required to test**: empty `submitEndpoint` degrades
  gracefully to file download (see the Request/response contract section).
- **No terminal required to deploy**: both the frontend (fork + GitHub Pages
  settings, this repo) and the backend (`zapisy-krak-on-backend`'s `Code.gs`
  pasted into script.google.com) are set up entirely through web UIs — see
  the README's Deploy section here and `zapisy-krak-on-backend`'s own README.
- **Automated tests, narrowly scoped**: `npm test` in each repo (Node's
  built-in test runner, no dependencies) covers `interpretSubmitOutcome()`
  (`submit-outcome.js`, here) and `buildSubmissionRequest()` (`Code.gs`, in
  `zapisy-krak-on-backend`) — the two pure functions on either side of the submit
  contract (see the Request/response contract section) — extracted
  specifically because the Apps Script migration added real branching logic
  (consent/JSON validation, error-code mapping). Both repos run this via
  `.github/workflows/test.yml` on every push/PR. Everything else in the
  project (rendering, matching, slot selection, the actual live deploy)
  remains manually verified; see the Known gaps section for what that
  leaves unaddressed, including why deploy itself is deliberately not
  automated.
- **Responsive**: single-column layout collapses preference rows to stacked
  on ≤560px.
- **Status messaging**: `#status` is an `aria-live="polite"` region for
  submit/error feedback.
- **XSS safety**: all dynamic content interpolated into `innerHTML` is
  passed through `esc()` (HTML-entity escaping) — applies to larp names,
  tag labels, trigger strings, and config strings sourced from JSON/config
  files.

## 14. Deployment status

This is a live production deployment, serving real sign-ups for Krak-ON
2026 — not a template or a dev-only instance. `config.js`'s `submitEndpoint`
and `submitSecret` hold real, live values, and `larps.json` holds Krak-ON's
actual confirmed 2026 programme.

Forking this for another event means supplying your own credentials (a new
Apps Script Web App + `SUBMIT_SECRET`, a new private submissions repo, your
own `config.js` values) — see the README's Deploy section for the
walkthrough. For current actual values (endpoint, secret, controller
contact, programme content), read `config.js` and `larps.json` directly
rather than trusting a status note like this one, which will go stale the
next time something changes.
