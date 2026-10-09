"""Tekstservice til Logearkiv: trækker tekst ud af PDF'er (pdftotext) og foreslår søgeord (se soegeord.py).

Directus kalder POST /hook fra et Flow, når filerne på en post i arkivmateriale ændres. Tjenesten svarer med det
samme og behandler posterne én ad gangen i baggrunden, så upload fra mobilen ikke venter, og en stor PDF ikke
låser maskinen. Den skriver kun dokumenttekst, foreslaaede_soegeord, tekststatus og tekst_opdateret - aldrig
soegeord (servicebrugeren har heller ikke rettighed til det).
"""
import asyncio
import logging
import os
import re
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Request

from soegeord import find_soegeord

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("tekstservice")


def _tal(navn: str, standard: int) -> int:
    return int(os.environ.get(navn) or standard)


DIRECTUS_URL = (os.environ.get("DIRECTUS_URL") or "http://directus:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN") or ""
MAX_FIL_MB = _tal("TEKST_MAX_FIL_MB", 50)      # større PDF'er behandles ikke (tekststatus = Fejl)
MAX_SIDER = _tal("TEKST_MAX_SIDER", 300)       # kun de første sider læses
PDF_TIMEOUT = _tal("TEKST_TIMEOUT_SEK", 120)   # pr. PDF
MAX_TEGN = 1_000_000                           # loft over dokumenttekst pr. post
MIN_TEGN_PR_SIDE = 50                          # under dette (uden mellemrum) regnes PDF'en som scannet
VENT_SEK = 2                                   # samler flere ændringer af samme post (fx tre billeder i træk)

OK, KRAEVER_OCR, IKKE_PDF, FEJL = "ok", "kraever_ocr", "ikke_pdf", "fejl"

FELTER = ",".join([
    "id", "dokumenttekst", "foreslaaede_soegeord", "tekststatus", "filer.id", "filer.sort",
    *(f"filer.directus_files_id.{f}" for f in ("id", "type", "filename_download", "filesize")),
])


http: httpx.AsyncClient
koe: asyncio.Queue
afventer: set[int] = set()
udestaaende = 0
taeller = {"behandlet": 0, "uaendret": 0, "ingen_filer": 0, OK: 0, KRAEVER_OCR: 0, IKKE_PDF: 0, FEJL: 0}


def rens(tekst: str) -> str:
    tekst = tekst.replace("\x00", "").replace("\f", "\n")  # PostgreSQL afviser NUL-tegn
    tekst = "\n".join(linje.rstrip() for linje in tekst.splitlines())
    return re.sub(r"\n{3,}", "\n\n", tekst).strip()


async def koer(*kommando: str, timeout: int = PDF_TIMEOUT) -> str:
    """Kører et poppler-værktøj med lav prioritet og tidsgrænse; returnerer stdout."""
    proces = await asyncio.create_subprocess_exec(
        "nice", "-n", "10", *kommando, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        ud, err = await asyncio.wait_for(proces.communicate(), timeout)
    except asyncio.TimeoutError:
        proces.kill()
        await proces.wait()
        raise RuntimeError(f"{kommando[0]} tog mere end {timeout} sekunder") from None
    if proces.returncode != 0:
        raise RuntimeError(f"{kommando[0]} fejlede: {err.decode(errors='replace').strip()[:300]}")
    return ud.decode("utf-8", errors="replace")


async def pdf_tekst(fil: dict) -> tuple[str, int]:
    """Henter PDF'en fra Directus og returnerer (tekst, antal læste sider)."""
    graense = MAX_FIL_MB * 1024 * 1024
    if int(fil.get("filesize") or 0) > graense:
        raise RuntimeError(f"filen er større end {MAX_FIL_MB} MB")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        hentet = 0
        async with http.stream("GET", f"/assets/{fil['id']}") as svar:
            svar.raise_for_status()
            async for stykke in svar.aiter_bytes():
                hentet += len(stykke)
                if hentet > graense:
                    raise RuntimeError(f"filen er større end {MAX_FIL_MB} MB")
                tmp.write(stykke)
        tmp.flush()
        info = await koer("pdfinfo", tmp.name, timeout=30)
        m = re.search(r"^Pages:\s+(\d+)", info, re.M)
        sider = int(m.group(1)) if m else 1
        tekst = await koer("pdftotext", "-l", str(MAX_SIDER), "-enc", "UTF-8", tmp.name, "-")
    if sider > MAX_SIDER:
        log.warning("%s har %d sider - kun de første %d er læst", fil.get("filename_download"), sider, MAX_SIDER)
    return rens(tekst), min(sider, MAX_SIDER)


async def udtraek(post: dict) -> dict:
    """Læser alle postens PDF'er og returnerer de felter, tjenesten ejer."""
    koblinger = [k for k in post.get("filer") or [] if isinstance(k.get("directus_files_id"), dict)]
    koblinger.sort(key=lambda k: (k.get("sort") is None, k.get("sort") or 0, k["id"]))
    filer = [k["directus_files_id"] for k in koblinger]
    if not filer:
        return {"dokumenttekst": None, "foreslaaede_soegeord": None, "tekststatus": None}
    pdfer = [f for f in filer if f.get("type") == "application/pdf"]
    if not pdfer:
        return {"dokumenttekst": None, "foreslaaede_soegeord": None, "tekststatus": IKKE_PDF}

    tekster: list[tuple[str, str]] = []
    fejl = mangler_ocr = False
    for fil in pdfer:
        navn = fil.get("filename_download") or fil["id"]
        try:
            tekst, sider = await pdf_tekst(fil)
        except Exception as e:  # én dårlig fil må ikke vælte de andre
            log.error("Post %s, fil %s (%s): %s", post["id"], fil["id"], navn, e or type(e).__name__)
            fejl = True
            continue
        if len(re.sub(r"\s", "", tekst)) < MIN_TEGN_PR_SIDE * sider:
            log.info("Post %s, fil %s (%s): intet tekstlag (%d sider) - kræver OCR", post["id"], fil["id"], navn, sider)
            mangler_ocr = True
            continue
        tekster.append((navn, tekst))

    samlet = "\n\n".join(f"===== {navn} =====\n{tekst}" for navn, tekst in tekster)[:MAX_TEGN]
    forslag = await asyncio.to_thread(find_soegeord, "\n\n".join(t for _, t in tekster)) if tekster else []
    return {
        "dokumenttekst": samlet or None,
        "foreslaaede_soegeord": forslag or None,
        "tekststatus": FEJL if fejl else KRAEVER_OCR if mangler_ocr else OK,
    }


async def gem(post_id: int, felter: dict) -> None:
    felter = {**felter, "tekst_opdateret": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (await http.patch(f"/items/arkivmateriale/{post_id}", params={"fields": "id"}, json=felter)).raise_for_status()


async def behandl(post_id: int) -> None:
    start = time.monotonic()
    try:
        svar = await http.get(f"/items/arkivmateriale/{post_id}", params={"fields": FELTER})
        if svar.status_code in (403, 404):
            log.info("Post %s findes ikke (længere) - springer over", post_id)
            return
        svar.raise_for_status()
        post = svar.json()["data"]
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
        post_id, klar = await koe.get()
        try:
            await asyncio.sleep(max(0.0, klar - time.monotonic()))
            afventer.discard(post_id)  # ændringer herfra sætter posten i kø igen
            await behandl(post_id)
        finally:
            udestaaende -= 1


def saet_i_koe(ids) -> int:
    global udestaaende
    nye = 0
    for post_id in ids:
        if post_id not in afventer:
            afventer.add(post_id)
            koe.put_nowait((post_id, time.monotonic() + VENT_SEK))
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
    http = httpx.AsyncClient(base_url=DIRECTUS_URL, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=60)
    koe = asyncio.Queue()
    opgave = asyncio.create_task(arbejder())
    log.info("Tekstservice klar (max %d MB, %d sider, %d s pr. PDF)", MAX_FIL_MB, MAX_SIDER, PDF_TIMEOUT)
    yield
    opgave.cancel()
    await http.aclose()


app = FastAPI(title="Logearkiv tekstservice", lifespan=levetid, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/sundhed")
async def sundhed():
    return {"ok": True}


@app.get("/status")
async def status():
    return {"udestaaende": udestaaende, "token": bool(TOKEN), **taeller}


@app.post("/hook", status_code=202)
async def hook(request: Request):
    """Kaldes af Directus-flowet med $trigger (event-flow) eller $trigger.body (knappen "Udtræk tekst igen")."""
    try:
        krop = await request.json()
        ids = await poster_fra_hook(krop if isinstance(krop, dict) else {})
    except Exception:
        log.exception("Kunne ikke læse kaldet fra Directus")
        ids = []
    return {"sat_i_koe": saet_i_koe(ids)}


@app.post("/backfill", status_code=202)
async def backfill():
    """Sætter alle poster i arkivmateriale i kø (bruges af scripts/backfill.sh)."""
    svar = await http.get("/items/arkivmateriale", params={"fields": "id", "sort": "id", "limit": -1})
    svar.raise_for_status()
    ids = [r["id"] for r in svar.json()["data"]]
    return {"poster": len(ids), "sat_i_koe": saet_i_koe(ids)}
