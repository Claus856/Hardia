# Changelog

Formatet følger [Keep a Changelog](https://keepachangelog.com/da/1.1.0/), og versionerne følger [SemVer](https://semver.org/lang/da/).

## [1.5.0] - 2026-10-11

### Tilføjet
- Oversigtsbilleder: et foto af en placering (montre, rum, væg …), hvor genstande og dokumenter er markeret med prikker. Collections `oversigtsbilleder` (med egen `min_grad`) og `markeringer` (position i procent, status).
- Modulet "Oversigtsbilleder": vælg placering trin for trin, billede med nummererede prikker, zoom og panorering (også med to fingre), kort med postens oplysninger og en liste hylde for hylde.
- Redigering for Arkivar og Administrator: nyt oversigtsbillede fra kamera, fil eller en genstands billede med foreslået grad; markér via placeringens undertræ eller søgning; flyt prikker ved at trække; fjern markering; tæller for, hvor meget der er markeret.
- Udvidelsen `oversigt-regler`: præcis én post pr. markering og højst én markering pr. post pr. billede; nyt billede sætter markeringerne til "skal placeres igen"; en markeret post, der flyttes ud af billedets placering, bliver "flyttet".
- "Vis på oversigtsbillede" på genstande og arkivmateriale (feltet Oversigtsbilleder), og genvejen "Oversigtsbillede af …" i Tag billede.
- Vejledningen: afsnittene "Oversigtsbilleder" (alle) og "Lav og vedligehold oversigtsbilleder" (Arkivar), og "Grader og adgang" nævner billedernes egen grad.
- Testdata: en montre med tre hylder og bagvæg, syv genstande med grad 1-8, et maleri registreret et andet sted og to oversigtsbilleder.

### Ændret
- Fil-beskyttelsen dækker også oversigtsbilleder (`i_oversigtsbilleder`): billedfilen følger oversigtsbilledets grad.
- Medlemmer kan læse oversigtsbilleder efter billedets grad og kun de markeringer, der er bekræftet, og hvis post de selv må se.
- Arkivar kan oprette og rette oversigtsbilleder og markeringer og fjerne markeringer.
- `provision.sh` slår modulet til i menuen; på en helt frisk installation lægger den nu hele menuen ind.

### Rettet
- Testdata (`seed.mjs`) oprettede genstande og arkivmateriale en gang til, hver gang det blev kørt, fordi posterne blev genkendt på nummeret, som tildeles automatisk. De genkendes nu på titlen.

### Testet
- På en separat testinstans: 24 nye tjek i `verify.sh` (78 i alt består): grad 1 ser rummets billede, men ikke montrens, heller ikke via `/assets/<id>`, thumbnail eller `/files`; grad 5 ser 6 af 7 prikker, og API-svarene nævner hverken titel, nummer eller id på grad 8-genstanden (direkte, via filter og via billedets liste); reglerne for markeringer; nyt billede skjuler markeringerne, til de er bekræftet; flyttet genstand bliver "flyttet", får nyt nummer og bliver "placeret" igen ved flytning tilbage; maleriet uden for undertræet påvirkes ikke.
- I browseren: medlem (træ, billede, prik, kort, "Åbn post", "Vis på oversigtsbillede" tilbage til den fremhævede prik); arkivar (genvej fra Tag billede, foreslået grad 8, nyt billede via kamera-feltet, markér via hylde, søgning med advarsel, træk prik, skift billede, bekræft, fjern markering, tæller); mobilstørrelse med berøring (knib-zoom, panorering, tryk på prik, kort inden for skærmen).

### Kendt
- Genstande over et medlems grad har ingen prik, men kan ses på selve fotoet.
- Flyttes en hel placering, regnes "flyttet" ikke om.
- Knib-zoom og kamera er ikke afprøvet på en rigtig telefon.

## [1.4.0] - 2026-10-11

### Tilføjet
- Udlånsoplysninger på genstande, arkivmateriale og bøger: "Udlånt til", "Udlånt den" og "Forventet retur". Felterne vises, når status er Udlånt, og de to første er da påkrævede.
- Status (I arkiv / Udlånt) på arkivmateriale; eksisterende dokumenter får "I arkiv".
- Flowet "Ryd udlån ved retur": de tre felter tømmes, når status sættes tilbage.
- Kø: feltet "Kø" på posten med knappen "Stil mig i kø" / "Forlad køen" (udvidelsen `udlaan-koe`, collectionen `reservationer`). Medlemmer ser antallet i køen; Arkivar og Administrator ser navnene i rækkefølge og kan fjerne en plads.
- Bogmærket "Udlånt" under hver samling for Arkivar og Administrator, med låner og datoer.
- `bootstrap/udlaan.mjs` (flow og bogmærker), som `provision.sh` nu også kører.
- Vejledningen: afsnittet "Udlån og kø".

### Ændret
- Medlemmer kan ikke se lånerens navn (`udlaant_til`): deres læseadgang til de tre samlinger er nu en feltliste uden det felt i stedet for alle felter. Kør `provision.sh` igen efter nye felter i datamodellen.
- Medlemmer kan oprette og slette deres egen plads i køen; ellers er de stadig kun læsere.
- Arkivar kan læse navnene (ikke e-mail eller grad) på alle brugere, for at kunne se hvem der står i kø.

### Testet
- På en separat testinstans: 13 nye tjek i `verify.sh` (54 i alt består): medlem ser status og datoer, men ikke lånerens navn (heller ikke via filter eller søgning); felterne ryddes ved retur på alle tre samlinger; medlem kan tælle køen, men ser kun sig selv; ser ikke køen til poster over egen grad; kan ikke stille andre i kø eller fjerne andres plads; arkivar ser navnene og kan fjerne en plads; tekstservicen har ingen adgang til køen.
- I browseren: felterne dukker op ved Udlånt på alle tre samlinger og kan ikke gemmes uden låner og dato; køen som medlem og som arkivar; bogmærket "Udlånt"; medlemmets lister og siden Søg uden fejl.

### Kendt
- Kravet om låner og dato håndhæves i formularen, ikke i API'et.
- Ingen besked til den næste i køen ved retur, og ingen udlånshistorik.
- Ikke afprøvet på en rigtig telefon.

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
