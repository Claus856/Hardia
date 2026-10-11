// Regler for oversigtsbilleder og deres markeringer (prikker på billedet). Ren JS, ingen build.
// - En markering peger på præcis én post (genstand ELLER arkivmateriale), og en post har højst én markering pr. billede.
// - Udskiftes billedfilen, sættes billedets markeringer til "skal placeres igen" (skal_placeres), og tidspunktet gemmes.
// - Flyttes en markeret post ud af billedets placering (hele undertræet), bliver markeringen "flyttet". Flyttes den
//   ind igen, bliver den "placeret". En post, der med vilje er markeret uden for undertræet (fx et maleri, der er
//   registreret et andet sted), røres ikke: reglen ser kun på flytninger fra inden for til uden for.
// Medlemmer ser kun markeringer med status "placeret" (se configure.mjs). Intet slettes automatisk.
// Samme opbygning som @directus/errors' createError (pakken kan ikke importeres herfra), så Directus viser beskeden.
class Fejl extends Error {
  name = 'DirectusError';
  code = 'INVALID_PAYLOAD';
  status = 400;
  constructor(message) { super(message); this.extensions = { reason: message }; }
}
const POSTER = { genstande: 'genstand', arkivmateriale: 'arkivmateriale' };
const FELTER = Object.values(POSTER);

/** Ligger placeringen `id` i eller under placeringen `rod`? */
async function iUndertrae(db, rod, id) {
  for (let n = 0; id != null && n <= 25; n++) {
    if (id === rod) return true;
    id = (await db('placeringer').select('overordnet').where({ id }).first())?.overordnet ?? null;
  }
  return false;
}

async function validerMarkering(db, ny, id) {
  for (const akse of ['x', 'y']) {
    const v = Number(ny[akse]);
    if (ny[akse] == null || Number.isNaN(v) || v < 0 || v > 100) throw new Fejl('Markeringens position (x og y) skal være mellem 0 og 100 procent.');
  }
  if (ny.oversigtsbillede == null) throw new Fejl('Markeringen skal høre til et oversigtsbillede.');
  const sat = FELTER.filter((f) => ny[f] != null);
  if (sat.length !== 1) throw new Fejl('En markering skal pege på præcis én post: enten en genstand eller et arkivmateriale.');
  const dublet = db('markeringer').where({ oversigtsbillede: ny.oversigtsbillede, [sat[0]]: ny[sat[0]] });
  if (id != null) dublet.whereNot('id', id);
  if (await dublet.first()) throw new Fejl('Posten er allerede markeret på dette oversigtsbillede. Flyt den eksisterende markering i stedet.');
}
const idAf = (v) => (v && typeof v === 'object' ? v.id : v);

export default ({ filter }, { database }) => {
  filter('markeringer.items.create', async (payload, _meta, ctx) => {
    for (const f of ['oversigtsbillede', ...FELTER]) if (payload[f] !== undefined) payload[f] = idAf(payload[f]);
    payload.status ??= 'placeret';
    await validerMarkering(ctx.database ?? database, payload, null);
    return payload;
  });
  filter('markeringer.items.update', async (payload, meta, ctx) => {
    if (!['oversigtsbillede', 'x', 'y', ...FELTER].some((f) => f in payload)) return payload;
    const db = ctx.database ?? database;
    for (const f of ['oversigtsbillede', ...FELTER]) if (payload[f] !== undefined) payload[f] = idAf(payload[f]);
    for (const id of meta.keys) {
      const gammel = await db('markeringer').where({ id }).first();
      if (gammel) await validerMarkering(db, { ...gammel, ...payload }, id);
    }
    return payload;
  });

  // Nyt foto af en ommøbleret montre: prikkerne passer ikke længere og skal bekræftes eller flyttes.
  filter('oversigtsbilleder.items.update', async (payload, meta, ctx) => {
    if (!('billede' in payload)) return payload;
    const db = ctx.database ?? database;
    const ny = idAf(payload.billede);
    const skiftet = (await db('oversigtsbilleder').select('id', 'billede').whereIn('id', meta.keys)).filter((b) => b.billede !== ny).map((b) => b.id);
    if (!skiftet.length) return payload;
    await db('markeringer').whereIn('oversigtsbillede', skiftet).update({ status: 'skal_placeres' });
    return { ...payload, billede_skiftet: new Date().toISOString() };
  });

  // En markeret post flyttes: ud af billedets undertræ -> "flyttet"; ind igen -> "placeret".
  for (const [tabel, felt] of Object.entries(POSTER)) {
    filter(`${tabel}.items.update`, async (payload, meta, ctx) => {
      if (!('placering' in payload)) return payload;
      const db = ctx.database ?? database;
      const ny = idAf(payload.placering);
      const markeringer = await db('markeringer as m').join('oversigtsbilleder as o', 'o.id', 'm.oversigtsbillede')
        .join(`${tabel} as p`, 'p.id', `m.${felt}`).whereIn(`m.${felt}`, meta.keys)
        .select('m.id', 'm.status', 'o.placering as rod', 'p.placering as gammel');
      for (const m of markeringer) {
        if (m.gammel === ny) continue;
        const foer = await iUndertrae(db, m.rod, m.gammel);
        const efter = await iUndertrae(db, m.rod, ny);
        if (foer && !efter && m.status !== 'flyttet') await db('markeringer').where({ id: m.id }).update({ status: 'flyttet' });
        else if (efter && m.status === 'flyttet') await db('markeringer').where({ id: m.id }).update({ status: 'placeret' });
      }
      return payload;
    });
  }
};
