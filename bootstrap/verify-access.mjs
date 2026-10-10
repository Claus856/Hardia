// Automatisk test af roller, grad-filtrering og fil-beskyttelse (+ thumbnails). Kræver at seed.mjs er kørt.
// Rydder op efter sig selv. Exit-kode 1 hvis noget fejler.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { BASE, adminClient, client, login } from './lib.mjs';
import { makePng } from './testimage.mjs';

const PW = process.env.TESTBRUGER_PASSWORD;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <-- ${detail}`}`);
};

/** Rå HTTP-kald: returnerer { status, json, buf }. `token` kan også gives som ?access_token (som et <img>-tag gør). */
async function http(method, path, { token, body, query = '' } = {}) {
  const res = await fetch(`${BASE}${path}${query}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString()); } catch { /* binært */ }
  return { status: res.status, json, buf, type: res.headers.get('content-type') };
}

const admin = await adminClient();
const tokens = {
  medlem1: await login('medlem1@logearkiv.example.com', PW),
  medlem5: await login('medlem5@logearkiv.example.com', PW),
  arkivar: await login('arkivar@logearkiv.example.com', PW),
};
const grad = { medlem1: 1, medlem5: 5 };

// ---- Facit fra admin: hvilke poster findes, hvilken grad, hvilke filer -------------------------------------------
// Testposterne kendes på titlen (numrene tildeles automatisk efter placeringen). Andre poster i basen ignoreres.
const posts = [];
for (const g of await admin('GET', '/items/genstande?limit=-1&fields=id,inventarnummer,min_grad,billeder.directus_files_id&filter[titel][_starts_with]=Test-genstand')) {
  posts.push({ c: 'genstande', id: g.id, min_grad: g.min_grad, files: g.billeder.map((b) => b.directus_files_id) });
}
for (const a of await admin('GET', '/items/arkivmateriale?limit=-1&fields=id,min_grad,filer.directus_files_id&filter[titel][_starts_with]=Test-')) {
  posts.push({ c: 'arkivmateriale', id: a.id, min_grad: a.min_grad, files: a.filer.map((b) => b.directus_files_id) });
}
for (const b of await admin('GET', '/items/bibliotek?limit=-1&fields=id,min_grad,omslagsbillede&filter[titel][_starts_with]=Testbog')) {
  posts.push({ c: 'bibliotek', id: b.id, min_grad: b.min_grad, files: b.omslagsbillede ? [b.omslagsbillede] : [] });
}
check('facit: 9 testposter, 11 billeder/scanninger', posts.length === 9 && posts.flatMap((p) => p.files).length === 11,
  `${posts.length} poster, ${posts.flatMap((p) => p.files).length} filer`);

// ---- 1. Poster: kun de rigtige er synlige -------------------------------------------------------------------------
for (const [user, g] of Object.entries(grad)) {
  for (const c of ['genstande', 'arkivmateriale', 'bibliotek']) {
    const key = { genstande: 'inventarnummer', arkivmateriale: 'arkivnummer', bibliotek: 'titel' }[c];
    const res = await http('GET', `/items/${c}?limit=-1&fields=id,min_grad`, { token: tokens[user] });
    const kendte = new Set(posts.filter((p) => p.c === c).map((p) => p.id));
    const sawIds = res.json.data.map((r) => r.id).filter((id) => kendte.has(id)).sort();
    const expected = posts.filter((p) => p.c === c && p.min_grad <= g).map((p) => p.id).sort();
    check(`${user} (grad ${g}) ser præcis de rigtige ${c}`, JSON.stringify(sawIds) === JSON.stringify(expected), `så ${sawIds}, forventet ${expected}`);
  }
}
{
  const res = await http('GET', '/items/genstande?limit=-1', { token: tokens.arkivar });
  check('arkivar ser alle genstande (også grad 8)', res.json.data.filter((r) => r.titel?.startsWith('Test-genstand')).length === 3);
}
// Direkte adgang til en enkelt post med for høj grad
{
  const g8 = posts.find((p) => p.c === 'genstande' && p.min_grad === 8);
  const res = await http('GET', `/items/genstande/${g8.id}`, { token: tokens.medlem5 });
  check('medlem5 kan ikke hente grad 8-post direkte via id', res.status === 403, `status ${res.status}`);
}

// ---- 2. Filer: hver fil mod hver bruger (direkte URL, /assets og /files, header og ?access_token) ----------------
let fileChecks = 0;
const failuresBeforeFiles = failures;
for (const p of posts) {
  for (const fid of p.files) {
    for (const [user, tok] of [['uden login', null], ['medlem1', tokens.medlem1], ['medlem5', tokens.medlem5], ['arkivar', tokens.arkivar]]) {
      const allowed = user === 'arkivar' || (user !== 'uden login' && p.min_grad <= grad[user]);
      const want = allowed ? 200 : 403;
      const viaHeader = await http('GET', `/assets/${fid}`, { token: tok });
      const viaQuery = await http('GET', `/assets/${fid}`, { query: tok ? `?access_token=${tok}` : '' });
      const thumb = await http('GET', `/assets/${fid}`, { token: tok, query: '?key=liste' });
      const meta = await http('GET', `/files/${fid}`, { token: tok });
      fileChecks++;
      const ok = viaHeader.status === want && viaQuery.status === want && thumb.status === want && meta.status === want
        && (allowed ? viaHeader.type?.startsWith('image/') && viaHeader.buf.length > 1000
                    : !viaHeader.type?.startsWith('image/') && !thumb.type?.startsWith('image/') && !viaQuery.type?.startsWith('image/'));
      if (!ok) check(`fil ${fid.slice(0, 8)} (post ${p.c}, grad ${p.min_grad}) for ${user}`, false,
        `ønsket ${want}, fik assets=${viaHeader.status} ?access_token=${viaQuery.status} thumb=${thumb.status} /files=${meta.status}`);
    }
  }
}
check(`alle ${fileChecks} kombinationer af fil x bruger giver rigtigt svar (/assets, ?access_token, ?key=liste, /files; ingen billeddata ved afvisning)`, failures === failuresBeforeFiles);

// Medlem1 fil-bibliotek: præcis de 4 filer fra grad 1-poster
{
  const expect = (g) => posts.filter((p) => p.min_grad <= g).flatMap((p) => p.files).sort();
  for (const [user, g] of Object.entries(grad)) {
    const res = await http('GET', '/files?limit=-1&fields=id', { token: tokens[user] });
    const testfiler = new Set(posts.flatMap((p) => p.files)); // andre posters filer ignoreres
    const got = res.json.data.map((f) => f.id).filter((id) => testfiler.has(id)).sort();
    check(`${user} ser kun egne tilladte filer i fil-biblioteket (${expect(g).length} stk.)`,
      JSON.stringify(got) === JSON.stringify(expect(g)), `fik ${got.length}, forventet ${expect(g).length}`);
  }
}
// Medlem ser ikke filens private felter (EXIF/GPS i metadata, uploaded_by, interne filnavne)
{
  const res = await http('GET', '/files?limit=1&fields=*', { token: tokens.medlem5 });
  const keys = Object.keys(res.json.data[0] ?? {});
  const forbidden = ['metadata', 'location', 'uploaded_by', 'modified_by', 'filename_disk', 'storage'].filter((k) => keys.includes(k));
  check('medlem ser ikke filens private felter (metadata/GPS, uploaded_by, filename_disk)', forbidden.length === 0, `så: ${forbidden}`);
  const direct = await http('GET', `/files/${posts[0].files[0]}?fields=metadata`, { token: tokens.arkivar });
  check('arkivar kan stadig se metadata', direct.status === 200);
}
// Junction-rækker røber ikke skjulte filer
{
  const res = await http('GET', '/items/genstande_files?limit=-1&fields=directus_files_id', { token: tokens.medlem1 });
  const hidden = posts.filter((p) => p.c === 'genstande' && p.min_grad > 1).flatMap((p) => p.files);
  check('medlem1 kan ikke se junction-rækker for skjulte genstande', res.json.data.every((r) => !hidden.includes(r.directus_files_id)));
}

// ---- 3. Skrivebeskyttelse og selv-eskalering -------------------------------------------------------------------
{
  const g1 = posts.find((p) => p.c === 'genstande' && p.min_grad === 1);
  const post = await http('POST', '/items/genstande', { token: tokens.medlem5, body: { inventarnummer: 'HACK', titel: 'x' } });
  const patch = await http('PATCH', `/items/genstande/${g1.id}`, { token: tokens.medlem5, body: { titel: 'hacket' } });
  const del = await http('DELETE', `/items/genstande/${g1.id}`, { token: tokens.medlem5 });
  check('medlem kan ikke oprette/ændre/slette poster', post.status === 403 && patch.status === 403 && del.status === 403, `${post.status}/${patch.status}/${del.status}`);
  const up = new FormData(); up.append('file', new Blob([makePng({ digit: 1 })], { type: 'image/png' }), 'x.png');
  const upload = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.medlem5}` }, body: up });
  check('medlem kan ikke uploade filer', upload.status === 403, `status ${upload.status}`);
  const exe = new FormData(); exe.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'x.exe');
  const badType = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.arkivar}` }, body: exe });
  check('arkivar kan ikke uploade andre filtyper end billeder/PDF (MIME-liste)', badType.status === 400, `status ${badType.status}`);

  const gradOf = async (email) => (await admin('GET', `/users?filter[email][_eq]=${email}&fields=grad`))[0].grad;
  check('medlem1 har grad 1 og medlem5 har grad 5 (set som admin)',
    (await gradOf('medlem1@logearkiv.example.com')) === 1 && (await gradOf('medlem5@logearkiv.example.com')) === 5);
  const esc = await http('PATCH', '/users/me', { token: tokens.medlem1, body: { grad: 10 } });
  const gradAfter = await gradOf('medlem1@logearkiv.example.com');
  check('medlem1 kan IKKE hæve sin egen grad til 10', esc.status === 403 && gradAfter === 1, `PATCH ${esc.status}, grad nu ${gradAfter}`);
  const roleEsc = await http('PATCH', '/users/me', { token: tokens.medlem1, body: { role: (await admin('GET', '/roles?filter[name][_eq]=Arkivar'))[0].id } });
  check('medlem1 kan IKKE skifte sin egen rolle til Arkivar', roleEsc.status === 403, `status ${roleEsc.status}`);
  const others = await http('GET', '/users?fields=id,email', { token: tokens.medlem1 });
  check('medlem1 kan kun se sig selv i brugerlisten', (others.json?.data ?? []).length <= 1, `så ${(others.json?.data ?? []).length}`);
  const folders = await http('GET', '/folders', { token: tokens.medlem1 });
  check('medlem kan åbne fil-modulet uden "Forbudt"-fejl (læse /folders)', folders.status === 200, `status ${folders.status}`);
  const unauth = await http('GET', '/items/genstande');
  check('uden login: ingen adgang til poster', unauth.status === 403, `status ${unauth.status}`);
}

// ---- 4. Arkivar: opret + redigér (ikke slet), og filer følger postens grad dynamisk ---------------------------------
const cleanup = [];
try {
  const arkivar = client(tokens.arkivar);
  const upload = async (label, g) => {
    const f = new FormData();
    f.append('title', label);
    f.append('file', new Blob([makePng({ digit: g, dots: 3, bg: [20, 120, 90] })], { type: 'image/png' }), `${label}.png`);
    const res = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.arkivar}` }, body: f });
    if (!res.ok) throw new Error(`arkivar-upload fejlede: ${res.status} ${await res.text()}`);
    const id = (await res.json()).data.id; cleanup.push(['files', id]); return id;
  };

  const f1 = await upload('TMP orphan', 1); // uploadet men ikke knyttet til noget
  check('arkivar kan uploade en fil', !!f1);
  check('en uploadet, ikke-tilknyttet fil er SKJULT for medlem1 (fejler lukket)', (await http('GET', `/assets/${f1}`, { token: tokens.medlem1 })).status === 403);

  const f2 = await upload('TMP linked', 1);
  const created = await arkivar('POST', '/items/genstande', {
    inventarnummer: 'TEST-TMP', titel: 'Midlertidig', min_grad: 1, billeder: [{ directus_files_id: f2 }],
  });
  cleanup.unshift(['items/genstande', created.id]);
  check('arkivar kan oprette genstand med billede', !!created.id);
  check('medlem1 ser straks billedet når posten har min_grad 1', (await http('GET', `/assets/${f2}`, { token: tokens.medlem1 })).status === 200);

  await arkivar('PATCH', `/items/genstande/${created.id}`, { min_grad: 5 });
  check('arkivar kan redigere posten (min_grad 1 -> 5)', true);
  check('medlem1 mister straks adgang til billedet når graden hæves til 5 (ingen forsinkelse, ingen Flow)',
    (await http('GET', `/assets/${f2}`, { token: tokens.medlem1 })).status === 403);
  check('medlem5 har stadig adgang til billedet (grad 5)', (await http('GET', `/assets/${f2}`, { token: tokens.medlem5 })).status === 200);

  const del = await http('DELETE', `/items/genstande/${created.id}`, { token: tokens.arkivar });
  check('arkivar kan IKKE slette poster (kravet er opret + redigér)', del.status === 403, `status ${del.status}`);

  // En fil der deles af en grad 8-post og en grad 1-post er synlig for dem der må se grad 1-posten
  const second = await arkivar('POST', '/items/genstande', {
    inventarnummer: 'TEST-TMP2', titel: 'Midlertidig 2', min_grad: 8, billeder: [{ directus_files_id: f2 }],
  });
  cleanup.unshift(['items/genstande', second.id]);
  check('delt fil: medlem5 ser filen via grad 5-posten, selvom den også ligger i en grad 8-post',
    (await http('GET', `/assets/${f2}`, { token: tokens.medlem5 })).status === 200);
  check('delt fil: medlem1 ser den ikke (begge poster har grad > 1)', (await http('GET', `/assets/${f2}`, { token: tokens.medlem1 })).status === 403);
} finally {
  for (const [path, id] of cleanup) await admin('DELETE', `/${path}/${id}`).catch(() => {});
}

// ---- 5. Thumbnails: stort mobilfoto -> lille liste-billede ---------------------------------------------------------
{
  const dir = fs.readdirSync('/directus/node_modules/.pnpm').find((d) => d.startsWith('sharp@'));
  const sharp = createRequire(`/directus/node_modules/.pnpm/${dir}/node_modules/sharp/`)('sharp');
  const W = 4000, H = 3000;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, n = (Math.random() - 0.5) * 60;
    raw[i] = (x / W) * 200 + n + 30; raw[i + 1] = (y / H) * 200 + n + 30; raw[i + 2] = ((x + y) / (W + H)) * 200 + n + 30;
  }
  const jpg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  const f = new FormData(); f.append('title', 'TMP mobilfoto');
  f.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'mobilfoto.jpg');
  const up = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.arkivar}` }, body: f });
  const fid = (await up.json()).data.id;
  try {
    const orig = await http('GET', `/assets/${fid}`, { token: tokens.arkivar });
    const t0 = Date.now();
    const liste = await http('GET', `/assets/${fid}`, { token: tokens.arkivar, query: '?key=liste' });
    const ms = Date.now() - t0;
    const visning = await http('GET', `/assets/${fid}`, { token: tokens.arkivar, query: '?key=visning' });
    const small = await http('GET', `/assets/${fid}`, { token: tokens.arkivar, query: '?key=system-small-cover' });
    const free = await http('GET', `/assets/${fid}`, { token: tokens.arkivar, query: '?width=50' });
    console.log(`INFO  mobilfoto ${(jpg.length / 1048576).toFixed(1)} MB -> liste ${(liste.buf.length / 1024).toFixed(0)} KB (${ms} ms første gang), visning ${(visning.buf.length / 1024).toFixed(0)} KB, system-small-cover ${(small.buf.length / 1024).toFixed(0)} KB`);
    check('mobilfoto er 4-10 MB (realistisk testbillede)', jpg.length > 3.5e6 && jpg.length < 11e6, `${(jpg.length / 1048576).toFixed(1)} MB`);
    check('?key=liste giver lille webp-billede (< 100 KB)', liste.status === 200 && liste.type === 'image/webp' && liste.buf.length < 100 * 1024, `${liste.status} ${liste.type} ${liste.buf.length}`);
    check('?key=visning giver < 1/3 af originalen', visning.status === 200 && visning.buf.length < jpg.length / 3, `${visning.buf.length}`);
    const meta = await sharp(visning.buf).metadata();
    check('EXIF-rotation anvendes (liggende foto m. orientation 6 bliver stående)', meta.height > meta.width, `${meta.width}x${meta.height}`);
    check('fritekst-transformation (?width=50) afvises (kun presets tilladt)', free.status === 400 || free.status === 403, `status ${free.status}`);
    check('originalen kan stadig hentes uændret', orig.status === 200 && orig.buf.length === jpg.length);

    // Kold burst: en listeside med mange nye mobilfotos (browseren henter ~6 ad gangen) må ikke give 503
    const burstIds = [];
    for (let i = 0; i < 12; i++) {
      const bf = new FormData(); bf.append('title', `TMP burst ${i}`); bf.append('file', new Blob([jpg], { type: 'image/jpeg' }), `burst${i}.jpg`);
      burstIds.push((await (await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.arkivar}` }, body: bf })).json()).data.id);
    }
    try {
      const t1 = Date.now();
      const statuses = await Promise.all(burstIds.map((id) => http('GET', `/assets/${id}`, { token: tokens.arkivar, query: '?key=system-small-cover' }).then((r) => r.status)));
      console.log(`INFO  12 samtidige kolde thumbnails af ${(jpg.length / 1048576).toFixed(1)} MB-fotos: ${Date.now() - t1} ms, statuskoder ${[...new Set(statuses)].join(',')}`);
      check('12 samtidige kolde thumbnails giver alle 200 (ingen 503 "Server too busy")', statuses.every((s) => s === 200), statuses.join(','));
    } finally { for (const id of burstIds) await admin('DELETE', `/files/${id}`).catch(() => {}); }
  } finally { await admin('DELETE', `/files/${fid}`).catch(() => {}); }
}

console.log(failures ? `\n${failures} TEST(S) FEJLEDE` : '\nAlle tests bestået.');
process.exit(failures ? 1 : 0);
