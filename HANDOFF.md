# Overdragelse (midlertidig fil - slettes når README.md er skrevet)

Arbejdet er sat på pause midt i opgaven. Alt nedenfor er bygget og testet i en cloud-container (Ubuntu, IKKE Chrome OS).
Intet er testet på Chrome OS Flex / Crostini.

## Færdigt og testet
- `docker-compose.yml`, `setup.sh` (genererer `.env`), `.env.example`, `.gitignore`
- Datamodel (`bootstrap/build-datamodel.mjs`) + `schema/snapshot.yaml` (eksporteret med `scripts/snapshot.sh`)
- Roller/grad/fil-beskyttelse (`bootstrap/configure.mjs`), testdata (`bootstrap/seed.mjs`)
- Automatisk test: `scripts/verify.sh` (40 checks, alle bestået) + manuelle browsertests (Playwright, ikke i repo)
- `scripts/backup.sh`, `restore.sh`, `provision.sh`, `snapshot.sh`
- Testet: backup -> ødelæg post -> gendan i samme instans; opsætning af tom instans fra snapshot; gendannelse til tom instans

## Vigtige beslutninger / fund
- **Directus 11.17.4 er pinnet, ikke 12.4.1.** v12 uden licensnøgle (CORE-licens) afviser permission-filtre
  ("custom_permission_rules_enabled is a restricted resource"), har max 3 seats og `telemetry_required`.
  Det gør `min_grad <= $CURRENT_USER.grad` umuligt. En licensnøgle kræver aktivering mod Directus' licensserver.
- Postgres 16.15-alpine pinnet.
- Fil-beskyttelse: relationsfilter på `directus_files` via skjulte alias-felter (`i_genstande`, `i_arkivmateriale`,
  `i_bibliotek`). En fil er læsbar hvis mindst én post der bruger den er synlig. Ingen Flow. Ikke-tilknyttede filer er skjulte.
- Medlem må ikke se filens private felter (metadata/EXIF-GPS m.m.). De tre `i_*`-aliasfelter SKAL være med i feltlisten,
  ellers viser Directus "relationship is not configured properly".
- `FILES_MIME_TYPE_ALLOW_LIST=image/*,application/pdf` giver `accept="image/*,application/pdf"` på filvælgeren
  (ellers er der ingen accept-attribut -> kamera ikke sikret).
- `ASSETS_TRANSFORM_MAX_CONCURRENT` skal være >= ca. 10 (ellers 503 "Server too busy" på kolde thumbnails).
- `/server/health` kræver login i v12; healthcheck bruger `/server/ping`.
- Admin-mail skal have gyldig TLD (`.local` afvises).
- Første admin-login viser en Directus-dialog om projektejer + BSL 1.1-vilkår. Den skal brugeren selv tage stilling til
  ("Remind Later" lukker den uden at acceptere noget).
- På smal skærm åbner Directus med menu og sidepanel over formularen; tryk på den mørke flade for at lukke dem.
- Arkivar kan ikke slette poster/filer (kravet var "opret og redigér"); kun Administrator kan oprette brugere/sætte grad.

## Mangler
1. `README.md` (Chrome OS portvideresendelse, adresse til mobil, mobil-tjekliste, HTTPS/Caddy senere, backup/restore-guide, kendte begrænsninger)
2. `CHANGELOG.md` + `package.json` (kun name + version, start 0.1.0)
3. `scripts/check-env.sh` er kun syntakstestet - ikke kørt på Debian/Crostini, `--install` er utestet
4. Kør `scripts/snapshot.sh` til sidst og commit evt. ændring
5. Test på rigtig telefon (kamera-valg i filvælgeren er kun verificeret som DOM-attribut, ikke på en enhed)
6. Opsummering til brugeren
