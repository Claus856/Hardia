// Testbrugere og testposter (kun til PoC - kør ikke på den rigtige server). Idempotent.
// Tre poster pr. collection med min_grad 1, 5 og 8, hver med billeder der viser graden.
import { adminClient, login } from './lib.mjs';
import { makePng, COLORS } from './testimage.mjs';

const { TESTBRUGER_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, DIRECTUS_URL } = process.env;
if (!TESTBRUGER_PASSWORD) { console.error('TESTBRUGER_PASSWORD mangler i .env (kør ./setup.sh igen på en ny .env).'); process.exit(1); }

const api = await adminClient();
const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

async function uploadPng(title, grad, dots, stoerrelse = {}) {
  const found = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (found.length) return found[0].id;
  const form = new FormData();
  form.append('title', title);
  form.append('file', new Blob([makePng({ bg: COLORS[grad], digit: grad, dots, ...stoerrelse })], { type: 'image/png' }), `${title.replace(/\W+/g, '_')}.png`);
  const res = await fetch(`${DIRECTUS_URL}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`upload ${title}: ${res.status} ${await res.text()}`);
  return (await res.json()).data.id;
}

async function ensure(collection, keyField, record) {
  const found = await api('GET', `/items/${collection}?filter[${keyField}][_eq]=${encodeURIComponent(record[keyField])}&limit=1&fields=id`);
  if (found.length) { console.log(`= ${collection} ${record[keyField]}`); return found[0].id; }
  const created = await api('POST', `/items/${collection}`, record);
  console.log(`+ ${collection} ${record[keyField]}`);
  return created.id;
}

// Placeringer (hierarki: rum > reol > hylde)
const place = async (navn, kode, type, overordnet, beskrivelse) =>
  ensure('placeringer', 'navn', { navn, kode, type, overordnet, beskrivelse });
const arkivrum = await place('Arkivrummet', 'AR', 'rum', null, 'Rummet med arkivskabene');
const reolA = await place('Reol A', 'RA', 'reol', arkivrum, 'Ved vinduet');
const hylde2 = await place('Reol A, hylde 2', 'H2', 'hylde', reolA, 'Anden hylde fra oven');
const salen = await place('Udstillingsrummet', 'UR', 'rum', null, 'Museumsrummet');
const montre1 = await place('Montre 1', 'M1', 'montre', salen, 'Ved indgangen');
const bibliotekRum = await place('Biblioteket', 'BI', 'rum', null, 'Bogreoler');
const reolB = await place('Bogreol B', 'RB', 'reol', bibliotekRum, 'Skønlitteratur og historie');

// Genstande: min_grad 1, 5, 8
const genstande = [
  ['TEST-G1', 'Test-genstand, grad 1 (synlig for alle)', 1, 'regalier', montre1, 'udstillet', 2],
  ['TEST-G5', 'Test-genstand, grad 5', 5, 'dokumenter', hylde2, 'i_arkiv', 2],
  ['TEST-G8', 'Test-genstand, grad 8 (kun arkivar)', 8, 'moebler_inventar', reolA, 'i_arkiv', 1],
];
for (const [nr, titel, grad, kategori, placering, status, antal] of genstande) {
  const billeder = [];
  for (let i = 1; i <= antal; i++) billeder.push({ directus_files_id: await uploadPng(`${nr} billede ${i}`, grad, i) });
  await ensure('genstande', 'titel', {   // nummeret tildeles efter placeringen, så posten kendes på titlen
    inventarnummer: nr, titel, beskrivelse: `Testpost med min_grad ${grad}.`, kategori, status, placering,
    datering: 'ca. 1920', materiale: 'Træ og messing', maal: 'H 20 × B 15 cm', stand: 'god',
    proveniens: 'Opdigtet testdata', min_grad: grad, noter: 'Slettes før produktion', billeder,
  });
}

// Arkivmateriale: min_grad 1, 5, 8
const arkiv = [
  ['TEST-A1', 'Test-referat, grad 1', 1, 'referat'],
  ['TEST-A5', 'Test-protokol, grad 5', 5, 'protokol'],
  ['TEST-A8', 'Test-brev, grad 8', 8, 'brev'],
];
for (const [nr, titel, grad, dokumenttype] of arkiv) {
  const filer = [{ directus_files_id: await uploadPng(`${nr} scanning`, grad, 1) }];
  await ensure('arkivmateriale', 'titel', {
    arkivnummer: nr, titel, dokumenttype, dato: '1950-05-17', beskrivelse: `Testpost med min_grad ${grad}.`,
    placering: hylde2, min_grad: grad, filer,
  });
}

// Bibliotek: min_grad 1, 5, 8
const boeger = [
  ['Testbog, grad 1', 1], ['Testbog, grad 5', 5], ['Testbog, grad 8', 8],
];
for (const [titel, grad] of boeger) {
  await ensure('bibliotek', 'titel', {
    titel, forfatter: 'Test Forfatter', udgivelsesaar: 1900 + grad, udgiver: 'Testforlaget', isbn: `000-00-0000-${grad}`,
    sprog: 'dansk', antal_eksemplarer: 1, status: 'paa_hylden', placering: reolB, min_grad: grad,
    omslagsbillede: await uploadPng(`${titel} omslag`, grad, 1),
  });
}

// Oversigtsbilleder: en montre med tre hylder og bagvæg og syv genstande med forskellig grad (billedet har grad 3),
// og et rum (grad 1), hvor et "maleri", der er registreret et andet sted, er markeret.
const montreDele = {};
for (const [navn, kode, type] of [['hylde 1', 'H1', 'hylde'], ['hylde 2', 'H2', 'hylde'], ['hylde 3', 'H3', 'hylde'], ['bagvæg', 'BV', 'vaeg']]) {
  montreDele[kode] = await place(`Montre 1, ${navn}`, kode, type, montre1, 'Testdata til oversigtsbilleder');
}
const iMontre = [
  ['Montre-test: hammer', 1, 'H1', 20, 25], ['Montre-test: vinkel', 1, 'H1', 60, 25], ['Montre-test: passer', 2, 'H2', 30, 50],
  ['Montre-test: sværd', 3, 'H2', 70, 50], ['Montre-test: bæger', 5, 'H3', 25, 75], ['Montre-test: kæde', 5, 'H3', 55, 75],
  ['Montre-test: ritualbog', 8, 'BV', 85, 15],
];
const montreIds = [];
for (const [titel, grad, del] of iMontre) {
  montreIds.push(await ensure('genstande', 'titel', {
    titel, beskrivelse: `Testgenstand i montren med min_grad ${grad}.`, kategori: 'regalier', status: 'udstillet',
    placering: montreDele[del], min_grad: grad, billeder: [{ directus_files_id: await uploadPng(`${titel} billede`, grad, 1) }],
  }));
}
const maleri = await ensure('genstande', 'titel', {
  titel: 'Maleri-test: logens stifter', beskrivelse: 'Hænger i udstillingsrummet, men er registreret i arkivrummet.',
  kategori: 'andet', status: 'udstillet', placering: reolA, min_grad: 1,
});
async function oversigt(titel, placering, grad, markeringer) {
  const found = await api('GET', `/items/oversigtsbilleder?filter[titel][_eq]=${encodeURIComponent(titel)}&limit=1&fields=id`);
  if (found.length) { console.log(`= oversigtsbillede ${titel}`); return; }
  const billede = await uploadPng(`Oversigt ${titel}`, grad, 3, { width: 1600, height: 1200 });
  const o = await api('POST', '/items/oversigtsbilleder', { titel, placering, billede, min_grad: grad });
  for (const [genstand, x, y] of markeringer) await api('POST', '/items/markeringer', { oversigtsbillede: o.id, genstand, x, y });
  console.log(`+ oversigtsbillede ${titel} (${markeringer.length} markeringer)`);
}
await oversigt('Test-forside', montre1, 3, iMontre.map(([, , , x, y], i) => [montreIds[i], x, y]));
await oversigt('Test-rum', salen, 1, [[maleri, 30, 30], [montreIds[0], 70, 60]]);

// Testbrugere
const roles = Object.fromEntries((await api('GET', '/roles?limit=-1')).map((r) => [r.name, r.id]));
const users = [
  ['medlem1@logearkiv.example.com', 'Medlem', 'Grad 1', 'Medlem', 1],
  ['medlem5@logearkiv.example.com', 'Medlem', 'Grad 5', 'Medlem', 5],
  ['arkivar@logearkiv.example.com', 'Test', 'Arkivar', 'Arkivar', 1],
];
for (const [email, first_name, last_name, role, grad] of users) {
  if ((await api('GET', `/users?filter[email][_eq]=${encodeURIComponent(email)}&limit=1&fields=id`)).length) {
    console.log(`= bruger ${email}`); continue;
  }
  await api('POST', '/users', { email, first_name, last_name, role: roles[role], grad, password: TESTBRUGER_PASSWORD, language: 'da-DK' });
  console.log(`+ bruger ${email} (${role}, grad ${grad})`);
}
console.log('Testdata færdig. Testbrugernes kodeord står som TESTBRUGER_PASSWORD i .env.');
