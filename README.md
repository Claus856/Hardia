# Logearkiv

Arkivsystem til en loge, bygget på [Directus](https://directus.io) 11.17.4 og PostgreSQL 16 i Docker, med en lille
tekstservice, der trækker tekst ud af PDF'er og foreslår søgeord.
Registrering af genstande, arkivmateriale og bibliotek med billeder/scanninger, hvor hver post har en
mindste-grad (`min_grad`), og et medlem kun ser de poster og filer, som medlemmets egen grad giver adgang til.

Status: **proof of concept** (version 1.1.0). Kører på en Chromebook (Chrome OS' Linux-miljø) på det lokale netværk over HTTP.

## Indhold

| Sti | Formål |
|---|---|
| `docker-compose.yml` | Directus + PostgreSQL + tekstservice. Alle værdier kommer fra `.env` |
| `setup.sh` | Opretter `.env` med tilfældige hemmeligheder og data-mapperne |
| `scripts/check-env.sh` | Miljøtjek; `--install` installerer Docker |
| `scripts/provision.sh` | Datamodel, indstillinger, roller, rettigheder, servicebruger og flows (`--seed`: også testdata) |
| `scripts/verify.sh` | Automatisk test af roller, grad-filtrering og fil-beskyttelse |
| `scripts/backup.sh`, `restore.sh` | Backup og gendannelse |
| `scripts/snapshot.sh` | Eksporterer datamodellen til `schema/snapshot.yaml` |
| `scripts/backfill.sh` | Kører tekstudtræk og søgeordsforslag for alle eksisterende poster i arkivmateriale |
| `tekstservice/` | Tekstservicen (Python, FastAPI, pdftotext). Søgeordsforslagene laves i `soegeord.py` ud fra `ordfrekvens_da.txt` og `stopord_da.txt` |
| `bootstrap/tekst.mjs` | Servicebrugeren "Tekstservice", de tre flows, flow-knapperne for Arkivar og bogmærkerne |
| `extensions-src/foto/`, `extensions/` | Directus-modulet "Tag billede" (kildekode og bygget udgave) |
| `extensions/directus-extension-nummer/` | Hook: automatiske numre, validering af placeringskoder (ren JS, ingen build) |
| `extensions-src/placering-vaelger/`, `extensions-src/placering-ny/` | Trin-for-trin-vælger til placering og siden "Ny placering" (kildekode; bygget udgave i `extensions/`) |
| `extensions/directus-extension-menu/` | Skjuler menupunkter pr. rolle; vælges under Indstillinger → Brugerroller → "Skjul i menuen" (ren JS, ingen build) |
| `extensions-src/vejledning/` | Modulet "Vejledning": brugervejledning tilpasset brugerens rettigheder. Teksten står i `AFSNIT` øverst i `src/index.js` |
| `extensions-src/soeg/` | Modulet "Søg": søgning på tværs af genstande, arkiv og bibliotek (kildekode; bygget udgave i `extensions/`) |
| `bootstrap/` | Node-scripts, som `provision.sh` og `verify.sh` kører i en engangs-container |
| `data/`, `backup/`, `.env` | Database, uploads, backups og hemmeligheder. Ligger **ikke** i git |

## Datamodel og roller

Collections: `genstande`, `arkivmateriale`, `bibliotek` og `placeringer` (hierarkisk: rum → reol → hylde).
Genstande og arkivmateriale kan have flere billeder/scanninger.

| Rolle | Må |
|---|---|
| Administrator | Alt, herunder oprette brugere og sætte deres grad |
| Arkivar | Se alt, oprette og redigere poster, uploade filer. Kan ikke slette |
| Medlem | Kun læse poster, hvor `min_grad` ≤ medlemmets grad, og kun de filer, der hører til en synlig post |
| Tekstservice | Servicebruger (ikke en person): læser arkivmateriale og dets filer uanset grad, skriver kun de udtrukne tekstfelter. Se [Tekstudtræk og søgeord](#tekstudtræk-og-søgeord) |

En fil, der ikke er knyttet til nogen post, er skjult for medlemmer. Hæves en posts `min_grad`, mister
medlemmer under graden straks adgangen til postens filer.

## Installation

### Trin 1: Chrome OS – portvideresendelse og adresse

Linux-miljøet på en Chromebook har en intern adresse (`100.115.92.x`), som andre enheder ikke kan nå.
Mobilen skal bruge **Chromebookens Wi-Fi-adresse** og en videresendt port.

1. Find Chromebookens Wi-Fi-adresse: Indstillinger → Netværk → Wi-Fi → det aktuelle netværk → *IP-adresse* (fx `192.168.38.127`).
2. Videresend porten: Indstillinger → Om ChromeOS → Udviklere → Linux-udviklingsmiljø → Portvideresendelse → *Tilføj port*: `8055`, TCP. Slå den til.
3. Portvideresendelsen slås fra, hver gang Linux-miljøet eller Chromebooken genstartes. Slå den til igen samme sted.
4. Giv gerne Chromebooken en fast adresse i routeren (DHCP-reservation). Skifter adressen alligevel: `./setup.sh --ip <ny adresse>` og derefter `docker compose up -d`.

På en almindelig Linux-maskine springes trin 1 over; brug maskinens LAN-adresse.

### Trin 2: Docker

```bash
./scripts/check-env.sh             # kun tjek
./scripts/check-env.sh --install   # installerer Docker CE + compose-plugin (Debian/Ubuntu, kræver sudo)
```

Luk Linux-terminalen helt efter installationen og åbn den igen, så gruppen `docker` slår igennem.

### Trin 3: Opsætning og start

```bash
./setup.sh --ip 192.168.38.127     # opretter .env; viser admin-kodeordet én gang
docker compose up -d --wait
./scripts/provision.sh             # datamodel + roller
./scripts/provision.sh --seed      # i stedet: også testbrugere og testposter (kun PoC)
./scripts/verify.sh                # kræver --seed-data
```

Åbn derefter `http://<Chromebookens Wi-Fi-adresse>:8055` (på Chromebooken selv: `http://localhost:8055`).

- Admin-login og -kodeord står i `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). Admin-mailen skal have et gyldigt topdomæne (`.local` afvises).
- Testbrugere efter `--seed`: `medlem1@logearkiv.example.com` (grad 1), `medlem5@logearkiv.example.com` (grad 5) og `arkivar@logearkiv.example.com`. Kodeordet er `TESTBRUGER_PASSWORD` i `.env`.
- Første admin-login viser en Directus-dialog om projektejer og BSL 1.1-vilkår. Den skal I selv tage stilling til; *Remind Later* lukker den uden at acceptere noget.
- Testposterne (`TEST-…`) og testbrugerne skal slettes før rigtig brug.

## Placeringer og numre

- Hver placering har en **kode** (A-Z og tal, unik på samme niveau), fx `FV`, `M1`, `H2`, `BV`.
- Siden **Ny placering** i menuen opretter en placering og dens hylder/bagvæg/underskab i ét hug: vælg hvor den skal ligge, type, navn og kode,
  antal hylder og om der skal være bagvæg og/eller underskab. Hylderne får koderne `H1`, `H2` …, bagvæggen `BV` og underskabet `US`.
- Listen under Indhold → Placeringer står som standard i træorden med den fulde kode (`FV-M1-BV`) i første kolonne.
  Felterne `sti` og `sortering` vedligeholdes automatisk af udvidelsen `nummer`.
- Siden **Søg** i menuen søger i genstande, arkivmateriale og bibliotek på én gang. Søgningen kan afgrænses til én samling,
  til en placering (inkl. alt under den) og til ét bestemt felt. Rullelister søges på deres tekst ("tysk" finder Tyskland),
  flere ord skal alle findes, og et medlem finder kun de poster, medlemmets grad giver adgang til.
  Søgningen dækker også søgeord og den udtrukne tekst fra PDF'er på arkivmateriale.
- Ved registrering af genstande, arkivmateriale og bøger vælges placeringen **trin for trin** (rum → montre → hylde).
- Genstande og arkivmateriale får **automatisk nummer** efter placeringen: `FV-M1-H2-003` = Forværelse → Montre 1 → Hylde 2 → nr. 3.
  Løbenummeret tælles på tværs af genstande og arkivmateriale, så numrene er unikke. Nummerfeltet er skrivebeskyttet.
- **Flyttes** en post, eller ændres kode/overordnet på en placering, **regnes numrene nedenunder om**. Det gamle nummer er derefter ugyldigt,
  så nye labels skal skrives ved flytning. Alle koder på stien skal være udfyldt, ellers afvises posten.
- Poster med eksplicit nummer og uden placering (testdata, import) lades urørte. `POST /nummer/omnummerer` (kun admin) regner alle poster om.

## Tekstudtræk og søgeord

Når en PDF lægges på en post i arkivmateriale, trækkes teksten ud med `pdftotext` og gemmes på posten, og
tjenesten foreslår op til 12 søgeord ud fra teksten. Der bruges ingen OCR, ingen sprogmodel
og ingen ekstern søgemotor: teksten ligger som felter på posten, så `min_grad`-reglen også gælder for søgning.

### Felter på arkivmateriale

| Felt | Indhold |
|---|---|
| `soegeord` (Søgeord) | De godkendte søgeord, som arkivaren vælger. Tjenesten skriver aldrig i feltet |
| `foreslaaede_soegeord` (Foreslåede søgeord) | Maskinforslag. Skrivebeskyttet |
| `tekststatus` | `ok` (OK), `kraever_ocr` (Ingen tekst fundet – kræver OCR), `ikke_pdf` (Ikke en PDF), `fejl` (Fejl). Tom = posten har ingen filer |
| `tekst_opdateret` | Hvornår tjenesten sidst ændrede felterne |
| `dokumenttekst` | Den udtrukne tekst, med linjen `===== filnavn =====` foran hver PDF. Skrivebeskyttet, i den sammenklappede gruppe "Udtrukket tekst" nederst i formularen, og ikke en kolonne i listen som standard |

Feltnavnene er uden æ, ø og å, som resten af datamodellen; formularen viser de danske navne.

### Sådan hænger det sammen

1. Flowet **Tekstudtræk: filer ændret** reagerer, når en post i `arkivmateriale` oprettes eller rettes, og når der oprettes
   eller rettes en række i `arkivmateriale_files` (det gør "Tag billede"). En betingelse lader det kun gå videre, når det
   er filerne, der er ændret. Så kalder det `http://tekstservice:8000/hook` med postens id.
2. Tekstservicen svarer med det samme og lægger posten i en kø. Køen behandles én post ad gangen med lav prioritet, så
   upload fra mobilen ikke venter, og maskinen ikke belastes. Flere ændringer af samme post inden for 2 sekunder slås sammen.
3. Tjenesten henter postens filer fra Directus, kører `pdftotext` på PDF'erne, samler teksten og gemmer den sammen med
   søgeordsforslagene og `tekststatus`. Er resultatet uændret, skrives der ikke.

**Ingen løkke:** tjenestens egen opdatering udløser flowet, men standser ved betingelsen, fordi den ikke rører filerne.
Servicebrugeren har heller ikke rettighed til andet end de fire tekstfelter.

Status sættes sådan: `fejl`, hvis en PDF ikke kunne læses (for stor, beskyttet, defekt, tidsgrænse); ellers `kraever_ocr`,
hvis mindst én PDF har under 50 tegn pr. side; ellers `ok`. Har posten kun billeder, bliver den `ikke_pdf`. Tekst fra de
PDF'er, der kunne læses, gemmes uanset status.

### Knapper og bogmærker

- **Brug foreslåede søgeord** (posten → sidepanelet → Flows): lægger forslagene til de søgeord, posten allerede har.
  Arkivaren fjerner derefter dem, der ikke passer. Intet overskrives.
- **Udtræk tekst igen** (samme sted): kører tekstudtrækket for posten på ny.
- Bogmærket **Kræver OCR** under Indhold → Arkivmateriale viser de dokumenter, der mangler et tekstlag.
- Bogmærket **Søgeord indeholder …** er et filter på søgeord; skriv ordet i filteret.

Knapperne ses af Administrator og Arkivar. Arkivar får dem via den ekstra policy "Arkivar: flow-knapper", som kun giver
læseadgang til manuelle flows.

### Servicebrugeren

`provision.sh` opretter brugeren **Tekstservice** med rollen og policyen af samme navn og sætter dens statiske token til
`TEKSTSERVICE_TOKEN` fra `.env`. Brugeren har ingen adgang til Directus-appen. Rettigheder:

| Collection | Må |
|---|---|
| `arkivmateriale` | Læse `id`, `filer` og de fire tekstfelter. Rette `dokumenttekst`, `foreslaaede_soegeord`, `tekststatus` og `tekst_opdateret` – intet andet |
| `arkivmateriale_files` | Læse |
| `directus_files` | Læse `id`, `type`, `filename_download` og `filesize` for filer, der er knyttet til arkivmateriale (og hente selve filen) |

Der er intet grad-filter på rollen: tjenesten skal behandle alle dokumenter og ser derfor alle grader. Den kan ikke læse
titel, beskrivelse eller grad, ikke oprette eller slette noget og ikke se genstande, bibliotek, brugere eller andre filer.
Tokenet giver altså adgang til al tekst i arkivets PDF'er; behandl `.env` derefter. Nyt token: ret `TEKSTSERVICE_TOKEN`
i `.env`, og kør `./scripts/provision.sh` og `docker compose up -d`.

Tekstservicen har ingen porte udadtil og kan kun nås fra Directus på det interne Docker-netværk.

### Eksisterende poster (backfill)

```bash
./scripts/backfill.sh    # sætter alle poster i arkivmateriale i kø og venter, til køen er tom
```

Kan køres igen når som helst; uændrede poster skrives ikke. Brug den efter opgradering, efter ændring af stopord eller
grænser, og hvis filer er slettet direkte i filbiblioteket. Logen ses med `docker compose logs tekstservice`.

### Grænser og indstillinger

Standardværdierne kan ændres i `.env` (derefter `docker compose up -d`):

| Nøgle | Standard | Betydning |
|---|---|---|
| `TEKST_MAX_FIL_MB` | 50 | Større PDF'er læses ikke (`fejl`) |
| `TEKST_MAX_SIDER` | 300 | Kun de første sider læses |
| `TEKST_TIMEOUT_SEK` | 120 | Tidsgrænse pr. PDF |

Desuden gemmes højst 1 mio. tegn pr. post, søgeordsforslagene ser kun de første 300.000 tegn, og containeren har et
hukommelsesloft på 512 MB.

### Sådan findes søgeordsforslagene

Forslagene er de ord, der er **sjældne i almindeligt dansk, men står i dokumentet**, plus **egennavne**. Der bruges
ingen AI-model, kun en liste over de 50.000 hyppigste danske ord (`tekstservice/ordfrekvens_da.txt`).

- Ord blandt de 2500 hyppigste i dansk foreslås ikke. Jo sjældnere ordet er, og jo oftere det står i dokumentet, jo
  højere kommer det. Ord, der ikke er i listen (typisk sammensatte ord og navne), regnes som meget sjældne.
- Egennavne (stort begyndelsesbogstav midt i en sætning) vægtes højere og beholder det store bogstav. Et navn, der
  også er et almindeligt ord ("Sam"), kommer med, når det står med stort mindst to gange. To-tre ord med stort i træk
  holdes samlet ("Orgelbygger Frobenius").
- Bøjningsformer slås sammen (deling, delingen, delinger), og "aa" læses som "å".
- I tekster med gammel retskrivning (navneord med stort, før 1948) siger store bogstaver ikke noget om navne, så dér
  vælges der kun efter sjældenhed, og alle forslag står med småt.

Justering (byg derefter tjenesten igen med `docker compose up -d --build tekstservice`, og kør `./scripts/backfill.sh`):

| Vil du | Så ret |
|---|---|
| Udelukke bestemte ord | Tilføj dem i `tekstservice/stopord_da.txt`, ét pr. linje med små bogstaver |
| Have flere eller færre almindelige ord med | `MIN_RANG` i `soegeord.py` (lavere = flere almindelige ord) |
| Have flere eller færre forslag | `ANTAL` i `soegeord.py` |

Ordlisten stammer fra [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018, CC BY-SA 4.0).
Den er bygget på undertekster, så dagligdags ord vurderes rigtigt, mens fagord fra logen næsten altid regnes som sjældne.

### Søgning

- Siden **Søg** søger i dokumenttekst, søgeord og foreslåede søgeord sammen med de øvrige felter.
- Directus' eget søgefelt over listen finder ord i dokumenttekst, men **ikke** i søgeord: tag-felter indgår ikke i
  Directus' fritekstsøgning. Brug siden Søg eller bogmærket "Søgeord indeholder …".
- Målt med 208 poster og 6 MB udtrukket tekst på Chromebooken: ca. 0,2-0,3 sekund pr. søgning i Directus' søgefelt og
  0,4-0,5 sekund på siden Søg med to ord (mod 0,02-0,04 sekund uden tekst). Tiden vokser med tekstmængden, fordi
  PostgreSQL læser al tekst igennem ved hver søgning. Bliver det for langsomt ved nogle tusinde dokumenter, er næste
  skridt et trigram-indeks (`pg_trgm`) på `dokumenttekst`. Det er ikke lavet.

### Opgradering fra 1.0.0

```bash
./setup.sh                 # tilføjer TEKSTSERVICE_TOKEN i den eksisterende .env; ændrer intet andet
docker compose up -d --build --wait
./scripts/provision.sh     # nye felter, servicebruger, flows og bogmærker
docker compose restart directus   # indlæser de opdaterede moduler Søg og Vejledning
./scripts/backfill.sh
```

## Modulet "Tag billede"

Egen side i Directus' menu (`/admin/foto`) til at fotografere direkte på en post: vælg placering (rum → montre → hylde), vælg
genstanden eller arkivmaterialet, tryk **Tag billede**. Kameraet åbner, og billedet uploades og knyttes til posten.
Posterne viser thumbnail og antal billeder; søgning på nummer eller titel virker på tværs af placeringer.

- Modulet skal slås til under Indstillinger → Projektindstillinger → Moduler (nye udvidelser er slået fra som standard).
- Poster uden placering kan kun findes via søgning.
- Kildekoden bygges med `cd extensions-src/foto && npm install && npm run build`; kopiér derefter `dist/` til
  `extensions/directus-extension-foto/` og kør `docker compose restart directus`.

## Tjekliste på mobil

Mobilen skal være på samme Wi-Fi som Chromebooken.

- [ ] `http://<adresse>:8055` åbner login-siden
- [ ] Login som `medlem1`: kun grad 1-poster og deres billeder er synlige
- [ ] Login som `medlem5`: grad 1- og 5-poster er synlige, grad 8 er ikke
- [ ] Login som `arkivar`: åbn "Tag billede", vælg placering og genstand, og tryk på **Tag billede** – kameraet åbner direkte
- [ ] Tag et foto og gem; billedet vises i listen som thumbnail og i posten i fuld visning
- [ ] Et foto taget på højkant vises på højkant
- [ ] Hæv postens `min_grad`, og bekræft som `medlem1`, at billedet er væk

På smal skærm åbner Directus med menu og sidepanel hen over formularen; tryk på den mørke flade for at lukke dem.

## Backup og gendannelse

```bash
./scripts/backup.sh                              # til backup/<dato>/, beholder de 7 nyeste
KEEP=14 ./scripts/backup.sh                      # behold flere
./scripts/restore.sh backup/2026-10-04_030000    # OVERSKRIVER database og uploads; spørger først
```

- En backup indeholder databasen (`db.sql.gz`), uploads (`uploads.tar.gz`), et schema-snapshot og `SHA256SUMS`. Den kan tages, mens systemet er i brug.
- Udtrukket tekst, søgeord, flows og servicebrugeren ligger i databasen og er dermed med. Tekstservicen selv gemmer ingenting.
- `.env` er **ikke** med (heller ikke `TEKSTSERVICE_TOKEN`). Opbevar den separat og sikkert; uden den kan en gendannet server stadig startes med en ny `.env`, og `restore.sh` sætter så admin-kodeordet til værdien i den nye.
- `backup/` ligger på samme disk som data. Kopiér backups til et andet sted (USB-disk, anden maskine).
- Natlig backup med cron: `0 3 * * *  cd ~/logearkiv && ./scripts/backup.sh`
- Ny, tom server: `git clone … && ./setup.sh --ip <adresse> && ./scripts/restore.sh <backup-mappe>`

## Ændring af datamodellen

Ret datamodellen i Directus som administrator, kør `./scripts/snapshot.sh`, og commit `schema/snapshot.yaml`.
`provision.sh` anvender snapshottet på en tom instans og kan køres igen uden skade.
Flows, roller, rettigheder og bogmærker er ikke en del af snapshottet; de ligger i `bootstrap/configure.mjs` og `bootstrap/tekst.mjs`.

## HTTPS (senere)

PoC'en kører over ukrypteret HTTP på lokalnettet, så kodeord sendes i klartekst på Wi-Fi-nettet. Før rigtig brug
bør der sættes en omvendt proxy med TLS foran, fx Caddy. Det er ikke bygget endnu. Det kræver:

- et værtsnavn og et certifikat, som mobilerne stoler på (offentligt domæne med DNS-validering, eller egen CA installeret på enhederne)
- en `caddy`-tjeneste i `docker-compose.yml`, som videresender til `directus:8055`, og portvideresendelse af 443 i stedet for 8055
- `PUBLIC_URL=https://…` og `COOKIE_SECURE=true` i `.env`

## Tekniske valg

- **Directus 11.17.4 er pinnet, ikke 12.x.** Version 12 uden licensnøgle afviser filtre i rettigheder (`custom_permission_rules_enabled is a restricted resource`), har højst 3 brugere og kræver telemetri. Dermed kan reglen `min_grad ≤ brugerens grad` ikke laves. Opgradér ikke, selvom Directus viser "Update available".
- **Fil-beskyttelse** er et relationsfilter på `directus_files` gennem de skjulte alias-felter `i_genstande`, `i_arkivmateriale` og `i_bibliotek`. Graden afgøres altid af posten; der er ingen Flow og ingen kopi af graden på filen. De tre alias-felter skal være med i medlemmets feltliste, ellers viser Directus "relationship is not configured properly".
- Medlemmer ser ikke filens private felter (metadata/EXIF-GPS, hvem der uploadede, filnavn på disken).
- `FILES_MIME_TYPE_ALLOW_LIST=image/*,application/pdf` begrænser uploads og giver filvælgeren `accept`-attributten, der får mobilen til at tilbyde kameraet.
- Thumbnails laves kun i de faste størrelser `liste` (240 px) og `visning` (1600 px). `ASSETS_TRANSFORM_MAX_CONCURRENT` skal være mindst ca. 10, ellers svarer Directus 503 på kolde thumbnails.
- Healthcheck bruger `/server/ping`.
- **Søgeord er tag-felter af typen `csv`**, ikke `json`: de gemmes som kommasepareret tekst, så der kan filtreres med "indeholder".
- **Ingen CPU-kvote (`cpus:`) på containere.** På Chrome OS' Linux-kerne (6.6) gav en kvote på tekstservicen et RCU-stall, der låste alle containere, til kvoten blev fjernet. Tjenesten holdes i stedet nede med én post ad gangen, `nice` og et hukommelsesloft.
- Flowet til tekstudtræk logger kun, at det har kørt (ikke data), så postens tekst ikke kopieres ind i aktivitetsloggen ved hver kørsel.

## Kendte begrænsninger

- Ingen HTTPS (se ovenfor).
- Kameravalget i filvælgeren er kun kontrolleret som attribut i siden, ikke på en rigtig telefon.
- Serveren er kun tilgængelig, mens Chromebooken er tændt, Linux-miljøet kører, og portvideresendelsen er slået til.
- Arkivar kan ikke slette poster eller filer; det kan kun Administrator.
- Backups ligger lokalt, og `.env` er ikke med i dem.
- Directus 11 er under BSL 1.1-licens; vurder selv, om logens brug er dækket.
- Ingen OCR: scannede PDF'er uden tekstlag og billeder giver ingen søgbar tekst (`tekststatus` viser det).
- Søgeordsforslagene er statistiske: sjældne ord er ikke altid vigtige ord, og stavefejl og skævt læste ord kan komme med som "sjældne". De er forslag, ikke facit.
- Slettes en fil direkte i filbiblioteket, eller fjernes en række direkte i `arkivmateriale_files` via API'et, opdateres postens tekst ikke automatisk. Brug "Udtræk tekst igen" eller `backfill.sh`. Fjernes filen fra posten i formularen, opdateres teksten.
- Tekstudtrækket ændrer postens "Opdateret"-tidspunkt og giver en revision i Directus' historik.
- Første start efter opgradering bygger tekstservicens image (ca. 400 MB) og tager et par minutter.
