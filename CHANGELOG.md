# Changelog

Formatet følger [Keep a Changelog](https://keepachangelog.com/da/1.1.0/), og versionerne følger [SemVer](https://semver.org/lang/da/).

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
