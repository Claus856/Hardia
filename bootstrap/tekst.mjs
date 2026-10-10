// Tekstudtræk, OCR og søgeord: servicebrugeren "Tekstservice", de fire flows, mappen "OCR" og Arkivars adgang til
// flow-knapperne.
// Felterne på arkivmateriale kommer fra schema/snapshot.yaml; alt her ligger uden for snapshottet.
// Idempotent: flows og rettigheder nulstilles og lægges ind igen, så filen her altid er sandheden.
//
// Aktivt tilvalg: tjenesten kan kun se og hente de filer, hvor "Søgbar tekst" (soegbar på koblingen) er slået til.
//
// Ingen løkke: flowet går kun videre, når en posts filer er ændret (payload.filer eller en række i
// arkivmateriale_files) af en anden end tjenesten selv. Tjenestens egne ændringer - teksten på posten, OCR-teksten
// på koblingen og den søgbare PDF, den lægger på posten - standser ved betingelsen, og det gør knappen "Brug
// foreslåede søgeord" også. Skulle et kald alligevel slippe igennem, ender det som "uændret" i tjenesten.
import { adminClient, waitForServer } from './lib.mjs';

const api = await (async () => { await waitForServer(); return adminClient(); })();

const TOKEN = process.env.TEKSTSERVICE_TOKEN;
if (!TOKEN) throw new Error('TEKSTSERVICE_TOKEN mangler i .env - kør ./setup.sh (tilføjer det i en eksisterende .env) og prøv igen.');
const HOOK = 'http://tekstservice:8000/hook';
const SAML = 'http://tekstservice:8000/saml';
const SKRIVER = ['dokumenttekst', 'foreslaaede_soegeord', 'tekststatus', 'tekst_opdateret'];

async function upsert(collection, filter, data) {
  const q = Object.entries(filter).map(([k, v]) => `filter[${k}][_eq]=${encodeURIComponent(v)}`).join('&');
  const found = await api('GET', `/${collection}?${q}&limit=1`);
  if (found.length) return api('PATCH', `/${collection}/${found[0].id}`, data);
  return api('POST', `/${collection}`, { ...filter, ...data });
}

async function ensureAccess(roleId, policyId) {
  const links = await api('GET', `/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&limit=1`);
  if (!links.length) await api('POST', '/access', { role: roleId, policy: policyId });
}

async function setPermissions(policyId, rows) {
  const old = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&fields=id&limit=-1`);
  if (old.length) await api('DELETE', '/permissions', old.map((p) => p.id));
  await api('POST', '/permissions', rows.map((r) => ({ policy: policyId, permissions: {}, validation: null, presets: null, ...r })));
}

/** Opretter/erstatter et flow. `trin` er operationerne i rækkefølge; hver går videre til den næste ved succes. */
async function flow(name, data, trin) {
  const f = await upsert('flows', { name }, { status: 'active', accountability: 'activity', operation: null, ...data });
  const gamle = await api('GET', `/operations?filter[flow][_eq]=${f.id}&fields=id&limit=-1`);
  if (gamle.length) {
    await api('PATCH', '/operations', { keys: gamle.map((o) => o.id), data: { resolve: null, reject: null } });
    await api('DELETE', '/operations', gamle.map((o) => o.id));
  }
  let naeste = null;
  for (const [i, t] of [...trin.entries()].reverse()) {
    naeste = (await api('POST', '/operations', { flow: f.id, position_x: 19 + 18 * (i + 1), position_y: 1, resolve: naeste, ...t })).id;
  }
  await api('PATCH', `/flows/${f.id}`, { operation: naeste });
  console.log(`= flow "${name}"`);
}

// --- Servicebruger: mindst mulige rettigheder, ingen grad-filter (tjenesten behandler alle dokumenter) ----------
const policy = await upsert('policies', { name: 'Tekstservice' }, {
  icon: 'smart_toy', description: 'Læser arkivmateriale og de filer, der er valgt til søgning; skriver kun de udtrukne tekstfelter', app_access: false, admin_access: false,
});
const rolle = await upsert('roles', { name: 'Tekstservice' }, { icon: 'smart_toy', description: 'Servicebruger til tekstudtræk (ikke en person)' });
await ensureAccess(rolle.id, policy.id);
// Mappen i filbiblioteket, hvor tjenestens søgbare PDF'er lægges (så de er lette at kende fra originalerne).
const mappe = await upsert('folders', { name: 'OCR' }, {});
const OCR_FELTER = ['ocr_type', 'ocr_kilder', 'ocr_tekst', 'ocr_version'];
const EGNE_FILER = { uploaded_by: { _eq: '$CURRENT_USER' } };
await setPermissions(policy.id, [
  { collection: 'arkivmateriale', action: 'read', fields: ['id', 'filer', ...SKRIVER] },
  { collection: 'arkivmateriale', action: 'update', fields: SKRIVER },
  { collection: 'arkivmateriale_files', action: 'read', fields: ['id', 'arkivmateriale_id', 'directus_files_id', 'sort', 'soegbar', ...OCR_FELTER] },
  // Opretter kun koblinger til sine egne søgbare PDF'er (ocr_type skal være sat) og retter kun OCR-felterne.
  // Hakket (soegbar), posten og filen på en eksisterende kobling kan den ikke ændre, og den kan intet slette.
  {
    collection: 'arkivmateriale_files', action: 'create', fields: ['arkivmateriale_id', 'directus_files_id', 'soegbar', 'sort', ...OCR_FELTER],
    validation: { _and: [{ ocr_type: { _in: ['scanning', 'samlet'] } }, { arkivmateriale_id: { _nnull: true } }] },
  },
  { collection: 'arkivmateriale_files', action: 'update', fields: OCR_FELTER },
  // Læser kun filer på arkivmateriale, som arkivaren har valgt til søgning, og dem den selv har lagt op -
  // ikke fravalgte filer, genstandsfotos, omslag eller løse filer.
  {
    collection: 'directus_files', action: 'read', fields: ['id', 'type', 'filename_download', 'filesize', 'modified_on', 'uploaded_on'],
    permissions: { _or: [
      { i_arkivmateriale: { _and: [{ arkivmateriale_id: { _nnull: true } }, { soegbar: { _eq: true } }] } },
      EGNE_FILER,
    ] },
  },
  // Lægger søgbare PDF'er op og kan udskifte indholdet af sine egne (så "Saml billeder" ikke giver dubletter).
  { collection: 'directus_files', action: 'create', fields: ['*'] },
  { collection: 'directus_files', action: 'update', fields: ['*'], permissions: EGNE_FILER },
  { collection: 'directus_folders', action: 'read', fields: ['id', 'name'], permissions: { id: { _eq: mappe.id } } },
]);
const tjeneste = await upsert('users', { first_name: 'Tekstservice' }, { last_name: '(servicebruger)', role: rolle.id, token: TOKEN, status: 'active' });
console.log('= servicebruger Tekstservice');

// --- Flow 1: filerne på en post er ændret -> kald tekstservice (svarer straks, behandler i baggrunden) ----------
await flow('Tekstudtræk: filer ændret', {
  icon: 'picture_as_pdf', trigger: 'event',
  description: 'Kalder tekstservice, når filerne på en post i arkivmateriale ændres (også når "Søgbar tekst" slås til eller fra).',
  options: { type: 'action', scope: ['items.create', 'items.update'], collections: ['arkivmateriale', 'arkivmateriale_files'] },
}, [
  {
    name: 'Er filerne ændret?', key: 'filer_aendret', type: 'condition',
    options: { filter: { _and: [
      { $accountability: { user: { _neq: tjeneste.id } } },
      { _or: [
        { $trigger: { collection: { _eq: 'arkivmateriale_files' } } },
        { $trigger: { payload: { filer: { _nnull: true } } } },
      ] },
    ] } },
  },
  { name: 'Kald tekstservice', key: 'tekstservice', type: 'request', options: { method: 'POST', url: HOOK, body: '{{$trigger}}' } },
]);

// --- Flow 2: knap på posten - læg forslagene til søgeord (eksisterende søgeord bevares) ------------------------
const FLET = `module.exports = function (data) {
  const post = Array.isArray(data.laes) ? data.laes[0] : data.laes;
  const har = post.soegeord || [];
  const kendte = new Set(har.map((s) => s.toLowerCase()));
  const nye = (post.foreslaaede_soegeord || []).filter((s) => !kendte.has(s.toLowerCase()));
  return { soegeord: [...har, ...nye] };
};`;
const KNAP = { collections: ['arkivmateriale'], location: 'item', requireSelection: true, requireConfirmation: false, async: false };
await flow('Brug foreslåede søgeord', {
  icon: 'sell', color: '#2ECDA7', trigger: 'manual',
  description: 'Lægger de foreslåede søgeord til postens søgeord. Fjern bagefter dem, der ikke passer.',
  options: KNAP,
}, [
  {
    name: 'Læs posten', key: 'laes', type: 'item-read',
    options: { collection: 'arkivmateriale', key: '{{$trigger.body.keys}}', query: { fields: ['id', 'soegeord', 'foreslaaede_soegeord'] }, permissions: '$trigger' },
  },
  { name: 'Flet forslag ind', key: 'flet', type: 'exec', options: { code: FLET } },
  {
    name: 'Gem søgeord', key: 'gem', type: 'item-update',
    options: { collection: 'arkivmateriale', key: '{{$trigger.body.keys}}', payload: '{{flet}}', permissions: '$trigger' },
  },
]);

// --- Flow 3: knap på posten - kør tekstudtrækket igen (fx efter at en fil er slettet i filbiblioteket) ----------
await flow('Udtræk tekst igen', {
  icon: 'refresh', trigger: 'manual',
  description: 'Læser de af postens filer, der er valgt til søgning, igen og opdaterer dokumenttekst og foreslåede søgeord.',
  options: KNAP,
}, [
  { name: 'Kald tekstservice', key: 'tekstservice', type: 'request', options: { method: 'POST', url: HOOK, body: '{{$trigger.body}}' } },
]);

// --- Flow 4: knap på posten - saml de valgte billeder til én søgbar PDF ------------------------------------------
await flow('Saml billeder til søgbar PDF', {
  icon: 'picture_as_pdf', color: '#6644FF', trigger: 'manual',
  description: 'Samler de af postens billeder, der har hak i Søgbar tekst, til én PDF med tekstlag (OCR). Billederne bevares.',
  options: KNAP,
}, [
  { name: 'Kald tekstservice', key: 'tekstservice', type: 'request', options: { method: 'POST', url: SAML, body: '{{$trigger.body}}' } },
]);

// --- Arkivar skal kunne se knapperne. Egen policy, så Arkivar-policyen i configure.mjs er urørt. ---------------
const arkivar = (await api('GET', '/roles?filter[name][_eq]=Arkivar&limit=1'))[0];
if (arkivar) {
  const knapper = await upsert('policies', { name: 'Arkivar: flow-knapper' }, {
    icon: 'smart_button', description: 'Viser de manuelle flows (knapper i sidepanelet) for Arkivar', app_access: false, admin_access: false,
  });
  await setPermissions(knapper.id, [{
    collection: 'directus_flows', action: 'read', permissions: { trigger: { _eq: 'manual' } },
    fields: ['id', 'name', 'icon', 'color', 'description', 'status', 'trigger', 'accountability', 'options'],
  }]);
  await ensureAccess(arkivar.id, knapper.id);
  console.log('= Arkivar kan se flow-knapperne');
} else {
  console.log('! rollen Arkivar findes ikke endnu - kør configure.mjs først');
}
// --- Bogmærker under Indhold -> Arkivmateriale (fælles for alle; indholdet følger stadig brugerens grad) --------
// Directus' eget søgefelt finder ord i dokumenttekst, men ikke i tag-felter som søgeord. Bogmærket "Søgeord
// indeholder …" er et filter på søgeord, hvor brugeren selv skriver ordet. (Siden "Søg" dækker begge felter.)
const KOLONNER = ['arkivnummer', 'titel', 'dokumenttype', 'dato', 'tekststatus', 'soegeord'];
const BOGMAERKER = [
  ['Kræver OCR', 'document_scanner', { _and: [{ tekststatus: { _eq: 'kraever_ocr' } }] }],
  ['Tekst fra OCR', 'spellcheck', { _and: [{ tekststatus: { _eq: 'ocr' } }] }],
  ['Søgeord indeholder …', 'sell', { _and: [{ soegeord: { _icontains: '' } }] }],
];
for (const [bookmark, icon, filter] of BOGMAERKER) {
  const data = { icon, layout: 'tabular', filter, layout_query: { tabular: { fields: KOLONNER, sort: ['arkivnummer'] } } };
  const q = `filter[collection][_eq]=arkivmateriale&filter[bookmark][_eq]=${encodeURIComponent(bookmark)}&filter[user][_null]=true&filter[role][_null]=true`;
  const found = await api('GET', `/presets?${q}&limit=1`);
  if (found.length) await api('PATCH', `/presets/${found[0].id}`, data);
  else await api('POST', '/presets', { collection: 'arkivmateriale', bookmark, ...data });
}
console.log('= bogmærker på arkivmateriale');
console.log('Tekstudtræk færdig.');
