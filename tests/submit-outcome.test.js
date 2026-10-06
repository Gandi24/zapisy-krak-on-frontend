const { test } = require("node:test");
const assert = require("node:assert/strict");
const { interpretSubmitOutcome, failureAdvice } = require("../submit-outcome.js");

test("ok:true body is a success", () => {
  assert.deepEqual(interpretSubmitOutcome({ ok: true, path: "submissions/x.json" }), {
    ok: true,
  });
});

test("known error code maps to a Polish message", () => {
  assert.deepEqual(interpretSubmitOutcome({ ok: false, error: "consent_required" }), {
    ok: false,
    message: "brak zgody w zgłoszeniu",
  });
});

test("unauthorized (bad shared secret) maps to a Polish message", () => {
  assert.deepEqual(interpretSubmitOutcome({ ok: false, error: "unauthorized" }), {
    ok: false,
    message: "formularz jest błędnie skonfigurowany (nieprawidłowy klucz) — zgłoś to organizatorom",
  });
});

test("unrecognised error code falls back to a generic message", () => {
  assert.deepEqual(interpretSubmitOutcome({ ok: false, error: "something_new" }), {
    ok: false,
    message: "nieznany błąd serwera",
  });
});

test("unparseable/empty body is treated as a generic failure, not a crash", () => {
  assert.deepEqual(interpretSubmitOutcome(null), { ok: false, message: "nieznany błąd serwera" });
});

test("first failed send: check for the confirmation email, otherwise try again", () => {
  const msg = failureAdvice(1, "zapis po stronie serwera nie powiódł się", "festiwal@example.com");
  assert.match(msg, /szczegóły: zapis po stronie serwera nie powiódł się/);
  assert.match(msg, /mail z potwierdzeniem/);
  assert.match(msg, /spróbuj wysłać zgłoszenie ponownie/);
  assert.doesNotMatch(msg, /Pobierz moje odpowiedzi/);
});

test("second and later failed sends: check for the email, otherwise download and email the answers", () => {
  [2, 5].forEach((n) => {
    const msg = failureAdvice(n, "nieznany błąd serwera", "festiwal@example.com");
    assert.match(msg, /mail z potwierdzeniem/);
    assert.match(msg, /Pobierz moje odpowiedzi/);
    assert.match(msg, /festiwal@example\.com/);
    assert.doesNotMatch(msg, /ponownie/);
  });
});
