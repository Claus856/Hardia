# Logearkiv

Arkivsystem til en loge, bygget på [Directus](https://directus.io) 11.17.4 og PostgreSQL 16 i Docker.
Registrering af genstande, arkivmateriale og bibliotek med billeder/scanninger, hvor hver post har en
mindste-grad (`min_grad`), og et medlem kun ser de poster og filer, som medlemmets egen grad giver adgang til.

Status: **proof of concept** (version 0.1.0). Kører på en Chromebook (Chrome OS' Linux-miljø) på det lokale netværk over HTTP.

## Indhold

| Sti | Formål |
|---|---|
| `docker-compose.yml` | Directus + PostgreSQL. Alle værdier kommer fra `.env` |
| `setup.sh` | Opretter `.env` med tilfældige hemmeligheder og data-mapperne |
| `scripts/check-env.sh` | Miljøtjek; `--install` installerer Docker |
| `scripts/provision.sh` | Datamodel, indstillinger, roller og rettigheder (`--seed`: også testdata) |
| `scripts/verify.sh` | Automatisk test af roller, grad-filtrering og fil-beskyttelse |
| `scripts/backup.sh`, `restore.sh` | Backup og gendannelse |
| `scripts/snapshot.sh` | Eksporterer datamodellen til `schema/snapshot.yaml` |
| `extensions-src/foto/`, `extensions/` | Directus-modulet "Tag billede" (kildekode og bygget udgave) |
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
- `.env` er **ikke** med. Opbevar den separat og sikkert; uden den kan en gendannet server stadig startes med en ny `.env`, og `restore.sh` sætter så admin-kodeordet til værdien i den nye.
- `backup/` ligger på samme disk som data. Kopiér backups til et andet sted (USB-disk, anden maskine).
- Natlig backup med cron: `0 3 * * *  cd ~/logearkiv && ./scripts/backup.sh`
- Ny, tom server: `git clone … && ./setup.sh --ip <adresse> && ./scripts/restore.sh <backup-mappe>`

## Ændring af datamodellen

Ret datamodellen i Directus som administrator, kør `./scripts/snapshot.sh`, og commit `schema/snapshot.yaml`.
`provision.sh` anvender snapshottet på en tom instans og kan køres igen uden skade.

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

## Kendte begrænsninger

- Ingen HTTPS (se ovenfor).
- Kameravalget i filvælgeren er kun kontrolleret som attribut i siden, ikke på en rigtig telefon.
- Serveren er kun tilgængelig, mens Chromebooken er tændt, Linux-miljøet kører, og portvideresendelsen er slået til.
- Arkivar kan ikke slette poster eller filer; det kan kun Administrator.
- Backups ligger lokalt, og `.env` er ikke med i dem.
- Directus 11 er under BSL 1.1-licens; vurder selv, om logens brug er dækket.
