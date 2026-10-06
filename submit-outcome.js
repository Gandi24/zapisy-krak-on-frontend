// ---------------------------------------------------------------------------
// Pure decision logic for what the submit response means to the player.
// No fetch(), no DOM — kept separate from app.js so it's testable on its own
// and shared with tests via the Node export guard below (Apps Script Web
// Apps always answer HTTP 200, so success/failure has to come from the body).
// ---------------------------------------------------------------------------

const ERROR_MESSAGES = {
  invalid_json: "serwer nie zrozumiał zgłoszenia",
  unauthorized: "formularz jest błędnie skonfigurowany (nieprawidłowy klucz) — zgłoś to organizatorom",
  consent_required: "brak zgody w zgłoszeniu",
  github_write_failed: "zapis po stronie serwera nie powiódł się",
};

function interpretSubmitOutcome(parsedBody) {
  if (parsedBody && parsedBody.ok === true) return { ok: true };
  const code = parsedBody && parsedBody.error;
  return { ok: false, message: ERROR_MESSAGES[code] || "nieznany błąd serwera" };
}

// What the player should do after a failed send. The most common failure is
// that the submission WAS saved (and the confirmation email sent) but the
// response never made it back to the browser — so the first step is always
// to check for the confirmation email before sending again. From the second
// failure on, if there's still no email, send the downloaded file instead.
function failureAdvice(failureCount, reason, contactEmail) {
  const check =
    "Nie udało się potwierdzić wysyłki (szczegóły: " + reason + "). Twoje zgłoszenie mogło jednak dotrzeć - " +
    "sprawdź za kilka minut skrzynkę, łącznie ze spamem. Jeśli przyszedł mail z potwierdzeniem, wszystko jest " +
    "w porządku i nic więcej nie musisz robić.";
  if (failureCount <= 1) {
    return check + " Jeśli mail nie dotarł, spróbuj wysłać zgłoszenie ponownie.";
  }
  return (
    check + " Jeśli maila nie ma, kliknij „Pobierz moje odpowiedzi” i wyślij pobrany plik mailem na " +
    contactEmail + " - zapiszemy Twoje zgłoszenie ręcznie."
  );
}

if (typeof module !== "undefined") {
  module.exports = { interpretSubmitOutcome, failureAdvice, ERROR_MESSAGES };
}
