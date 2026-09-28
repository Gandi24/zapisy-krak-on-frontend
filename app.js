// ---------------------------------------------------------------------------
// Silnik formularza zapisów na larpy.
// Krok 1: ocena preferencji (-2..2). Krok 2: triggery (tak/nie).
// Krok 3: wybór priorytetów w każdym slocie, z wyliczanym dopasowaniem.
// Dane gier i słowniki pochodzą z larps.json.
// ---------------------------------------------------------------------------
const cfg = window.CONFIG || {};
const $ = (sel) => document.querySelector(sel);

let data = null;
const selections = {};

// --- walidacja pól wymaganych: błąd pojawia się dopiero po kontakcie z polem
// (blur/change), nie od razu przy wczytaniu strony — patrz DESIGN.md §6.
const REQUIRED_TEXT_FIELDS = ["first-name", "last-name", "preferred-address", "email", "phone", "birthdate"];
const touched = new Set();
let submitAttempted = false;

const REQUIRED_FIELD_MESSAGES = {
  "first-name": "Podaj imię.",
  "last-name": "Podaj nazwisko.",
  "preferred-address": "Napisz, jak się do Ciebie zwracać.",
  email: "Podaj adres e-mail.",
  phone: "Podaj numer telefonu.",
  birthdate: "Podaj datę urodzenia.",
};

function fieldMessage(id) {
  const el = document.getElementById(id);
  if (!el.value.trim()) return REQUIRED_FIELD_MESSAGES[id] || "To pole jest wymagane.";
  if (id === "email" && !el.checkValidity()) return "Podaj prawidłowy adres e-mail.";
  return "";
}

function applyValidity(container, errorEl, ok, message, { ariaInvalid = false } = {}) {
  if (container) {
    container.classList.toggle("bad", !ok);
    if (ariaInvalid) {
      if (ok) container.removeAttribute("aria-invalid");
      else container.setAttribute("aria-invalid", "true");
    }
  }
  if (errorEl) errorEl.textContent = ok ? "" : message;
  return ok;
}

function setFieldError(id, msg) {
  const input = document.getElementById(id);
  const errorEl = document.getElementById(`${id}-error`);
  applyValidity(input, errorEl, !msg, msg, { ariaInvalid: true });
}

function validateField(id) {
  const msg = fieldMessage(id);
  setFieldError(id, msg);
  return !msg;
}

function validateCharPrefs() {
  const ok = getCharacterPreferences().length > 0;
  const group = $("#char-prefs");
  const errorEl = $("#char-prefs-error");
  return applyValidity(group, errorEl, ok, "Zaznacz przynajmniej jedną opcję.", { ariaInvalid: true });
}

// Trzy niezależne wymagane checkboxy (RODO, strefazajec.pl, regulamin) —
// każdy dostaje własny inline błąd tuż pod sobą, jak każde inne wymagane
// pole w tym formularzu (patrz DESIGN.md §6), zamiast jednego wspólnego
// komunikatu daleko na dole karty, który nie mówi, KTÓRY checkbox brakuje.
const REQUIRED_CONSENT_CHECKBOXES = ["consent-rodo", "consent-strefazajec", "consent-rules"];

function validateRequiredCheckbox(id) {
  const el = document.getElementById(id);
  const ok = el.checked;
  const line = el.closest(".checkline");
  const errorEl = document.getElementById(`${id}-error`);
  return applyValidity(line, errorEl, ok, "To pole jest wymagane.");
}

// "Wyrażam zgodę / Inne" — wzorzec współdzielony przez zgodę foto/wideo i
// zgodę na maile (dokładnie jak w oficjalnym formularzu Krak-ON). Pytanie
// wymagane w ODPOWIEDZI (jakiejkolwiek), nie w jej TREŚCI — "Wyrażam zgodę"
// i "Inne" (choćby puste) są równie poprawnymi wyborami; to nie jest brama
// zgody, tylko wymóg udzielenia jakiejkolwiek odpowiedzi.
function getYesOtherAnswer(name) {
  const checked = document.querySelector(`[name="${name}"]:checked`);
  return {
    choice: checked ? checked.value : null,
    other: $(`#${name}-other-text`).value.trim(),
  };
}

function validateYesOtherAnswer(name) {
  const ok = getYesOtherAnswer(name).choice !== null;
  const group = $(`#${name}-group`);
  const errorEl = $(`#${name}-error`);
  return applyValidity(group, errorEl, ok, "Wybierz odpowiedź (Wyrażam zgodę albo Inne).");
}

function wireYesOtherField(name) {
  [`#${name}-yes`, `#${name}-other`].forEach((sel) =>
    $(sel).addEventListener("change", () => validateYesOtherAnswer(name))
  );
  $(`#${name}-other-text`).addEventListener("focus", () => {
    $(`#${name}-other`).checked = true;
    validateYesOtherAnswer(name);
  });
}


function ticketRowError(select) {
  return select.closest(".ticket-row").querySelector(".field-error");
}

// --- zapis roboczy w localStorage: "zapisz i wróć później" ------------------
// Autosave, nie przycisk — nikt nie zapomni kliknąć "zapisz" tuż przed
// przypadkowym zamknięciem karty. Zgody (RODO) są świadomie wyłączone z
// zapisu/odtwarzania: wracający gracz ma je potwierdzić na nowo, nie
// dziedziczyć starą zgodę bez ponownego przeczytania.
const DRAFT_KEY = "larpsign:draft:v1";

function draftStorage() {
  try {
    localStorage.setItem("__larpsign_probe__", "1");
    localStorage.removeItem("__larpsign_probe__");
    return localStorage;
  } catch (e) {
    return null; // np. prywatne okno, wyłączony storage — autosave po prostu nic nie robi
  }
}
const storage = draftStorage();

function serializeDraft() {
  return {
    savedAt: new Date().toISOString(),
    identity: {
      firstName: $("#first-name").value,
      lastName: $("#last-name").value,
      preferredAddress: $("#preferred-address").value,
      email: $("#email").value,
      phone: $("#phone").value,
      birthdate: $("#birthdate").value,
    },
    ratings: getRatings(),
    triggers: getTriggers(),
    characterPreferences: getCharacterPreferences(),
    wantsNpc: $("#wants-npc").checked,
    wantsStandin: $("#wants-standin").checked,
    goldenTicket: getGoldenTicketPriorities(),
    afterparty: {
      friday: $("#afterparty-friday").checked,
      saturday: $("#afterparty-saturday").checked,
    },
    selections,
  };
}

let saveTimer = null;
function scheduleSave() {
  if (!storage) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftNow, 600);
}

function saveDraftNow() {
  if (!storage) return;
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(serializeDraft()));
    showDraftSaved();
  } catch (e) {
    // np. limit storage — autosave jest wygodą, nie wymogiem; ciche pominięcie
  }
}

function clearDraft() {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch (e) {}
}

function clockTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function showDraftBadge(date) {
  const badge = $("#draft-badge");
  badge.textContent = `Zachowano dane · ${clockTime(date)}`;
  badge.hidden = false;
}

function showDraftSaved() {
  showDraftBadge(new Date());
}

// Wczytuje zapis roboczy (jeśli jest) i odtwarza pola/zaznaczenia; w przeciwnym
// razie po prostu zeruje `selections`. Musi biec PO renderPrefs/renderTriggers/
// renderCharacterPrefs (potrzebuje ich checkboxów/radiówek w DOM) i PRZED
// renderSlots (żeby ten odczytał już właściwy stan ocen/triggerów/wyborów).
function restoreDraft() {
  const raw = storage && storage.getItem(DRAFT_KEY);
  let draft = null;
  try {
    draft = raw ? JSON.parse(raw) : null;
  } catch (e) {
    clearDraft(); // zapis uszkodzony — lepiej zacząć czysto niż wywalić stronę
  }

  if (!draft) {
    data.timeslots.forEach((s) => (selections[s.id] = []));
    return;
  }

  const id = draft.identity || {};
  $("#first-name").value = id.firstName || "";
  $("#last-name").value = id.lastName || "";
  $("#preferred-address").value = id.preferredAddress || "";
  $("#email").value = id.email || "";
  $("#phone").value = id.phone || "";
  $("#birthdate").value = id.birthdate || "";

  Object.entries(draft.ratings || {}).forEach(([tagId, v]) => {
    const el = document.querySelector(`[name="pref_${tagId}"][value="${v}"]`);
    if (el) el.checked = true;
  });
  (draft.triggers || []).forEach((val) => {
    const el = document.querySelector(`[name="trigger"][value="${CSS.escape(val)}"]`);
    if (el) el.checked = true;
  });
  (draft.characterPreferences || []).forEach((val) => {
    const el = document.querySelector(`[name="charpref"][value="${CSS.escape(val)}"]`);
    if (el) el.checked = true;
  });
  $("#wants-npc").checked = !!draft.wantsNpc;
  $("#wants-standin").checked = !!draft.wantsStandin;
  (draft.goldenTicket || []).forEach((name, i) => {
    const sel = $(`#golden-ticket-${i + 1}`);
    if (sel && name) sel.value = name;
  });
  if (draft.afterparty) {
    // "tak" is an older draft's tri-state value (pre-checkbox redesign) — still
    // treated as checked so an in-progress draft saved before the redesign survives it.
    $("#afterparty-friday").checked = draft.afterparty.friday === true || draft.afterparty.friday === "tak";
    $("#afterparty-saturday").checked = draft.afterparty.saturday === true || draft.afterparty.saturday === "tak";
  }

  // Walidacja względem aktualnych danych: slot albo larp mógł zniknąć z
  // larps.json od czasu zapisu — odrzuć takie wybory po cichu.
  data.timeslots.forEach((slot) => {
    const picks = (draft.selections && draft.selections[slot.id]) || [];
    selections[slot.id] = picks
      .filter((p) => p && larpByName(slot, p.name))
      .map((p) => ({ name: p.name, ticketTier: p.ticketTier || "" }));
  });

  showDraftBadge(new Date(draft.savedAt));
}

const SCALE = [
  { v: -2, label: "Nie znoszę" },
  { v: -1, label: "Raczej nie" },
  { v: 0, label: "Obojętne" },
  { v: 1, label: "Lubię" },
  { v: 2, label: "Uwielbiam" },
];

// Twarz zamiast gołej liczby: usta jako jedna krzywa Béziera, której
// wygięcie zależy wprost od `v` — jedna funkcja generuje wszystkie 5 min,
// zamiast pięciu osobnych ikon do utrzymania. Rysowana w currentColor, więc
// dziedziczy kolor z .seg span (szary nieaktywny / biały na zaznaczonym).
function faceIcon(v) {
  const mouthY = 15 + v * 2.2; // dodatnie v -> usta niżej pośrodku (uśmiech "◡"); ujemne -> wyżej (grymas "∩")
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <circle cx="8" cy="9" r="1.4" fill="currentColor" />
    <circle cx="16" cy="9" r="1.4" fill="currentColor" />
    <path d="M7 15 Q12 ${mouthY.toFixed(1)} 17 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>`;
}

// Delikatne podbarwienie nieaktywnego przycisku skali — czerwonawe dla
// niechęci, zielonkawe dla sympatii, bez koloru dla neutralnego środka.
// Ustawiane jako CSS custom property, nie bezpośrednio `background`, żeby
// nie bić specyficznością reguły `.seg input:checked + span` w CSS.
function segTint(v) {
  if (v === 0) return "";
  const rgb = v < 0 ? "210, 59, 84" : "46, 158, 91"; // --danger / --ok
  const alpha = 0.07 + (Math.abs(v) / 2) * 0.08;
  return `--tint: rgba(${rgb}, ${alpha.toFixed(2)});`;
}

init();

async function init() {
  $("#event-name").textContent = cfg.eventName || "Zapisy na larpy";
  $("#footer-contact").textContent = cfg.controller
    ? `© ${new Date().getFullYear()} Festiwal Krak-ON. Pytania i prośby o usunięcie danych: ${cfg.controller.email}`
    : "";

  if (cfg.submissionsOpen === false) {
    const notice = $("#submissions-closed-notice");
    notice.textContent =
      `Zapisy otworzą się ${cfg.submissionsOpenAt || "wkrótce"}. Formularz możesz ` +
      `wypełnić już teraz, ale wysyłka będzie możliwa dopiero po otwarciu zapisów.`;
    notice.hidden = false;
  }

  try {
    data = await fetch("larps.json", { cache: "no-store" }).then((r) => r.json());
  } catch (e) {
    setStatus("Nie udało się wczytać danych gier. Odśwież stronę.", "err");
    return;
  }

  renderLegend();
  renderPrefs();
  renderTriggers();
  renderCharacterPrefs();
  renderGoldenTicketOptions();
  restoreDraft(); // ustawia `selections` (z zapisu albo pusto) + odtwarza pola/zaznaczenia
  updateTriggerGroupCounts();
  renderSlots();

  if (cfg.rulesUrl) {
    $("#rules-link-note").innerHTML =
      `Regulamin wydarzenia dostępny jest pod adresem:
       <a href="${esc(cfg.rulesUrl)}" target="_blank" rel="noopener">${esc(cfg.rulesUrl)}</a>`;
  }
  if (cfg.programUrl) {
    $("#intro-text").innerHTML =
      `Pełny opis larpów i harmonogram:
       <a href="${esc(cfg.programUrl)}" target="_blank" rel="noopener">strona wydarzenia</a>.`;
  }

  REQUIRED_TEXT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("blur", () => {
      touched.add(id);
      validateField(id);
    });
    el.addEventListener("input", () => {
      // Nie strasz błędem, dopóki pole nie zostało dotknięte (blur) albo
      // nie było próby wysyłki — ale gdy błąd już się pojawił, niech zniknie
      // na bieżąco, bez czekania na kolejne opuszczenie pola.
      if (touched.has(id) || submitAttempted) validateField(id);
    });
  });
  $("#char-prefs").addEventListener("change", validateCharPrefs);
  REQUIRED_CONSENT_CHECKBOXES.forEach((id) =>
    $(`#${id}`).addEventListener("change", () => validateRequiredCheckbox(id))
  );
  // Wpisanie tekstu w "Inne" samo zaznacza ten wybór — jak w Google Forms.
  ["consent-photo", "consent-marketing"].forEach(wireYesOtherField);

  const form = $("#signon-form");
  form.addEventListener("submit", onSubmit);
  form.addEventListener("change", (e) => {
    if (e.target.matches('[name^="pref_"], [name="trigger"]')) {
      renderSlots();
      if (submitAttempted) revalidateTickets();
    }
  });
  $("#slots").addEventListener("click", onSlotAction);
  $("#slots").addEventListener("change", onTicketChange);
  $("#download-btn").addEventListener("click", () => download(collect()));

  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);
}

// --- render: legenda + preferencje -----------------------------------------

function renderLegend() {
  $("#pref-legend").innerHTML = SCALE.map(
    (s) => `<span>${faceIcon(s.v)} ${esc(s.label)}</span>`
  ).join("");
}

function renderPrefs() {
  $("#prefs").innerHTML = data.preferenceTags
    .map(
      (t) => `<div class="pref-row">
        <span class="pref-label">${esc(t.label)}</span>
        <div class="seg">${SCALE.map(
          (s) => `<label title="${esc(s.label)}">
            <input type="radio" name="pref_${t.id}" value="${s.v}" aria-label="${esc(s.label)}" ${s.v === 0 ? "checked" : ""}/>
            <span style="${segTint(s.v)}">${faceIcon(s.v)}</span>
          </label>`
        ).join("")}</div>
      </div>`
    )
    .join("");
}

function checklineHTML(name, value) {
  return `<label class="checkline"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"/>
      <span>${esc(value)}</span></label>`;
}

function renderTriggers() {
  $("#triggers").innerHTML = (data.triggerGroups || [])
    .map(
      (g) => `<details class="trigger-group">
        <summary><span class="trig-label">${esc(g.label)}</span><span class="trig-count"></span></summary>
        <div class="trigger-grid">
          ${g.triggers.map((t) => checklineHTML("trigger", t)).join("")}
        </div>
      </details>`
    )
    .join("");
  $("#triggers").addEventListener("change", updateTriggerGroupCounts);
  updateTriggerGroupCounts();
}

// Nazwy zaznaczonych triggerów w każdej (być może zwiniętej) kategorii —
// widoczne bez rozwijania grupy, żeby nie trzeba było jej otwierać, by
// przypomnieć sobie co się tam zaznaczyło.
function updateTriggerGroupCounts() {
  document.querySelectorAll(".trigger-group").forEach((det) => {
    const checked = [...det.querySelectorAll('input[name="trigger"]:checked')].map((el) => el.value);
    const badge = det.querySelector(".trig-count");
    if (!checked.length) {
      badge.textContent = "";
      return;
    }
    const shown = checked.slice(0, 3).join(", ");
    const extra = checked.length > 3 ? ` +${checked.length - 3}` : "";
    badge.textContent = `— ${shown}${extra}`;
  });
}

function renderCharacterPrefs() {
  $("#char-prefs").innerHTML = (data.characterPreferences || [])
    .map((c) => checklineHTML("charpref", c))
    .join("");
}

function getCheckedValues(name) {
  return [...document.querySelectorAll(`[name="${name}"]:checked`)].map((n) => n.value);
}

function getCharacterPreferences() {
  return getCheckedValues("charpref");
}


// --- Złoty Bilet: do 3 uszeregowanych wyborów, z pełnej listy larpów -------

function allLarpNames() {
  return data.timeslots.flatMap((slot) => slot.larps.map((l) => l.name));
}

function renderGoldenTicketOptions() {
  const options =
    `<option value="">— nie dotyczy —</option>` +
    allLarpNames()
      .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
      .join("");
  ["#golden-ticket-1", "#golden-ticket-2", "#golden-ticket-3"].forEach((sel) => {
    $(sel).innerHTML = options;
  });
}

// Puste/nieużyte wybory pomijamy — kolejność zachowana, bez wymuszania
// unikalności między polami (jeśli ktoś wybierze ten sam larp dwa razy,
// ekipa i tak przeczyta to jako jeden wybór).
function getGoldenTicketPriorities() {
  return ["#golden-ticket-1", "#golden-ticket-2", "#golden-ticket-3"]
    .map((sel) => $(sel).value)
    .filter(Boolean);
}

// --- liczenie dopasowania ---------------------------------------------------

function getRatings() {
  const r = {};
  data.preferenceTags.forEach((t) => {
    const hit = document.querySelector(`[name="pref_${t.id}"]:checked`);
    r[t.id] = hit ? Number(hit.value) : 0;
  });
  return r;
}

function getTriggers() {
  return getCheckedValues("trigger");
}

function likeliness(larp, ratings) {
  const tags = larp.tags || [];
  if (!tags.length) return 50;
  const sum = tags.reduce((a, id) => a + (ratings[id] || 0), 0);
  return Math.round(((sum / tags.length + 2) / 4) * 100);
}

function likeLabel(pct) {
  if (pct >= 80) return "Świetnie pasuje";
  if (pct >= 60) return "Pasuje";
  if (pct >= 40) return "Może być";
  return "Raczej nie dla Ciebie";
}

// Pasek dopasowania: jeden odcień (#38ed9a), rosnąca intensywność. Słabe
// dopasowanie ma prawie zlewać się z tłem paska; świetne ma być w pełni
// nasyconą, dokładnie zadaną zielenią. Świadomie jeden odcień, nie przejście
// czerwień→zieleń: taki gradient byłby nieodróżnialny dla osób z daltonizmem
// czerwono-zielonym. Sama zieleń dobrze koresponduje z --ok (sukces) użytym
// gdzie indziej w formularzu — konsekwentne "zielony = dobrze" w całej stronie.
function likelinessColor(pct) {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const hue = 153; // barwa #38ed9a
  const sat = 15 + t * 68; // 15% (blady) -> 83% (pełne nasycenie, jak #38ed9a)
  const light = 88 - t * 31; // 88% (blisko tła paska) -> 57% (jak #38ed9a)
  return `hsl(${hue} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

// --- render: sloty ----------------------------------------------------------

const MAX_PICKS = 4;
const larpByName = (slot, name) => slot.larps.find((l) => l.name === name);

function triggersHTML(larp, myTriggers) {
  const t = (larp.triggers || [])
    .map((tr) => {
      const hit = myTriggers.includes(tr);
      return `<strong class="${hit ? "trig hit" : "trig"}">${hit ? "⚠ " : ""}${esc(tr)}</strong>`;
    })
    .join(" ");
  return t ? `<div class="lc-trig">${t}</div>` : "";
}

function tagLabel(id) {
  const t = data.preferenceTags.find((p) => p.id === id);
  return t ? t.label : id;
}

// Tagi tego larpa, których gracz wyraźnie nie lubi (-2) — „to może Ci nie pasować”.
function dislikesFor(larp, ratings) {
  return (larp.tags || []).filter((id) => (ratings[id] || 0) <= -2).map(tagLabel);
}

function dislikesHTML(larp, ratings) {
  const labels = dislikesFor(larp, ratings);
  if (!labels.length) return "";
  return `<div class="lc-warn">👎 Możesz nie polubić: ${labels.map(esc).join(", ")}</div>`;
}

function metaBadgeHTML(cls, icon, value) {
  return value ? `<span class="${cls}">${icon} ${esc(value)}</span>` : "";
}

// larp.language jest ustawione tylko dla larpów NIE po polsku — brak pola
// znaczy polski, nic do pokazania. Zawsze widoczna etykieta przy nazwie,
// niezależna od tego, czy gracz zna ten język — to informacja o larpie,
// nie osobista ocena.
function languageBadgeHTML(larp) {
  return metaBadgeHTML("lc-lang", "🌐", larp.language);
}

// larp.time jest ustawione tylko gdy dany larp ma inne godziny niż reszta
// slotu (np. zaczyna się wcześniej) — slot.time w nagłówku karty slotu
// pozostaje ogólnym oknem, to nadpisuje je widocznie dla tego jednego larpa.
function timeBadgeHTML(larp) {
  return metaBadgeHTML("lc-time", "🕐", larp.time);
}

function ticketSelectHTML(slot, name, ticketTier, i) {
  const options = (data.ticketTiers || [])
    .map(
      (t) => `<option value="${esc(t.id)}" ${t.id === ticketTier ? "selected" : ""}>${esc(t.label)} (${esc(t.price)})</option>`
    )
    .join("");
  const errorId = `ticket-error-${slot.id}-${i}`;
  return `<select class="ticket-select" data-action="ticket" data-slot="${slot.id}" data-name="${esc(name)}" aria-describedby="${errorId}">
      <option value="" ${!ticketTier ? "selected" : ""}>— wybierz bilet —</option>
      ${options}
    </select>
    <p class="field-error" id="${errorId}" aria-live="polite"></p>`;
}

function renderSlots() {
  const ratings = getRatings();
  const myTriggers = getTriggers();

  $("#slots").innerHTML = data.timeslots
    .map((slot) => {
      const picks = selections[slot.id];
      const full = picks.length >= MAX_PICKS;

      const tray = picks.length
        ? picks
            .map((pick, i) => {
              const larp = larpByName(slot, pick.name);
              const pct = likeliness(larp, ratings);
              return `<li class="tray-item">
                <span class="prio">${i + 1}</span>
                <div class="ti-main">
                  <div class="lc-head">
                    <span class="lc-name">${esc(pick.name)}${timeBadgeHTML(larp)}${languageBadgeHTML(larp)}</span>
                    <span class="lc-pct">${pct}% · ${likeLabel(pct)}</span>
                  </div>
                  ${dislikesHTML(larp, ratings)}
                  ${triggersHTML(larp, myTriggers)}
                  <div class="ticket-row">
                    <label>Bilet <span class="req">*</span></label>
                    ${ticketSelectHTML(slot, pick.name, pick.ticketTier, i)}
                  </div>
                </div>
                <div class="ti-ctl">
                  <button type="button" aria-label="W górę" data-action="up" data-slot="${slot.id}" data-name="${esc(pick.name)}" ${i === 0 ? "disabled" : ""}>▲</button>
                  <button type="button" aria-label="W dół" data-action="down" data-slot="${slot.id}" data-name="${esc(pick.name)}" ${i === picks.length - 1 ? "disabled" : ""}>▼</button>
                  <button type="button" aria-label="Usuń" class="rm" data-action="remove" data-slot="${slot.id}" data-name="${esc(pick.name)}">✕</button>
                </div>
              </li>`;
            })
            .join("")
        : `<li class="tray-empty">Nic jeszcze nie wybrano — dodaj larpy z listy poniżej.</li>`;

      const available = slot.larps
        .filter((l) => !picks.some((p) => p.name === l.name))
        .map((l) => ({ larp: l, pct: likeliness(l, ratings) }))
        .sort((a, b) => b.pct - a.pct)
        .map(
          ({ larp, pct }) => `<div class="larp-card">
            <div class="lc-body">
              <div class="lc-head">
                <span class="lc-name">${esc(larp.name)}${timeBadgeHTML(larp)}${languageBadgeHTML(larp)}</span>
                <span class="lc-pct">${pct}% · ${likeLabel(pct)}</span>
              </div>
              <div class="bar"><i style="width:${pct}%; background:${likelinessColor(pct)}"></i></div>
              ${dislikesHTML(larp, ratings)}
              ${triggersHTML(larp, myTriggers)}
            </div>
            <button type="button" class="add" data-action="add" data-slot="${slot.id}" data-name="${esc(larp.name)}" ${full ? "disabled" : ""}>+ Dodaj</button>
          </div>`
        )
        .join("");

      return `<div class="slot" data-slot-id="${slot.id}">
        <div class="slot-head">
          <h3>${esc(slot.name)} <span class="slot-time">${esc(slot.time)}</span></h3>
          <span class="slot-hint">wybierz do ${MAX_PICKS} • kolejność = priorytet</span>
        </div>
        <ol class="tray">${tray}</ol>
        ${full ? `<p class="full-note">Masz już ${MAX_PICKS} wybory. Usuń coś, by dodać inny larp.</p>` : ""}
        <div class="avail-label">Pozostałe (wg dopasowania)</div>
        <div class="avail">${available || `<p class="tray-empty">Wszystkie larpy z tego slotu są na Twojej liście.</p>`}</div>
      </div>`;
    })
    .join("");
}

function onSlotAction(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  const { action, slot: slotId, name } = btn.dataset;
  const picks = selections[slotId];
  const at = picks.findIndex((p) => p.name === name);

  switch (action) {
    case "add":
      if (picks.length >= MAX_PICKS || at >= 0) return;
      picks.push({ name, ticketTier: "" });
      setStatus("");
      break;
    case "remove":
      if (at >= 0) picks.splice(at, 1);
      break;
    case "up":
      if (at > 0) [picks[at - 1], picks[at]] = [picks[at], picks[at - 1]];
      break;
    case "down":
      if (at >= 0 && at < picks.length - 1) [picks[at + 1], picks[at]] = [picks[at], picks[at + 1]];
      break;
  }
  renderSlots();
  if (submitAttempted) revalidateTickets();
  scheduleSave(); // klik przycisku nie wywołuje input/change na formularzu
}

function onTicketChange(e) {
  const sel = e.target.closest('select[data-action="ticket"]');
  if (!sel) return;
  const { slot: slotId, name } = sel.dataset;
  const pick = selections[slotId].find((p) => p.name === name);
  if (pick) pick.ticketTier = sel.value;
  sel.classList.remove("bad");
  sel.removeAttribute("aria-invalid");
  ticketRowError(sel).textContent = "";
}

// --- zbieranie + walidacja --------------------------------------------------

function collect() {
  const ratings = getRatings();
  const myTriggers = getTriggers();
  const choices = {};
  data.timeslots.forEach((slot) => {
    choices[slot.id] = selections[slot.id].map((pick, i) => {
      const larp = slot.larps.find((l) => l.name === pick.name);
      const pct = likeliness(larp, ratings);
      return {
        priority: i + 1,
        name: pick.name,
        ticketTier: pick.ticketTier || null,
        likeliness: pct,
        triggerConflicts: (larp.triggers || []).filter((t) => myTriggers.includes(t)),
        dislikes: dislikesFor(larp, ratings),
      };
    });
  });

  return {
    meta: { event: cfg.eventName || "", submittedAt: new Date().toISOString(), schemaVersion: 9 },
    identity: {
      firstName: $("#first-name").value.trim(),
      lastName: $("#last-name").value.trim(),
      preferredAddress: $("#preferred-address").value.trim(),
      email: $("#email").value.trim(),
      phone: $("#phone").value.trim(),
      birthdate: $("#birthdate").value,
    },
    characterPreferences: getCharacterPreferences(),
    wantsNpc: $("#wants-npc").checked,
    wantsStandin: $("#wants-standin").checked,
    goldenTicket: { priorities: getGoldenTicketPriorities() },
    afterparty: {
      friday: $("#afterparty-friday").checked,
      saturday: $("#afterparty-saturday").checked,
    },
    consent: {
      rodoNoticeRead: $("#consent-rodo").checked,
      strefazajecInformed: $("#consent-strefazajec").checked,
      rulesRead: $("#consent-rules").checked,
      photoVideo: getYesOtherAnswer("consent-photo"),
      marketingEmail: getYesOtherAnswer("consent-marketing"),
      timestamp: new Date().toISOString(),
    },
    preferences: ratings,
    triggers: myTriggers,
    choices,
  };
}

// Sprawdza bilety we wszystkich slotach; zwraca pierwszy brakujący <select>
// (albo null). Używane przy submit, a także po każdym przerysowaniu slotów
// (dodanie/usunięcie/zmiana kolejności czyści DOM, w tym stan błędu) — ale
// tylko po pierwszej próbie wysyłki, żeby nie strasić błędem na zapas.
function revalidateTickets() {
  let firstBad = null;
  data.timeslots.forEach((slot) => {
    const selects = document.querySelectorAll(`.slot[data-slot-id="${slot.id}"] .ticket-select`);
    selections[slot.id].forEach((pick, i) => {
      const sel = selects[i];
      const ok = !!pick.ticketTier;
      sel.classList.toggle("bad", !ok);
      if (ok) sel.removeAttribute("aria-invalid");
      else sel.setAttribute("aria-invalid", "true");
      ticketRowError(sel).textContent = ok ? "" : "Wybierz bilet dla tej gry.";
      if (!ok && !firstBad) firstBad = sel;
    });
  });
  return firstBad;
}

function validate() {
  submitAttempted = true;
  let firstBad = null;
  const note = (ok, el) => {
    if (!ok && !firstBad) firstBad = el;
  };

  REQUIRED_TEXT_FIELDS.forEach((id) => {
    touched.add(id);
    note(validateField(id), document.getElementById(id));
  });

  note(validateCharPrefs(), $("#char-prefs"));
  REQUIRED_CONSENT_CHECKBOXES.forEach((id) =>
    note(validateRequiredCheckbox(id), document.getElementById(id))
  );
  ["consent-photo", "consent-marketing"].forEach((name) =>
    note(validateYesOtherAnswer(name), $(`#${name}-group`))
  );
  const badTicket = revalidateTickets();
  note(!badTicket, badTicket);

  return firstBad;
}

// --- wysyłka ----------------------------------------------------------------

async function onSubmit(e) {
  e.preventDefault();
  if (cfg.submissionsOpen === false) {
    setStatus(`Zapisy jeszcze nie są otwarte — wróć ${cfg.submissionsOpenAt || "wkrótce"}.`, "err");
    return;
  }
  const bad = validate();
  if (bad) {
    bad.scrollIntoView({ behavior: "smooth", block: "center" });
    setStatus("Sprawdź podświetlone pola powyżej.", "err");
    return;
  }

  const payload = collect();
  const btn = $("#submit-btn");

  if (!cfg.submitEndpoint) {
    download(payload);
    clearDraft();
    setStatus(
      "Brak skonfigurowanego serwera, więc Twoje odpowiedzi zostały pobrane jako plik. " +
        "Prześlij go organizatorom.",
      "ok"
    );
    return;
  }

  btn.disabled = true;
  setStatus("Wysyłanie…");
  try {
    const res = await fetch(cfg.submitEndpoint, {
      method: "POST",
      // text/plain, not application/json: Apps Script Web Apps can't set
      // custom CORS response headers, so a JSON content type would trigger a
      // failing preflight. The body is still the JSON payload as a string.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      // Envelope, not the bare submission: the backend checks `secret`
      // against its own Script Property before touching `submission` at
      // all. See config.js's submitSecret comment for what this does (and
      // doesn't) protect against.
      body: JSON.stringify({ secret: cfg.submitSecret, submission: payload }),
    });
    const body = await res.json().catch(() => null);
    const outcome = interpretSubmitOutcome(body);
    if (!outcome.ok) throw new Error(outcome.message);
    clearDraft();
    $("#signon-form").innerHTML = `<section class="card"><h2>Dzięki! 🎭</h2>
      <p>Twoje zgłoszenie dotarło. Ekipa odezwie się w sprawie ról.</p>
      <p class="blurb">Chcesz coś zmienić albo usunąć swoje dane? Napisz na
      <a href="mailto:${esc((cfg.controller || {}).email || "")}">${esc((cfg.controller || {}).email || "")}</a>.</p></section>`;
  } catch (err) {
    btn.disabled = false;
    const email = (cfg.controller || {}).email || "";
    setStatus(
      "Wysyłka nie powiodła się: " + err.message +
        `. Kliknij „Pobierz moje odpowiedzi” i wyślij pobrany plik na ${email}` +
        " — inaczej zgłoszenie się nie zapisze.",
      "err"
    );
  }
}

// --- pomocnicze -------------------------------------------------------------

function download(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fullName = `${payload.identity.firstName} ${payload.identity.lastName}`.trim();
  const who = (fullName || "zgloszenie").replace(/[^\w.-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `larp-zapis-${who}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function setStatus(msg, kind) {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
