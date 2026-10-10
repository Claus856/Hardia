"""Tekstservice til Logearkiv: trækker tekst ud af PDF'er (pdftotext), OCR'er scanninger og fotos (se ocr.py)
og foreslår søgeord (se soegeord.py).

Kun filer, hvor arkivaren har sat hak i "Søgbar tekst" på posten (soegbar på koblingen arkivmateriale_files), hentes
og læses. Alle andre filer røres ikke, og der gemmes ingen tekst fra dem (servicebrugeren kan heller ikke hente dem).

Directus kalder POST /hook fra et Flow, når filerne på en post i arkivmateriale ændres, og POST /saml fra knappen
"Saml billeder til søgbar PDF". Tjenesten svarer med det samme og behandler posterne én ad gangen i baggrunden, så
upload fra mobilen ikke venter, og en stor PDF ikke låser maskinen.

På posten skriver den kun dokumenttekst, foreslaaede_soegeord, tekststatus og tekst_opdateret - aldrig soegeord.
På koblingen skriver den kun ocr_*-felterne, og den opretter kun koblinger til sine egne søgbare PDF'er.
Den sletter og overskriver aldrig andres filer (servicebrugeren har heller ikke rettighed til det).

Tjenestens egne filer kendes på ocr_type på koblingen:
  scanning  søgbar kopi af én scannet PDF (ocr_kilder = [den scannede fils id])
  samlet    postens billeder samlet til én søgbar PDF (ocr_kilder = billedernes id'er i rækkefølge)
En sådan PDF følger hakket på sine kilder og tælles i stedet for dem, så teksten ikke kommer med to gange.
"""
import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Request

import ocr
from soegeord import find_soegeord

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("tekstservice")


def _tal(navn: str, standard: int) -> int:
    return int(os.environ.get(navn) or standard)


DIRECTUS_URL = (os.environ.get("DIRECTUS_URL") or "http://directus:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN") or ""
MAX_FIL_MB = _tal("TEKST_MAX_FIL_MB", 50)      # større filer behandles ikke (tekststatus = Fejl)
MAX_SIDER = _tal("TEKST_MAX_SIDER", 300)       # kun de første sider læses med pdftotext
PDF_TIMEOUT = _tal("TEKST_TIMEOUT_SEK", 120)   # pr. PDF (pdftotext)
MAX_TEGN = 1_000_000                           # loft over dokumenttekst pr. post
MIN_TEGN_PR_SIDE = 50                          # under dette (uden mellemrum) regnes PDF'en som scannet
VENT_SEK = 2                                   # samler flere ændringer af samme post (fx tre billeder i træk)
OCR_MAPPE = "OCR"                              # mappe i filbiblioteket til tjenestens søgbare PDF'er

OK, OCR, KRAEVER_OCR, IKKE_PDF, IKKE_VALGT, FEJL = "ok", "ocr", "kraever_ocr", "ikke_pdf", "ikke_valgt", "fejl"
SCANNING, SAMLET = "scanning", "samlet"
PDF = "application/pdf"

FELTER = ",".join([
    "id", "dokumenttekst", "foreslaaede_soegeord", "tekststatus",
    *(f"filer.{f}" for f in ("id", "sort", "soegbar", "ocr_type", "ocr_kilder", "ocr_tekst", "ocr_version")),
    *(f"filer.directus_files_id.{f}" for f in ("id", "type", "filename_download", "filesize", "modified_on", "uploaded_on")),
])


http: httpx.AsyncClient
koe: asyncio.Queue
afventer: set[tuple[str, int]] = set()
udestaaende = 0
mappe_id: str | None = None
taeller = {"behandlet": 0, "uaendret": 0, "ingen_filer": 0, OK: 0, OCR: 0, KRAEVER_OCR: 0, IKKE_PDF: 0, IKKE_VALGT: 0,
           FEJL: 0, "ocr_sider": 0, "ocr_sekunder": 0.0, "nye_filer": 0}


def rens(tekst: str) -> str:
    tekst = tekst.replace("\x00", "").replace("\f", "\n")  # PostgreSQL afviser NUL-tegn
    tekst = "\n".join(linje.rstrip() for linje in tekst.splitlines())
    return re.sub(r"\n{3,}", "\n\n", tekst).strip()


def fil_af(kobling: dict) -> dict | None:
    """Filens oplysninger, hvis tjenesten må se den (valgt til søgning eller lavet af tjenesten selv)."""
    f = kobling.get("directus_files_id")
    return f if isinstance(f, dict) else None


def aftryk(fil: dict) -> str:
    """Skifter, når filen udskiftes eller redigeres, så gammel OCR ikke genbruges til nyt indhold."""
    return f"{fil.get('filesize')}:{fil.get('modified_on') or fil.get('uploaded_on')}"


def er_billede(fil: dict) -> bool:
    return (fil.get("type") or "").startswith("image/")


def raekkefoelge(k: dict):
    fil = fil_af(k) or {}
    return (k.get("sort") is None, k.get("sort") or 0, fil.get("uploaded_on") or "", k["id"])


async def hent(fil: dict, sti: str) -> None:
    graense = MAX_FIL_MB * 1024 * 1024
    if int(fil.get("filesize") or 0) > graense:
        raise RuntimeError(f"filen er større end {MAX_FIL_MB} MB")
    hentet = 0
    with open(sti, "wb") as ud:
        async with http.stream("GET", f"/assets/{fil['id']}") as svar:
            svar.raise_for_status()
            async for stykke in svar.aiter_bytes():
                hentet += len(stykke)
                if hentet > graense:
                    raise RuntimeError(f"filen er større end {MAX_FIL_MB} MB")
                ud.write(stykke)


async def pdf_tekst(sti: str, navn: str) -> tuple[str, int]:
    """Returnerer (tekst fra tekstlaget, antal læste sider)."""
    info = await ocr.koer("pdfinfo", sti, timeout=30)
    m = re.search(r"^Pages:\s+(\d+)", info, re.M)
    sider = int(m.group(1)) if m else 1
    tekst = await ocr.koer("pdftotext", "-l", str(MAX_SIDER), "-enc", "UTF-8", sti, "-", timeout=PDF_TIMEOUT)
    if sider > MAX_SIDER:
        log.warning("%s har %d sider - kun de første %d er læst", navn, sider, MAX_SIDER)
    return rens(tekst), sider


def har_tekstlag(tekst: str, sider: int) -> bool:
    return len(re.sub(r"\s", "", tekst)) >= MIN_TEGN_PR_SIDE * min(sider, MAX_SIDER)


async def ret_kobling(kobling_id: int, felter: dict) -> None:
    (await http.patch(f"/items/arkivmateriale_files/{kobling_id}", params={"fields": "id"}, json=felter)).raise_for_status()


async def ocr_mappe() -> str | None:
    global mappe_id
    if mappe_id is None:
        svar = await http.get("/folders", params={"filter[name][_eq]": OCR_MAPPE, "fields": "id", "limit": 1})
        if svar.status_code == 200 and svar.json()["data"]:
            mappe_id = svar.json()["data"][0]["id"]
    return mappe_id


def sidst(post: dict) -> int | None:
    """Sorteringsnummer, der stiller en ny fil sidst på posten (None, hvis filerne ikke er sorteret)."""
    numre = [k["sort"] for k in post.get("filer") or [] if isinstance(k, dict) and k.get("sort") is not None]
    return max(numre) + 1 if numre else None


async def gem_egen_pdf(post: dict, sti: str, navn: str, beskrivelse: str, kobling: dict, eksisterende: dict | None) -> None:
    """Lægger en søgbar PDF på posten. Findes tjenestens PDF allerede, udskiftes dens indhold (samme fil, ingen dublet)."""
    post_id = post["id"]
    data = {"title": Path(navn).stem, "description": beskrivelse}
    egen = fil_af(eksisterende) if eksisterende else None
    with open(sti, "rb") as f:
        filer = {"file": (navn, f, PDF)}
        if egen:
            (await http.patch(f"/files/{egen['id']}", params={"fields": "id"}, data=data, files=filer)).raise_for_status()
            await ret_kobling(eksisterende["id"], kobling)
            log.info("Post %s: indholdet af %s (fil %s) er udskiftet", post_id, navn, egen["id"])
            return
        mappe = await ocr_mappe()
        svar = await http.post("/files", params={"fields": "id"}, data={**({"folder": mappe} if mappe else {}), **data}, files=filer)
    svar.raise_for_status()
    fil_id = svar.json()["data"]["id"]
    # Knyttes til posten med det samme, så filen følger postens grad (indtil da er den skjult for medlemmer).
    (await http.post("/items/arkivmateriale_files", params={"fields": "id"}, json={
        "arkivmateriale_id": post_id, "directus_files_id": fil_id, "soegbar": True, "sort": sidst(post), **kobling,
    })).raise_for_status()
    taeller["nye_filer"] += 1
    log.info("Post %s: ny fil %s (%s) lagt på posten", post_id, navn, fil_id)


def soegbart_navn(navn: str) -> str:
    return f"{Path(navn).stem} (søgbar).pdf"


def opdel(post: dict) -> tuple[list[dict], dict[str, dict], list[dict]]:
    """Deler postens koblinger i (almindelige filer, søgbare kopier pr. scannet fil, samlede PDF'er).

    En af tjenestens PDF'er, hvis kilder alle er fjernet fra posten, regnes som en almindelig fil: så bestemmer
    dens eget hak (arkivaren har fx beholdt den søgbare PDF og fjernet den store scanning)."""
    koblinger = sorted((k for k in post.get("filer") or [] if isinstance(k, dict)), key=raekkefoelge)
    paa_posten = {k.get("fil_id") for k in koblinger if not k.get("ocr_type")}
    almindelige, kopier, samlede = [], {}, []
    for k in koblinger:
        kilder = [x for x in (k.get("ocr_kilder") or []) if isinstance(x, str)]
        if not k.get("ocr_type") or not any(x in paa_posten for x in kilder):
            almindelige.append(k)
        elif k["ocr_type"] == SCANNING:
            kopier.setdefault(kilder[0], k)
        else:
            samlede.append(k)
    return almindelige, kopier, samlede


async def hent_post(post_id: int) -> dict | None:
    """Posten med dens koblinger. Hver kobling får fil_id, også for fravalgte filer, som tjenesten ellers ikke kan se."""
    svar = await http.get(f"/items/arkivmateriale/{post_id}", params={"fields": FELTER})
    if svar.status_code in (403, 404):
        return None
    svar.raise_for_status()
    post = svar.json()["data"]
    raa = await http.get("/items/arkivmateriale_files", params={
        "filter[arkivmateriale_id][_eq]": post_id, "fields": "id,directus_files_id", "limit": -1,
    })
    raa.raise_for_status()
    fil_id = {r["id"]: r["directus_files_id"] for r in raa.json()["data"]}
    for k in post.get("filer") or []:
        if isinstance(k, dict):
            k["fil_id"] = fil_id.get(k["id"])
    return post


async def udtraek(post: dict) -> dict:
    """Læser de af postens filer, der er valgt til søgning, og returnerer de felter, tjenesten ejer."""
    tom = {"dokumenttekst": None, "foreslaaede_soegeord": None}
    almindelige, kopier, samlede = opdel(post)
    if not almindelige and not kopier and not samlede:
        return {**tom, "tekststatus": None}

    # Kun et aktivt tilvalg tæller. Uden det hentes filen ikke, og OCR-tekst fra et tidligere tilvalg fjernes.
    for k in almindelige:
        if k.get("soegbar") is not True and (k.get("ocr_tekst") is not None or k.get("ocr_version")):
            await ret_kobling(k["id"], {"ocr_tekst": None, "ocr_version": None})
    valgte = [k for k in almindelige if k.get("soegbar") is True and fil_af(k)]
    if not valgte:
        return {**tom, "tekststatus": IKKE_VALGT}

    # En samlet PDF gælder, når alle dens billeder stadig er valgt. Så bruges dens tekst i stedet for billedernes.
    valgte_ids = {fil_af(k)["id"] for k in valgte}
    samlet = next((s for s in samlede if fil_af(s) and all(x in valgte_ids for x in s.get("ocr_kilder") or [])), None)
    daekket = set(samlet.get("ocr_kilder") or []) if samlet else set()

    tekster: list[tuple[str, str]] = []
    fejl = mangler = fra_ocr = laesbar = False
    with tempfile.TemporaryDirectory() as mappe:
        sti = str(Path(mappe) / "fil")
        for k in valgte:
            fil = fil_af(k)
            navn = fil.get("filename_download") or fil["id"]
            try:
                if fil["id"] in daekket:
                    if samlet:  # teksten sættes ind, hvor det første af billederne står
                        egen = fil_af(samlet)
                        await hent(egen, sti)
                        tekst, _ = await pdf_tekst(sti, egen.get("filename_download") or egen["id"])
                        tekster.append((egen.get("filename_download") or egen["id"], tekst))
                        samlet, laesbar, fra_ocr = None, True, True
                    continue
                if fil.get("type") == PDF:
                    laesbar = True
                    await hent(fil, sti)
                    tekst, sider = await pdf_tekst(sti, navn)
                    if har_tekstlag(tekst, sider):
                        tekster.append((navn, tekst))
                        fra_ocr = fra_ocr or bool(k.get("ocr_type"))  # tjenestens egen PDF, hvis kilder er fjernet
                        continue
                    if tekst:
                        tekster.append((navn, tekst))  # den smule tekst, en ellers scannet PDF har
                    resultat = await scannet_pdf(post, k, fil, navn, sti, sider, kopier.get(fil["id"]), mappe)
                    if resultat is None:
                        log.info("Post %s, fil %s (%s): intet tekstlag (%d sider) - kræver OCR", post["id"], fil["id"], navn, sider)
                        mangler = True
                    else:
                        if tekst:
                            tekster.pop()
                        tekster.append(resultat)
                        fra_ocr = True
                elif er_billede(fil) and (ocr.SLAAET_TIL or k.get("ocr_version") == aftryk(fil)):  # fra: kun gemt OCR-tekst
                    laesbar = True
                    tekst = await billede(post["id"], k, fil, navn, sti, mappe)
                    if ocr.brugbar(tekst):
                        tekster.append((navn, tekst))
                        fra_ocr = True
                    else:
                        log.info("Post %s, fil %s (%s): OCR fandt ingen brugbar tekst", post["id"], fil["id"], navn)
                        mangler = True
            except Exception as e:  # én dårlig fil må ikke vælte de andre
                log.error("Post %s, fil %s (%s): %s", post["id"], fil["id"], navn, e or type(e).__name__)
                fejl = True

    samlet_tekst = "\n\n".join(f"===== {navn} =====\n{tekst}" for navn, tekst in tekster)[:MAX_TEGN]
    forslag = await asyncio.to_thread(find_soegeord, "\n\n".join(t for _, t in tekster)) if tekster else []
    status = FEJL if fejl else KRAEVER_OCR if mangler else IKKE_PDF if not laesbar else OCR if fra_ocr else OK
    return {"dokumenttekst": samlet_tekst or None, "foreslaaede_soegeord": forslag or None, "tekststatus": status}


async def scannet_pdf(post: dict, k: dict, fil: dict, navn: str, sti: str, sider: int, kopi: dict | None,
                      mappe: str) -> tuple[str, str] | None:
    """Tekst fra den søgbare kopi af en scannet PDF (laves ved første behandling). None = ingen brugbar tekst."""
    post_id = post["id"]
    nu = aftryk(fil)
    ud = str(Path(mappe) / "ocr.pdf")
    if kopi and kopi.get("ocr_version") == nu and fil_af(kopi):  # genbruges også, når OCR er slået fra
        egen = fil_af(kopi)
        await hent(egen, ud)
        tekst, _ = await pdf_tekst(ud, egen.get("filename_download") or egen["id"])
        return (egen.get("filename_download") or soegbart_navn(navn), tekst) if ocr.brugbar(tekst) else None
    if not ocr.SLAAET_TIL:
        return None
    if k.get("ocr_version") == nu and k.get("ocr_tekst") == "":
        return None  # OCR er prøvet på netop denne fil og fandt intet (fx håndskrift); prøves ikke igen
    start = time.monotonic()
    await ocr.pdf_ocr(sti, ud, sider)
    maalt(post_id, navn, min(sider, ocr.MAX_SIDER), start)
    if sider > ocr.MAX_SIDER:
        log.warning("Post %s: %s har %d sider - kun de første %d er OCR'et", post_id, navn, sider, ocr.MAX_SIDER)
    tekst, _ = await pdf_tekst(ud, navn)
    if not ocr.brugbar(tekst):
        await ret_kobling(k["id"], {"ocr_tekst": "", "ocr_version": nu})
        return None
    nyt_navn = soegbart_navn(navn)
    await gem_egen_pdf(post, ud, nyt_navn, f"Søgbar kopi (OCR) af {navn}, lavet automatisk af tekstservicen.",
                       {"ocr_type": SCANNING, "ocr_kilder": [fil["id"]], "ocr_version": nu}, kopi)
    return nyt_navn, tekst


async def billede(post_id: int, k: dict, fil: dict, navn: str, sti: str, mappe: str) -> str:
    """OCR-tekst for ét billede. Gemmes på koblingen, så billedet kun OCR'es én gang."""
    nu = aftryk(fil)
    if k.get("ocr_version") == nu and k.get("ocr_tekst") is not None:
        return k["ocr_tekst"]
    await hent(fil, sti)
    start = time.monotonic()
    tekst = rens(await ocr.billede_tekst(sti, mappe))
    maalt(post_id, navn, 1, start)
    await ret_kobling(k["id"], {"ocr_tekst": tekst, "ocr_version": nu})
    return tekst


def maalt(post_id: int, navn: str, sider: int, start: float) -> None:
    sek = time.monotonic() - start
    taeller["ocr_sider"] += sider
    taeller["ocr_sekunder"] = round(taeller["ocr_sekunder"] + sek, 1)
    log.info("Post %s: OCR af %s, %d side(r), %.1f s (%.1f s pr. side)", post_id, navn, sider, sek, sek / max(sider, 1))


async def saml(post_id: int) -> None:
    """Knappen "Saml billeder til søgbar PDF": postens valgte billeder i filrækkefølge -> én PDF med tekstlag."""
    if not ocr.SLAAET_TIL:
        log.info("Post %s: OCR er slået fra - billederne samles ikke", post_id)
        return
    post = await hent_post(post_id)
    if post is None:
        return
    almindelige, _, samlede = opdel(post)
    billeder = [k for k in almindelige if k.get("soegbar") is True and fil_af(k) and er_billede(fil_af(k))]
    if not billeder:
        log.info("Post %s: ingen billeder er valgt til søgning - der er intet at samle", post_id)
        return
    if len(billeder) > ocr.MAX_SIDER:
        log.warning("Post %s: %d billeder - kun de første %d samles", post_id, len(billeder), ocr.MAX_SIDER)
        billeder = billeder[: ocr.MAX_SIDER]
    kilder = [fil_af(k)["id"] for k in billeder]
    version = hashlib.sha1("|".join(f"{fil_af(k)['id']}={aftryk(fil_af(k))}" for k in billeder).encode()).hexdigest()
    eksisterende = next((s for s in samlede if fil_af(s)), None)
    if eksisterende and eksisterende.get("ocr_kilder") == kilder and eksisterende.get("ocr_version") == version:
        log.info("Post %s: den samlede PDF svarer allerede til de valgte billeder - uændret", post_id)
        return
    with tempfile.TemporaryDirectory() as mappe:
        stier = []
        for n, k in enumerate(billeder):
            stier.append(str(Path(mappe) / f"kilde{n:03d}"))
            await hent(fil_af(k), stier[-1])
        ud = str(Path(mappe) / "ud.pdf")
        start = time.monotonic()
        await ocr.saml_pdf(stier, ud, mappe)
        maalt(post_id, "samlet PDF", len(billeder), start)
        await gem_egen_pdf(post, ud, "Samlet (søgbar).pdf",
                           f"Postens {len(billeder)} billeder samlet til én søgbar PDF (OCR) af tekstservicen.",
                           {"ocr_type": SAMLET, "ocr_kilder": kilder, "ocr_version": version}, eksisterende)


async def gem(post_id: int, felter: dict) -> None:
    felter = {**felter, "tekst_opdateret": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (await http.patch(f"/items/arkivmateriale/{post_id}", params={"fields": "id"}, json=felter)).raise_for_status()


async def behandl(post_id: int) -> None:
    start = time.monotonic()
    try:
        post = await hent_post(post_id)
        if post is None:
            log.info("Post %s findes ikke (længere) - springer over", post_id)
            return
        ny = await udtraek(post)
        taeller["behandlet"] += 1
        taeller[ny["tekststatus"] or "ingen_filer"] += 1
        # Uændret resultat skrives ikke igen: ingen støj i historikken, og backfill kan køres flere gange.
        if all((post.get(f) or None) == ny[f] for f in ny):
            taeller["uaendret"] += 1
            log.info("Post %s: uændret (%s)", post_id, ny["tekststatus"] or "ingen filer")
            return
        await gem(post_id, ny)
        log.info("Post %s: %s, %d tegn, %d forslag, %.1f s", post_id, ny["tekststatus"] or "ingen filer",
                 len(ny["dokumenttekst"] or ""), len(ny["foreslaaede_soegeord"] or []), time.monotonic() - start)
    except Exception:
        log.exception("FEJL ved behandling af post %s", post_id)
        taeller[FEJL] += 1
        try:
            await gem(post_id, {"tekststatus": FEJL})
        except Exception:
            log.exception("Kunne ikke sætte tekststatus = Fejl på post %s", post_id)


async def arbejder() -> None:
    global udestaaende
    while True:
        opgave, post_id, klar = await koe.get()
        try:
            await asyncio.sleep(max(0.0, klar - time.monotonic()))
            afventer.discard((opgave, post_id))  # ændringer herfra sætter posten i kø igen
            if opgave == "saml":
                try:
                    await saml(post_id)
                except Exception:
                    log.exception("FEJL ved samling af billeder på post %s", post_id)
            await behandl(post_id)
        finally:
            udestaaende -= 1


def saet_i_koe(ids, opgave: str = "tekst") -> int:
    global udestaaende
    nye = 0
    for post_id in ids:
        if (opgave, post_id) not in afventer:
            afventer.add((opgave, post_id))
            koe.put_nowait((opgave, post_id, time.monotonic() + VENT_SEK))
            udestaaende += 1
            nye += 1
    return nye


def heltal(vaerdi) -> list[int]:
    """Nøgler fra Directus kan være tal, tekst, lister eller {id: …}."""
    if isinstance(vaerdi, dict):
        return heltal(vaerdi.get("id"))
    if isinstance(vaerdi, (list, tuple)):
        return [i for v in vaerdi for i in heltal(v)]
    if isinstance(vaerdi, bool) or vaerdi is None:
        return []
    return [int(vaerdi)] if str(vaerdi).isdigit() else []


async def poster_fra_hook(krop: dict) -> list[int]:
    noegler = heltal(krop.get("key")) + heltal(krop.get("keys"))
    if krop.get("collection") == "arkivmateriale":
        return noegler
    if krop.get("collection") == "arkivmateriale_files":
        payload = krop.get("payload")
        direkte = heltal(payload.get("arkivmateriale_id")) if isinstance(payload, dict) else []
        if direkte or not noegler:
            return direkte
        svar = await http.get("/items/arkivmateriale_files", params={
            "filter[id][_in]": ",".join(map(str, noegler)), "fields": "arkivmateriale_id", "limit": -1,
        })
        svar.raise_for_status()
        return heltal([r.get("arkivmateriale_id") for r in svar.json()["data"]])
    return []


@asynccontextmanager
async def levetid(_: FastAPI):
    global http, koe
    if not TOKEN:
        log.error("DIRECTUS_TOKEN mangler: sæt TEKSTSERVICE_TOKEN i .env (kør ./setup.sh) og ./scripts/provision.sh")
    http = httpx.AsyncClient(base_url=DIRECTUS_URL, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=120)
    koe = asyncio.Queue()
    opgave = asyncio.create_task(arbejder())
    log.info("Tekstservice klar (max %d MB, %d sider, %d s pr. PDF; OCR %s, max %d sider, %d s pr. side)", MAX_FIL_MB,
             MAX_SIDER, PDF_TIMEOUT, "slået til" if ocr.SLAAET_TIL else "slået FRA", ocr.MAX_SIDER, ocr.TIMEOUT_PR_SIDE)
    yield
    opgave.cancel()
    await http.aclose()


app = FastAPI(title="Logearkiv tekstservice", lifespan=levetid, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/sundhed")
async def sundhed():
    return {"ok": True}


@app.get("/status")
async def status():
    return {"udestaaende": udestaaende, "token": bool(TOKEN), "ocr_slaaet_til": ocr.SLAAET_TIL, **taeller}


async def _ids(request: Request) -> list[int]:
    try:
        krop = await request.json()
        return await poster_fra_hook(krop if isinstance(krop, dict) else {})
    except Exception:
        log.exception("Kunne ikke læse kaldet fra Directus")
        return []


@app.post("/hook", status_code=202)
async def hook(request: Request):
    """Kaldes af Directus-flowet med $trigger (event-flow) eller $trigger.body (knappen "Udtræk tekst igen")."""
    return {"sat_i_koe": saet_i_koe(await _ids(request))}


@app.post("/saml", status_code=202)
async def saml_hook(request: Request):
    """Kaldes af knappen "Saml billeder til søgbar PDF" med $trigger.body."""
    return {"sat_i_koe": saet_i_koe(await _ids(request), "saml")}


@app.post("/backfill", status_code=202)
async def backfill():
    """Sætter alle poster i arkivmateriale i kø (bruges af scripts/backfill.sh)."""
    svar = await http.get("/items/arkivmateriale", params={"fields": "id", "sort": "id", "limit": -1})
    svar.raise_for_status()
    ids = [r["id"] for r in svar.json()["data"]]
    return {"poster": len(ids), "sat_i_koe": saet_i_koe(ids)}
