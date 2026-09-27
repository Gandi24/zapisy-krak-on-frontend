import csv, json, collections

def split_top_level(s, sep=","):
    parts, depth, buf = [], 0, []
    for ch in s:
        if ch == "(": depth += 1; buf.append(ch)
        elif ch == ")": depth -= 1; buf.append(ch)
        elif ch == sep and depth == 0: parts.append("".join(buf)); buf = []
        else: buf.append(ch)
    parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]

path = "path/to/your/larpy_export.csv"  # a Notion "Tagi"/"Triggery"-column export, see README.md in this folder
with open(path, newline='', encoding='utf-8') as f:
    rows = [r for r in csv.DictReader(f) if (r.get('﻿Tytuł') or r.get('Tytuł','')).strip()]

# ---------- preferenceTags ----------
PREF_TAGS = [
    ("emocje", "Silne emocje / dramat"),
    ("duchowosc", "Duchowość / religia"),
    ("folklor", "Folklor / obrzędy"),
    ("tajemnica", "Tajemnica / śledztwo"),
    ("trudne_wybory", "Trudne wybory / dylematy moralne"),
    ("taniec_ruch", "Taniec / larp ruchowy"),
    ("sensualnosc", "Sensualność / zmysłowość"),
    ("scifi", "Science fiction"),
    ("przemiana", "Przemiana / transformacja postaci"),
    ("polityka", "Polityka / intryga"),
    ("romans", "Wątki romantyczne"),
    ("cialo", "Larp bez słów"),
    ("groza", "Groza / horror"),
    ("katastrofa", "Katastrofa / przetrwanie"),
    ("wojna_okupacja", "Wojna / okupacja"),
    ("wspolnota", "Umysł grupowy / wspólnota"),
    ("prl", "PRL / totalitaryzm"),
    ("oniryzm", "Oniryzm"),
    ("swiat_mroku", "Świat mroku"),
    ("cyberpunk", "Cyberpunk"),
    ("historia", "Klimat historyczny"),
    ("komedia", "Komedia"),
    ("reportaz", "Reportaż / dziennikarstwo"),
    ("walka", "Konflikt / walka"),
    ("wspolczesnosc", "Czasy współczesne"),
    ("napiecie", "Napięcie / akcja"),
    ("fantasy", "Fantasy"),
    ("realizm_osiedlowy", "Realizm osiedlowy / subkultury"),
    ("ekologia", "Ekologia / natura"),
    ("relacje", "Relacje i więzi"),
    ("refleksja", "Refleksja / filozofia"),
    ("orientalne", "Orientalne"),
]

TAG_MAP = {
    "dramat":"emocje", "traumy":"emocje", "melodramat":"emocje",
    # 2026-09-20 organiser feedback round: "Rytuał / duchowość / folklor" was
    # one tag covering two things people feel very differently about — a
    # character devoted to LOCAL folklore/tradition vs. one devoted to
    # religion/the divine. Split into duchowosc/folklor. There's no reliable
    # raw-tag rule for which one a given larp gets — "rytuał"/"mistycyzm"
    # describe both, and even "okultyzm"/"sekta"/"folklor japoński"/"etniczny"
    # only look unambiguous after reading each larp's actual description. Do
    # that per-larp read again for a future event rather than trusting a
    # mapping here. "Nietypowa forma / eksperyment" was dropped outright (too
    # broad to be a meaningful filter — jeepform, no character sheets, and
    # antylarp all got the same tag).
    "taniec":"taniec_ruch", "gra ruchowa":"taniec_ruch",
    "niemy":"cialo",
    "bliskość fizyczna":"sensualnosc", "przytulanie":"sensualnosc", "zmysły":"sensualnosc",
    "horror":"groza", "duchy":"groza", "maska":"groza",
    "wojna":"wojna_okupacja",
    "murder mystery":"tajemnica", "śledztwo":"tajemnica", "detektyw":"tajemnica",
    "morderstwo":"tajemnica", "ukryta tożsamość":"tajemnica",
    "scifi":"scifi", "hard sf":"scifi", "kosmos":"scifi", "androidy":"scifi",
    "ai":"scifi", "starwars":"scifi", "kontrola misji":"scifi", "listy z ziemi":"scifi",
    "historia":"historia",
    "PRL":"prl", "totalitaryzm":"prl",
    "komedia":"komedia",
    "fantasy":"fantasy",
    "miłość":"romans", "romans":"romans",
    "dyplomacja":"polityka", "negocjacje":"polityka",
    "konflikty":"napiecie",
    "przemoc":"walka",
    "współczesność":"wspolczesnosc",
    "rodzina":"relacje",
    "trudne wybory":"trudne_wybory", "dylemat moralny":"trudne_wybory", "bycie tym złym":"trudne_wybory",
    "umysł grupowy":"wspolnota",
    "przemiana":"przemiana", "transformacja":"przemiana",
    "metagra": None, "jeepform": None, "eksperymentalny": None, "teatralny": None,
    "cyberpunk":"cyberpunk",
    "dokument":"reportaz", "dziennikarstwo":"reportaz", "debata":"reportaz",
    "hip hop":"realizm_osiedlowy", "osiedlowe akcje":"realizm_osiedlowy",
    "kibole":"realizm_osiedlowy", "realizm":"realizm_osiedlowy",
    "katastrofa":"katastrofa", "wszystko aby przetrwać":"katastrofa",
    "oniryzm":"oniryzm",
    "świat mroku":"swiat_mroku", "czerń i biel":"swiat_mroku",
    "gra ekologiczna":"ekologia",
    # explicit drops
    "narracja": None, "imersja": None, "bot": None, "system": None,
    "ameryka": None, "audycja": None, "zimna woda": None, "przemytnicy": None,
    "prawda": None, "rave": None, "narkotyki": None, "parowy": None,
    "szekspir": None, "kimona": None, "anime": None, "Wiedźmin": None,
    "tarantino": None, "12 angry men": None, "puchate zwierzęta robiące złe rzeczy": None,
    "pszczoły": None, "czarne ciuchy": None,
}

# ---------- triggerGroups ----------
TRIGGER_GROUPS = [
    ("smierc_zaloba", "Śmierć i żałoba", ["Śmierć","Śmierć bliskiej osoby","Śmierć własna","Żałoba","Utrata dziecka","Choroba terminalna","AIDS"]),
    ("przemoc", "Przemoc", ["Przemoc","Morderstwo / zabójstwo","Gore","Tortury","Przemoc fizyczna","Przemoc domowa","Przemoc psychiczna","Przemoc seksualna","Przemoc wobec zwierząt","Agresja","Broń palna","Zemsta","Wulgarny język","Bycie ofiarą przemocy","Bycie sprawcą przemocy"]),
    ("wojna", "Wojna", ["Wojna","Ludobójstwo","Represje polityczne"]),
    ("zdrowie_psychiczne", "Zdrowie psychiczne i trauma", ["Trauma / PTSD","Samobójstwo","Szaleństwo","Kryzys psychiczny","Pobyt w instytucjach psychiatrycznych","Derealizacja","Wyparcie","Strach","Bezsilność","Brak nadziei / celu","Dehumanizacja","Cierpienie","Samotność","Poczucie winy"]),
    ("relacje_zdrada", "Relacje i zdrada", ["Zdrada","Toksyczne relacje","Manipulacja","Porzucenie / odrzucenie","Relacje patriarchalne","Dramaty rodzinne","Niepełna rodzina","Rozczarowania miłosne"]),
    ("dyskryminacja", "Dyskryminacja", ["Rasizm","Dyskryminacja","Seksizm","Wykluczenie / ostracyzm"]),
    ("substancje", "Substancje", ["Alkohol / alkoholizm","Narkotyki / używki","Papierosy","Uzależnienia"]),
    ("seksualnosc_cielesnosc", "Treści seksualne i cielesne", ["Bliskość fizyczna / dotyk","Treści erotyczne / zmysłowe","Ekspozycja ciała / bielizna","Pornografia","Prostytucja","Ciąża w niesprzyjających warunkach","Niechciana ciąża"]),
    ("religia_nadprzyrodzone", "Religia i nadprzyrodzone", ["Religia","Okultyzm","Sekta","Duchy","Opętanie i utrata kontroli nad ciałem","Świętokradztwo","Zombie","Epidemia","Bunt maszyn"]),
    ("historia_polityka", "Historia i polityka", ["Fakty historyczne","Zmiana władzy"]),
    ("sensoryka", "Ciemność i doznania sensoryczne", ["Ciemność","Zmieniające się światło","Zmieniająca się muzyka","Krzyk"]),
]

def trig_map(raw):
    m = {
        "śmierć":["Śmierć"], "zdrada":["Zdrada"], "morderstwo/zabójstwo":["Morderstwo / zabójstwo"],
        "przemoc":["Przemoc"], "rasizm/dyskryminacja":["Rasizm","Dyskryminacja"],
        "samobójstwo":["Samobójstwo"], "alkohol/alkoholizm":["Alkohol / alkoholizm"],
        "ciemność":["Ciemność"], "narkotyki/używki":["Narkotyki / używki"],
        "porzucenie/odrzucenie":["Porzucenie / odrzucenie"], "religia":["Religia"],
        "trauma/PTSD":["Trauma / PTSD"], "wojna":["Wojna"], "śmierć bliskiej osoby":["Śmierć bliskiej osoby"],
        "fakty historyczne":["Fakty historyczne"], "manipulacja":["Manipulacja"],
        "represje polityczne":["Represje polityczne"], "toksyczne relacje":["Toksyczne relacje"],
        "śmierć własna":["Śmierć własna"], "samotność":["Samotność"], "derealizacja":["Derealizacja"],
        "rytualne samobójstwo":["Samobójstwo"],
        "świętokradztwo (część zależna od karty postaci)":["Świętokradztwo"],
        "ludobójstwo":["Ludobójstwo"],
        "toksyczne/niesymetryczne relacje (władza starszych wampirów nad \"kochankami\")":["Toksyczne relacje"],
        "ciąża w niesprzyjających warunkach (możliwy wątek aborcji)":["Ciąża w niesprzyjających warunkach"],
        "bliskość fizyczna":["Bliskość fizyczna / dotyk"], "rozczarowania miłosne":["Rozczarowania miłosne"],
        "bunt maszyn":["Bunt maszyn"], "epidemia":["Epidemia"], "zombie":["Zombie"],
        "broń palna":["Broń palna"], "zmiana władzy":["Zmiana władzy"], "prostytucja":["Prostytucja"],
        "śmierć dzieci":["Utrata dziecka"], "bezsilność":["Bezsilność"], "wyparcie":["Wyparcie"],
        "okultyzm":["Okultyzm"], "szaleństwo":["Szaleństwo"], "strach":["Strach"],
        "romans":[], "żałoba":["Żałoba"], "przemowy i monologi":[], "miłość":[],
        "tortury":["Tortury"], "ekspozycja ciała / bielizna":["Ekspozycja ciała / bielizna"],
        "wulgarność":["Wulgarny język"], "agresja":["Agresja"], "seksizm":["Seksizm"],
        "AIDS":["AIDS"], "uzależnienia":["Uzależnienia"], "niepełna rodzina":["Niepełna rodzina"],
        "przemoc domowa":["Przemoc domowa"], "pornografia":["Pornografia"], "sekta":["Sekta"],
        "przemoc seksualna":["Przemoc seksualna"], "cierpienie":["Cierpienie"],
        "przemoc wobec zwierząt":["Przemoc wobec zwierząt"], "18+":[], "gra ruchowa":[],
        "dotyk i bliskość fizyczna (również w kontekście erotycznym)":["Bliskość fizyczna / dotyk","Treści erotyczne / zmysłowe"],
        "zmieniające się światło":["Zmieniające się światło"], "zmieniająca się muzyka":["Zmieniająca się muzyka"],
        "tematyka owadów (na grze nie pojawiają się prawdziwe owady, tylko ich symboliczne reprezentacje)":[],
        "motyw wykluczenia":["Wykluczenie / ostracyzm"],
        "wykorzystanie miodu jako rekwizytu (możliwość pobrudzenia)":[],
        "wymagane czarne/ciemne":[], "wygodne ubrania":[],
        "relacje patriarchalne":["Relacje patriarchalne"], "utrata dziecka":["Utrata dziecka"],
        "niechciana ciąża":["Niechciana ciąża"], "zemsta":["Zemsta"], "dehumanizacja":["Dehumanizacja"],
        "przymus":[], "brak nadziei/celu":["Brak nadziei / celu"], "nienawiść":[],
        "przemoc fizyczna":["Przemoc fizyczna"], "przemoc psychiczna":["Przemoc psychiczna"],
        "duchy":["Duchy"], "śmierć i żałoba":["Żałoba"], "poczucie winy":["Poczucie winy"],
        "potencjalne morderstwo i współudział w śmierci":["Morderstwo / zabójstwo"],
        "choroba terminalna":["Choroba terminalna"],
        "kryzys psychiczny i pobyt w instytucjach":["Kryzys psychiczny","Pobyt w instytucjach psychiatrycznych"],
        "nadużywanie substancji":["Uzależnienia"], "toksyczne i konfliktowe relacje":["Toksyczne relacje"],
        "zdrada oraz wrogość między postaciami":["Zdrada"],
        "opętanie i utrata kontroli nad własnym zachowaniem":["Opętanie i utrata kontroli nad ciałem"],
        "krzyk":["Krzyk"],
        "konwulsje i inne reakcje związane z opętaniem":["Opętanie i utrata kontroli nad ciałem"],
        "gore":["Gore"], "papierosy":["Papierosy"], "dramaty rodzinne":["Dramaty rodzinne"],
    }
    return m.get(raw, ["??"+raw])

SLOT_INFO = {
    "Piątek wieczór (18:00–22:00)": ("pt_wieczor", "Piątek wieczór", "18:00–22:00 (4h)"),
    "Sobota rano (10:00–15:00)": ("sb_rano", "Sobota rano", "10:00–15:00 (5h)"),
    "Sobota wieczór (17:00–22:00)": ("sb_wieczor", "Sobota wieczór", "17:00–22:00 (5h)"),
    # Dict key matches the source CSV's own column header text verbatim (for
    # lookup) — the CSV said 14:00, but the organiser corrected it to 15:00,
    # so only the output tuple's time string reflects the real slot time.
    "Niedziela rano (10:00–14:00)": ("nd_rano", "Niedziela rano", "10:00–15:00 (5h)"),
}

slots = {sid: {"id": sid, "name": name, "time": time, "larps": []} for sid, name, time in SLOT_INFO.values()}
unmapped_tags, unmapped_trigs = collections.Counter(), collections.Counter()

for r in rows:
    title = (r.get('﻿Tytuł') or r.get('Tytuł','')).strip()
    slot_raw = r.get('Slot w harmonogramie','').strip()
    sid, _, _ = SLOT_INFO[slot_raw]
    mx = r.get('Maks. graczy','').strip()
    mn = r.get('Min. graczy','').strip()
    players = int(mx) if mx else (int(mn) if mn else 0)

    tag_ids = []
    for t in split_top_level(r.get('Tagi','')):
        final = TAG_MAP.get(t, "??"+t)
        if final is None:
            continue
        if final.startswith("??"):
            unmapped_tags[t] += 1
            continue
        if final not in tag_ids:
            tag_ids.append(final)

    trig_labels = []
    for t in split_top_level(r.get('Triggery','')):
        for lab in trig_map(t):
            if lab.startswith("??"):
                unmapped_trigs[t] += 1
            elif lab not in trig_labels:
                trig_labels.append(lab)

    slots[sid]["larps"].append({
        "name": title,
        "players": players,
        "tags": tag_ids,
        "triggers": trig_labels,
    })

if unmapped_tags:
    print("UNMAPPED TAGS:", unmapped_tags)
if unmapped_trigs:
    print("UNMAPPED TRIGGERS:", unmapped_trigs)

result = {
    "_note": "Dane z arkusza organizatorów Krak-ON (2026-09-18) — tagi i triggery zunifikowane wspólnie z organizatorem z ~90/~93 surowych wariantów.",
    "preferenceTags": [{"id": i, "label": l} for i, l in PREF_TAGS],
    "triggerGroups": [{"id": i, "label": l, "triggers": t} for i, l, t in TRIGGER_GROUPS],
    "characterPreferences": ["Kobiece", "Męskie", "Niebinarne"],
    "ticketTiers": [
        {"id": "tworcy", "label": "Bilet dla Twórców (MG, opiekunów larpowych)", "price": "40 zł"},
        {"id": "spoleczny", "label": "Bilet Społeczny", "price": "40 zł"},
        {"id": "standardowy", "label": "Bilet Standardowy", "price": "100 zł"},
        {"id": "wsparcia", "label": "Bilet Wsparcia", "price": "140 zł"},
    ],
    "timeslots": [slots[sid] for sid, _, _ in SLOT_INFO.values()],
}

out_path = "larps_new.json"  # review the diff against zapisy-krak-on-frontend/larps.json before replacing it
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print("wrote", out_path)
print("Total larps:", sum(len(s["larps"]) for s in slots.values()))
