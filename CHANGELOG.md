# Changelog

Formatet følger [Keep a Changelog](https://keepachangelog.com/da/1.1.0/), og versionerne følger [SemVer](https://semver.org/lang/da/).

## [1.3.0] - 2026-10-10

### Tilføjet
- OCR i tekstservicen (`ocrmypdf`, `tesseract` med dansk og engelsk, `img2pdf`), lokalt og kun for filer med hak i "Søgbar tekst".
- Scannede PDF'er får en søgbar kopi, `<originalnavn> (søgbar).pdf`, som lægges på posten i mappen "OCR"; originalen bevares.
- Billeder (også heic) OCR'es hver for sig, så posten bliver søgbar. Mobilfotos vendes efter EXIF, skaleres ned og rettes op først.
- Knappen "Saml billeder til søgbar PDF" på arkivmateriale: de valgte billeder samles i filrækkefølgen til én PDF med tekstlag. Et nyt tryk udskifter indholdet af samme fil.
- Tekststatus "OK – tekst fra OCR" (`ocr`) og bogmærket "Tekst fra OCR".
- Felterne `ocr_type`, `ocr_kilder`, `ocr_tekst` og `ocr_version` på `arkivmateriale_files`.
- Indstillingerne `OCR_SLAAET_TIL`, `OCR_MAX_SIDER`, `OCR_TIMEOUT_SEK` (pr. side) og `OCR_MAX_MEGAPIXEL`.
- Feltet "Søgbar tekst" viser også billeder og har knappen "Sæt hak ved alle".

### Ændret
- "Kræver OCR" bruges nu kun, når OCR er slået fra, eller når OCR ikke fandt brugbar tekst (fx håndskrift). "Ikke en PDF" hedder "Filtypen kan ikke læses".
- Servicebrugeren må lægge filer op, rette sine egne filer, oprette koblinger til sine egne søgbare PDF'er og rette OCR-felterne på koblinger. Stadig ingen delete og ingen adgang til genstande, bibliotek eller brugere.
- Flowet "Tekstudtræk: filer ændret" går ikke videre for ændringer, tjenesten selv har lavet.
- Tekstservicens hukommelsesloft er hævet fra 512 MB til 768 MB, og imaget er vokset fra 271 MB til ca. 690 MB.
- Vejledningen: "Søg i arkivet", "Søgeord og tekst fra PDF'er" og "Tag billede" beskriver OCR, knappen og telefonens dokumentscanner.

### Fjernet
- Bogmærket "Søgeord indeholder …" på arkivmateriale: det havde et tomt filter og meldte fejl, når det blev åbnet. Siden Søg dækker søgning i søgeord.

### Rettet
- `verify.sh` fejlede på en frisk installation og når basen indeholdt andet end testdata: testposterne kendes nu på titlen (numrene tildeles automatisk), og andre posters filer ignoreres. Alle 41 tjek består.

### Testet
- På en separat testinstans: scannet PDF på 3 sider (status `ocr`, søgbar kopi på posten, original bevaret, søgning på ord med æ, ø og å), tre skæve mobilfotos og et foto på højkant med EXIF-rotation, samleknappen (rigtig rækkefølge, ingen dublet ved nyt tryk), PDF med tekstlag (uændret, ingen OCR), blandet post, "håndskrift" (`kraever_ocr`), fravalg og nyt tilvalg (kopien genbruges), "Udtræk tekst igen" og backfill (ingen nye filer, "uændret"), udskiftning af den samlede PDF i samme fil, HEIC, gradstest (grad 1 finder ikke teksten og får 403 på den nye PDF; grad 5 kan begge dele), `OCR_SLAAET_TIL=false`, for store filer (`fejl`), at tjenesten ikke kan slette eller ændre et hak, og at dens egne ændringer ikke giver en løkke (tjenestens log og aktivitetsloggen).
- Målt: ca. 8,5 sekunder pr. scannet side og 4,5 sekunder pr. mobilfoto; Directus svarede lige så hurtigt under OCR som uden.

### Kendt
- Håndskrift og gotisk skrift læses ikke. En frakturmodel er undersøgt, men ikke installeret (se README).
- Billeder og scannede sider over 20 megapixel OCR'es ikke på Chromebooken.
- Genstarter tekstservicen midt i en OCR, skal posten sættes i gang igen med "Udtræk tekst igen".
- Ikke afprøvet på en rigtig telefon.

## [1.2.0] - 2026-10-10

### Ændret
- Tekstudtræk er nu et aktivt tilvalg pr. PDF: arkivaren sætter hak ved filen i det nye felt "Søgbar tekst" på posten. Uden hak hentes og læses filen ikke, og der gemmes hverken tekst eller forslag til søgeord fra den. Fjernes hakket, slettes teksten igen.
- Servicebrugeren "Tekstservice" kan kun se og hente de filer, der er valgt til søgning.
- Ved opgradering står alle eksisterende filer som ikke valgt; `backfill.sh` fjerner den tekst, 1.1.0 udtrak automatisk (godkendte søgeord røres ikke).

### Tilføjet
- Feltet `soegbar` på `arkivmateriale_files`, udvidelsen `soegbar-tekst` og tekststatus "Ikke valgt til søgning".

### Testet
- På en separat testinstans: ny post uden valg (ingen tekst), tilvalg og fravalg af enkelte PDF'er, valg af et billede, valg via API direkte på koblingen, at tjenesten får 403 på fravalgte filer, at Medlem ikke kan ændre valget, og feltet i browseren som Arkivar og Medlem.

## [1.1.0] - 2026-10-09

### Tilføjet
- Automatisk tekstudtræk fra PDF'er på arkivmateriale (`pdftotext`) og automatiske forslag til søgeord (ord, der er sjældne i almindeligt dansk, plus egennavne; ingen AI-model) i en ny container `tekstservice`. Første udgave brugte YAKE, som gav for mange fyldord på korte tekster.
- Felter på arkivmateriale: Søgeord, Foreslåede søgeord, Tekststatus, Tekst opdateret og Dokumenttekst (i den sammenklappede gruppe "Udtrukket tekst").
- Flowet "Tekstudtræk: filer ændret" samt knapperne "Brug foreslåede søgeord" og "Udtræk tekst igen" på posten.
- Servicebrugeren "Tekstservice" med statisk token (`TEKSTSERVICE_TOKEN` i `.env`) og mindst mulige rettigheder.
- `scripts/backfill.sh`, som behandler alle eksisterende poster i arkivmateriale.
- Bogmærkerne "Kræver OCR" og "Søgeord indeholder …" på arkivmateriale.
- Vejledningen har afsnittet "Søgeord og tekst fra PDF'er" for Arkivar.

### Ændret
- Siden "Søg" søger også i søgeord, foreslåede søgeord og dokumenttekst.
- `setup.sh` tilføjer manglende nøgler (`TEKSTSERVICE_TOKEN`) i en eksisterende `.env` uden at ændre resten.
- `provision.sh` opretter også servicebruger, flows og bogmærker.

### Rettet
- `provision.sh --seed` fejlede, fordi testplaceringerne manglede koder (påkrævet siden 0.3.0).

### Testet
- På en separat testinstans: PDF med tekst (OK), scannet PDF (kræver OCR), jpg (ikke en PDF), blandet post, tilknytning via `arkivmateriale_files`, fjernelse af fil, gradstest (grad 1 finder ikke ord i en grad 5-post; grad 5 gør), servicebrugerens rettigheder, ingen løkke i flowet, backfill og backup.
- Søgetid med 208 poster og 6 MB tekst: 0,2-0,5 sekund.

### Kendt
- Ingen OCR. Directus' eget søgefelt finder ikke ord i søgeord (kun siden "Søg" og bogmærket gør).
- En CPU-kvote på tekstservicen låste alle containere på Chrome OS' Linux-kerne; den er fjernet og må ikke sættes igen (se README).

## [1.0.0] - 2026-10-08

### Tilføjet
- Siden "Ny placering": afkrydsningen "Med underskab" opretter et underskab (kode `US`) sammen med placeringen.
- Placeringer har felterne `sti` (fuld kode, fx `FV-M1-BV`) og `sortering`, og listen står som standard i træorden.
- Modulet "Søg": søgning i hele arkivet, som kan afgrænses til samling, placering og felt.
- Modulet "Vejledning": brugervejledning i menuen, som kun viser de afsnit, den indloggede bruger har brug for (Medlem, Arkivar eller Administrator).
- Genstande har feltet "Land" (rulleliste med alle lande, standard Danmark), og formularen starter med placering, titel, status, min. grad, beskrivelse og land.
- `scripts/start.sh` og en genvej i Chrome OS' appstarter, som starter systemet og åbner det i browseren.

### Ændret
- "Tag billede" og "Ny placering" vises kun i menuen for brugere, der må oprette (Arkivar og Administrator), ikke for Medlem.
- Menupunkter kan skjules pr. rolle under Indstillinger → Brugerroller → "Skjul i menuen" (udvidelsen `menu`). Fra start: Medlem ser ikke Brugermappe, Filbibliotek og Dokumentation; Arkivar ser ikke Brugermappe og Dokumentation.

- Medlem og Arkivar må skifte deres eget kodeord (og kun det) under deres profil.

### Rettet
- "Ny placering" foreslår ikke længere en kode, der allerede er brugt på samme niveau.

## [0.3.0] - 2026-10-06

### Tilføjet
- Koder på placeringer og typen "Bagvæg". Koder valideres (A-Z/tal, unikke blandt søskende, ingen løkker i træet).
- Siden "Ny placering": opretter en placering med et valgfrit antal hylder og bagvæg i ét hug.
- Trin-for-trin-vælger til placering på genstande, arkivmateriale og bibliotek.
- Automatiske numre efter placeringstræet (`FV-M1-H2-003`) for genstande og arkivmateriale; numrene regnes om, når en post flyttes, eller en placerings kode/overordnet ændres.

### Ændret
- Nummerfelterne er skrivebeskyttede, og placering er påkrævet på genstande og arkivmateriale.

### Kendt
- `verify.sh` forventer præcis seed-dataens filer og fejler, hvis der er uploadet andre testfotos.

## [0.2.0] - 2026-10-06

### Tilføjet
- Directus-modul "Tag billede": vælg placering → post → tag billede med mobilens kamera, så det knyttes direkte til posten. Viser thumbnails og antal billeder på posterne.
- Docker Compose monterer `./extensions` i Directus.

### Ændret
- Hjælpeteksten på billedfelterne henviser til "Tag billede" i stedet for "Upload fil".

### Testet
- Modulet på mobil (kamera, upload og tilknytning) og i headless browser (navigation, thumbnails).

## [0.1.0] - 2026-10-04

Første proof of concept.

### Tilføjet
- Docker Compose-stak med Directus 11.17.4 og PostgreSQL 16.15; `setup.sh` genererer `.env` med tilfældige hemmeligheder.
- Datamodel: `genstande`, `arkivmateriale`, `bibliotek` og hierarkiske `placeringer`, versioneret i `schema/snapshot.yaml`.
- Rollerne Arkivar og Medlem med grad-filtrering (`min_grad` ≤ brugerens grad) på poster og filer.
- Fil-beskyttelse via relationsfilter på `directus_files`; ikke-tilknyttede filer er skjulte for medlemmer.
- Thumbnail-presets `liste` og `visning`; kun billeder og PDF kan uploades.
- Scripts: `check-env.sh` (med `--install`), `provision.sh` (med `--seed`), `verify.sh`, `backup.sh`, `restore.sh`, `snapshot.sh`.
- README med installation på Chrome OS, mobil-tjekliste og backup/restore-guide.

### Testet
- `check-env.sh --install`, opsætning, provisionering og `verify.sh` (alle checks bestået) på Debian 13 i Chrome OS' Linux-miljø.
