"""Forslag til søgeord uden AI-model: ord, der er sjældne i almindeligt dansk, men står i dokumentet, plus egennavne.

Hvert ord vægtes med (1 + ln antal i dokumentet) × ln rang i ordfrekvens_da.txt (ukendte ord tæller som meget
sjældne - det er typisk sammensatte ord og navne). Bøjningsformer slås sammen, og navne på flere ord holdes samlet.
"""
import math
import re
from collections import Counter
from pathlib import Path

ANTAL = 12
MIN_RANG = 2500          # ord blandt de 2500 hyppigste i dansk foreslås ikke (medmindre de er egennavne)
MAX_TEGN = 300_000       # kun begyndelsen af meget lange tekster gennemgås
NAVNEBONUS = 1.5
GAMMEL_RETSKRIVNING = 0.12  # er over 12 % af ordene midt i sætninger med stort, er det navneord (før 1948), ikke navne

_her = Path(__file__).parent


def _linjer(navn: str) -> list[str]:
    tekst = (_her / navn).read_text(encoding="utf-8")
    return [l.strip().lower() for l in tekst.splitlines() if l.strip() and not l.startswith("#")]


RANG = {o: i for i, o in reversed(list(enumerate(_linjer("ordfrekvens_da.txt"), 1)))}
UKENDT = len(RANG) * 2
STOPORD = set(_linjer("stopord_da.txt"))
ORD = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*")
ENDELSER = ("ernes", "erne", "enes", "ene", "ens", "ets", "er", "en", "et", "es", "e", "s")


def _stamme(o: str) -> str:
    """Grov dansk stamme, kun til at slå bøjningsformer sammen (deling, delingen, delinger)."""
    for e in ENDELSER:
        if o.endswith(e) and len(o) - len(e) >= 4:
            return o[: -len(e)]
    return o


def _rang(o: str) -> int:
    """Rang i almindeligt dansk; "aa" slås også op som "å" (aaret -> året)."""
    return min(RANG.get(o, UKENDT), RANG.get(o.replace("aa", "å"), UKENDT))


def find_soegeord(tekst: str) -> list[str]:
    tekst = re.sub(r"(?<=[a-zæøå])-\n(?=[a-zæøå])", "", tekst[:MAX_TEGN])  # orddeling ved linjeskift
    # (ord, står med stort, er første ord i en sætning, hænger sammen med forrige ord på linjen)
    tokens: list[tuple[str, bool, bool, bool]] = []
    slut = 0
    for m in ORD.finditer(tekst):
        imellem = tekst[slut:m.start()]
        foer = imellem.rstrip()[-1:] or ("a" if tokens else "")  # sidste tegn før ordet, uden mellemrum
        o = m.group()
        tokens.append((o, o[0].isupper() and not o.isupper(), foer in ("", ".", "!", "?", ":", "•", "–", "-"), imellem == " "))
        slut = m.end()
    if len(tokens) < 5:
        return []

    midt_stort = Counter(o.lower() for o, stort, start, _ in tokens if stort and not start)
    brug_navne = sum(midt_stort.values()) / len(tokens) <= GAMMEL_RETSKRIVNING

    # Navne på flere ord: to-tre ord med stort i træk ("Orgelbygger Frobenius", "Mette Hansen").
    fraser: Counter[str] = Counter()
    if brug_navne:
        raekke: list[str] = []
        for o, stort, _, sammen in [*tokens, ("", False, False, False)]:
            if stort and (not raekke or sammen):
                raekke.append(o)
                continue
            while raekke and (raekke[0].lower() in STOPORD or RANG.get(raekke[0].lower(), UKENDT) <= 200):
                raekke.pop(0)
            if 2 <= len(raekke) <= 3 and all(len(r) >= 3 and r.lower() not in STOPORD for r in raekke):
                fraser[" ".join(raekke)] += 1
            raekke = [o] if stort else []

    antal = Counter(o.lower() for o, *_ in tokens)
    former: dict[str, list[str]] = {}
    for o in antal:
        former.setdefault(_stamme(o), []).append(o)

    kandidater: list[tuple[float, str]] = []
    for gruppe in former.values():
        n = sum(antal[o] for o in gruppe)
        vis = min(gruppe, key=lambda o: (-antal[o], len(o)))
        rang = min(_rang(o) for o in gruppe)
        stort = sum(midt_stort[o] for o in gruppe)
        navn = brug_navne and stort >= 1 and stort >= 0.6 * n
        if any(o in STOPORD for o in gruppe) or len(vis) < (3 if navn else 4):
            continue
        if rang <= MIN_RANG and not (navn and stort >= 2):  # "Sam" er et almindeligt ord, men her et navn
            continue
        score = (1 + math.log(n)) * math.log(max(rang, MIN_RANG))
        kandidater.append((score * NAVNEBONUS, vis.capitalize()) if navn else (score, vis))
    for frase, n in fraser.items():
        dele = frase.lower().split()
        rang = max(RANG.get(d, UKENDT) for d in dele)
        if rang > MIN_RANG:
            kandidater.append(((1 + math.log(n)) * math.log(rang) * NAVNEBONUS * 1.2, frase))

    kandidater.sort(key=lambda k: (-k[0], k[1]))
    valgt: list[str] = []
    brugt: set[str] = set()
    for _, k in kandidater:
        dele = {_stamme(d) for d in k.lower().split()}
        if dele & brugt:
            continue  # ordet indgår allerede i et navn, eller navnet dækker et valgt ord
        brugt |= dele
        valgt.append(k)
        if len(valgt) == ANTAL:
            break
    return valgt
