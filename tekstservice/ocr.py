"""OCR til tekstservicen: tesseract (dansk + engelsk) direkte på billeder og ocrmypdf på PDF'er. Alt kører lokalt.

Billeder gøres først klar: EXIF-rotation følges, store mobilfotos skaleres ned til ca. 300 dpi på en A4-side, og
skæve fotos rettes op, så linjerne læses hele. Alle værktøjer kører med lav prioritet (nice) og på én kerne.
"""
import asyncio
import os
import re
from pathlib import Path

import img2pdf
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()  # HEIC/HEIF fra iPhone


def _tal(navn: str, standard: int) -> int:
    return int(os.environ.get(navn) or standard)


SLAAET_TIL = (os.environ.get("OCR_SLAAET_TIL") or "true").strip().lower() not in ("false", "0", "nej", "no")
MAX_SIDER = _tal("OCR_MAX_SIDER", 50)          # højst så mange sider OCR'es pr. PDF (og billeder pr. samlet PDF)
TIMEOUT_PR_SIDE = _tal("OCR_TIMEOUT_SEK", 120)  # pr. side/billede; en PDF får sider × dette
MAX_MEGAPIXEL = _tal("OCR_MAX_MEGAPIXEL", 20)  # større billeder/scannede sider OCR'es ikke (hukommelse, se README)
SPROG = "dan+eng"
LANG_SIDE = 3508                                # A4 ved 300 dpi er 2480 × 3508 billedpunkter
MIN_BOGSTAVER = 20                              # under dette regnes OCR-resultatet ikke som brugbar tekst
MAX_SKAEVHED, TRIN = 8.0, 0.5                   # grader


async def koer(*kommando: str, timeout: int) -> str:
    """Kører et værktøj med lav prioritet og tidsgrænse; returnerer stdout."""
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
        raise RuntimeError(f"{kommando[0]} fejlede: {err.decode(errors='replace').strip()[-300:]}")
    return ud.decode("utf-8", errors="replace")


def brugbar(tekst: str) -> bool:
    return len(re.findall(r"[^\W\d_]", tekst)) >= MIN_BOGSTAVER


def _skaevhed(im: Image.Image) -> float:
    """Den drejning, der giver de skarpeste tekstlinjer: størst udsving mellem rækkernes middelværdi."""
    g = ImageOps.autocontrast(im.convert("L"))
    g.thumbnail((700, 700))
    b, h = g.size
    midt = g.crop((b // 6, h // 6, b - b // 6, h - h // 6))  # kanten (bordpladen) siger ikke noget om teksten
    bedst, bedste = 0.0, -1
    for n in range(int(2 * MAX_SKAEVHED / TRIN) + 1):
        vinkel = -MAX_SKAEVHED + n * TRIN
        r = midt.rotate(vinkel, resample=Image.BILINEAR, fillcolor=255)
        raekker = r.resize((1, r.height), Image.BOX).tobytes()
        udsving = sum((x - y) ** 2 for x, y in zip(raekker, raekker[1:]))
        if udsving > bedste:
            bedst, bedste = vinkel, udsving
    return bedst


def _tjek_stoerrelse(bredde: int, hoejde: int) -> None:
    mp = bredde * hoejde / 1_000_000
    if mp > MAX_MEGAPIXEL:
        raise RuntimeError(f"{mp:.0f} megapixel er over grænsen på {MAX_MEGAPIXEL} (OCR_MAX_MEGAPIXEL) - OCR'es ikke")


def klargoer(kilde: str, maal: str) -> None:
    """Gemmer billedet som en OCR-egnet JPEG: rigtig vej op, højst LANG_SIDE på den lange led, rettet op."""
    with Image.open(kilde) as im:
        _tjek_stoerrelse(*im.size)
        im.draft("RGB", (LANG_SIDE, LANG_SIDE))  # JPEG afkodes direkte i mindre størrelse: hurtigere, mindre RAM
        im = ImageOps.exif_transpose(im)
        im.thumbnail((LANG_SIDE, LANG_SIDE))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            hvid = Image.new("RGB", im.size, (255, 255, 255))
            hvid.paste(im, mask=im.getchannel("A"))
            im = hvid
        im = im.convert("RGB")
        vinkel = _skaevhed(im)
        if abs(vinkel) >= TRIN:
            im = im.rotate(vinkel, resample=Image.BICUBIC, fillcolor=(255, 255, 255))
        im.save(maal, "JPEG", quality=85, dpi=(300, 300))


async def billede_tekst(kilde: str, mappe: str) -> str:
    """OCR af ét billede; returnerer teksten (kan være tom)."""
    klar = str(Path(mappe) / "klar.jpg")
    await asyncio.to_thread(klargoer, kilde, klar)
    return await koer("tesseract", klar, "stdout", "-l", SPROG, timeout=TIMEOUT_PR_SIDE)


async def pdf_ocr(ind: str, ud: str, sider: int) -> None:
    """Laver en søgbar kopi af en scannet PDF. Sider, der allerede har tekst, røres ikke (--skip-text)."""
    antal = min(sider, MAX_SIDER)
    # Sidernes billeder må ikke være større end grænsen (en farvescanning i 600 dpi bruger over 600 MB under OCR).
    for linje in (await koer("pdfimages", "-list", "-l", str(antal), ind, timeout=60)).splitlines()[2:]:
        felter = linje.split()
        if len(felter) > 4 and felter[3].isdigit() and felter[4].isdigit():
            _tjek_stoerrelse(int(felter[3]), int(felter[4]))
    ekstra = ["--pages", f"1-{antal}"] if sider > MAX_SIDER else []
    await koer("ocrmypdf", "-l", SPROG, "--skip-text", "--rotate-pages", "--deskew", "--jobs", "1",
               "--output-type", "pdf", "--quiet", *ekstra, ind, ud, timeout=TIMEOUT_PR_SIDE * antal)


async def saml_pdf(billeder: list[str], ud: str, mappe: str) -> None:
    """Samler billeder (i den givne rækkefølge) til én søgbar PDF."""
    klare = []
    for n, kilde in enumerate(billeder):
        klar = str(Path(mappe) / f"side{n:03d}.jpg")
        await asyncio.to_thread(klargoer, kilde, klar)
        klare.append(klar)
    raa = str(Path(mappe) / "samlet.pdf")
    Path(raa).write_bytes(await asyncio.to_thread(img2pdf.convert, klare))
    # Siderne er allerede vendt og rettet op i klargoer, så ocrmypdf skal kun lægge tekstlaget på.
    await koer("ocrmypdf", "-l", SPROG, "--jobs", "1", "--output-type", "pdf", "--quiet", raa, ud,
               timeout=TIMEOUT_PR_SIDE * len(klare))
