// Unikke genstands-/arkivnumre efter placeringstræet: <kode>-<kode>-…-<løbenummer>, fx FV-M1-H2-003.
// - Nye poster får nummeret ud fra deres placering.
// - Flyttes en post, eller ændres kode/overordnet på en placering, regnes nummeret om.
// - Koder på placeringer valideres (kun A-Z/0-9, unikke blandt søskende, ingen løkker i træet).
// - Hver placering får sin fulde kodesti (sti) og en sorteringsnøgle (sortering), så listen kan stå i træorden.
// Samme opbygning som @directus/errors' createError (pakken kan ikke importeres herfra), så Directus viser beskeden.
class Fejl extends Error {
  name = 'DirectusError';
  code = 'INVALID_PAYLOAD';
  status = 400;
  constructor({ message }) { super(message); this.extensions = { reason: message }; }
}
const fejl = (message) => new Fejl({ message });

// collection -> kolonnen med nummeret
const TABELLER = { genstande: 'inventarnummer', arkivmateriale: 'arkivnummer' };
const PAD = 3;

async function kodesti(db, placeringId) {
  const koder = [];
  let id = placeringId;
  for (let n = 0; id != null; n++) {
    if (n > 25) throw fejl('Placeringstræet er for dybt eller har en løkke.');
    const r = await db('placeringer').select('navn', 'kode', 'overordnet').where({ id }).first();
    if (!r) throw fejl(`Placering ${id} findes ikke.`);
    if (!r.kode) throw fejl(`Placeringen "${r.navn}" mangler en kode. Giv den en kode under Placeringer.`);
    koder.unshift(r.kode);
    id = r.overordnet;
  }
  return koder.join('-');
}

async function naesteLoebenr(db, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const [tabel, kol] of Object.entries(TABELLER)) {
    const rows = await db(tabel).select(kol).where(kol, 'like', `${prefix}-%`);
    for (const r of rows) { const m = re.exec(r[kol] ?? ''); if (m) max = Math.max(max, Number(m[1])); }
  }
  return max + 1;
}

const nyttNummer = async (db, placeringId) => {
  const prefix = await kodesti(db, placeringId);
  return `${prefix}-${String(await naesteLoebenr(db, prefix)).padStart(PAD, '0')}`;
}

/** Sætter nummer på én eksisterende post, hvis det ikke allerede passer til placeringen. Returnerer true ved ændring. */
async function opdaterPost(db, tabel, id) {
  const kol = TABELLER[tabel];
  const post = await db(tabel).select('placering', kol).where({ id }).first();
  if (!post || post.placering == null) return false;
  const prefix = await kodesti(db, post.placering);
  if (new RegExp(`^${prefix}-\\d+$`).test(post[kol] ?? '')) return false;
  await db(tabel).where({ id }).update({ [kol]: await nyttNummer(db, post.placering) });
  return true;
}

async function undertraeIds(db, rodId) {
  const r = await db.raw(
    'WITH RECURSIVE d AS (SELECT id FROM placeringer WHERE id = ? UNION ALL SELECT p.id FROM placeringer p JOIN d ON p.overordnet = d.id) SELECT id FROM d',
    [rodId],
  );
  return r.rows.map((x) => x.id);
}

async function regnPlaceringerOm(db, placeringIds) {
  let antal = 0;
  for (const tabel of Object.keys(TABELLER)) {
    const poster = await db(tabel).select('id').whereIn('placering', placeringIds).orderBy('id');
    for (const p of poster) if (await opdaterPost(db, tabel, p.id)) antal++;
  }
  return antal;
}

/** Skriver sti (FV-M1-BV) og sortering (FV-M0001-BV, så M2 kommer før M10) på de givne placeringer. */
async function opdaterStier(db, ids) {
  for (const start of ids) {
    const koder = [];
    let id = start;
    for (let n = 0; id != null && n <= 25; n++) {
      const r = await db('placeringer').select('kode', 'overordnet').where({ id }).first();
      if (!r) break;
      koder.unshift(r.kode || '?');
      id = r.overordnet;
    }
    await db('placeringer').where({ id: start }).update({
      sti: koder.join('-'),
      sortering: koder.map((k) => k.replace(/\d+/g, (t) => t.padStart(4, '0'))).join('-'),
    });
  }
}
const alleStier = async (db) => opdaterStier(db, (await db('placeringer').select('id')).map((p) => p.id));

export default ({ filter, action, init }, { database, logger }) => {
  // Ved opstart: regn alle stier igennem (dækker ældre placeringer; før kolonnerne findes, fejler det blot med en advarsel).
  alleStier(database).catch((e) => logger.warn(`Kodestier på placeringer blev ikke opdateret: ${e.message}`));

  // Nye poster
  for (const [tabel, kol] of Object.entries(TABELLER)) {
    filter(`${tabel}.items.create`, async (payload, _meta, ctx) => {
      if (payload.placering == null) {
        if (payload[kol]) return payload; // eksplicit nummer uden placering (fx testdata/import) lades være
        throw fejl('Vælg en placering. Nummeret tildeles automatisk ud fra den.');
      }
      payload[kol] = await nyttNummer(ctx.database ?? database, payload.placering);
      return payload;
    });
    // Flyttede poster
    action(`${tabel}.items.update`, async ({ payload, keys }) => {
      if (!payload || !('placering' in payload)) return;
      for (const id of keys) {
        try { await opdaterPost(database, tabel, id); }
        catch (e) { logger.error(`Nummerering af ${tabel} ${id} fejlede: ${e.message}`); }
      }
    });
  }

  // Placeringer: validering
  const valider = async (db, id, payload) => {
    const eksisterende = id != null ? await db('placeringer').where({ id }).first() : null;
    const ny = { ...(eksisterende ?? {}), ...payload };
    if (payload.kode !== undefined || id == null) {
      const kode = String(ny.kode ?? '').trim().toUpperCase();
      if (!kode) throw fejl('Placeringen skal have en kode (fx M1, H2 eller BV).');
      if (!/^[A-Z0-9]+$/.test(kode)) throw fejl('Koden må kun indeholde bogstaverne A-Z og tal (ingen mellemrum eller bindestreger).');
      payload.kode = kode; ny.kode = kode;
    }
    const sosken = db('placeringer').whereRaw('upper(kode) = ?', [ny.kode]);
    ny.overordnet == null ? sosken.whereNull('overordnet') : sosken.where('overordnet', ny.overordnet);
    if (id != null) sosken.whereNot('id', id);
    if (await sosken.first()) throw fejl(`Koden "${ny.kode}" bruges allerede på samme niveau. Vælg en anden.`);
    if (id != null && payload.overordnet != null && (await undertraeIds(db, id)).includes(payload.overordnet)) {
      throw fejl('En placering kan ikke flyttes ind under sig selv eller en af sine underplaceringer.');
    }
  };
  filter('placeringer.items.create', async (payload, _m, ctx) => { await valider(ctx.database ?? database, null, payload); return payload; });
  filter('placeringer.items.update', async (payload, meta, ctx) => {
    if (payload.kode === undefined && payload.overordnet === undefined) return payload;
    for (const id of meta.keys) await valider(ctx.database ?? database, id, payload);
    return payload;
  });
  action('placeringer.items.create', async ({ key }) => {
    try { await opdaterStier(database, [key]); }
    catch (e) { logger.error(`Kodesti for placering ${key} fejlede: ${e.message}`); }
  });
  // Placeringer: ændret kode/overordnet -> ny sti og nye numre på alt nedenunder
  action('placeringer.items.update', async ({ payload, keys }) => {
    if (!payload || (payload.kode === undefined && payload.overordnet === undefined)) return;
    try {
      let antal = 0;
      for (const id of keys) {
        const ids = await undertraeIds(database, id);
        await opdaterStier(database, ids);
        antal += await regnPlaceringerOm(database, ids);
      }
      if (antal) logger.info(`Omnummererede ${antal} poster efter ændring af placering.`);
    } catch (e) { logger.error(`Omnummerering fejlede: ${e.message}`); }
  });

  // Manuel omnummerering af alt (kun admin): POST /nummer/omnummerer
  init('routes.custom.after', ({ app }) => {
    app.post('/nummer/omnummerer', async (req, res) => {
      if (!req.accountability?.admin) return res.status(403).json({ errors: [{ message: 'Kun administrator.' }] });
      try {
        await alleStier(database);
        const alle = await database('placeringer').select('id');
        res.json({ data: { omnummereret: await regnPlaceringerOm(database, alle.map((p) => p.id)) } });
      } catch (e) { res.status(400).json({ errors: [{ message: e.message }] }); }
    });
  });
};
