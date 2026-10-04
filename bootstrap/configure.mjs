// Indstillinger, roller, policies og rettigheder. Idempotent: rettighederne for vores to policies nulstilles
// og lægges ind igen hver gang, så filen her altid er sandheden.
//
// Fil-beskyttelse (kerne-idéen): /assets/<id> tjekker læserettigheden på directus_files. Medlem får kun læse
// de filer, der er knyttet til en post, som medlemmet selv må se (min_grad <= grad). Reglen følger relationerne
// fra filen tilbage til posten (alias-felterne i_genstande, i_arkivmateriale, i_bibliotek), så graden altid
// afgøres af posten lige nu - ingen kopi af graden på filen, ingen Flow der kan komme ud af sync.
import { adminClient, waitForServer } from './lib.mjs';

const api = await (async () => { await waitForServer(); return adminClient(); })();

const MAIN = ['genstande', 'arkivmateriale', 'bibliotek'];
const JUNCTIONS = { genstande_files: 'genstande_id', arkivmateriale_files: 'arkivmateriale_id' };
const GRAD_OK = { min_grad: { _lte: '$CURRENT_USER.grad' } };
// Medlem må ikke se filens interne/private felter: metadata (EXIF kan indeholde GPS-position), location,
// uploaded_by, filename_disk osv. Kun det appens fillister og forhåndsvisning bruger.
// De tre i_*-aliasfelter SKAL med: Directus skjuler en relation (og appen viser "relationship is not configured
// properly") hvis brugeren ikke må læse relationens felt på begge sider.
const FILE_FIELDS_FOR_MEDLEM = [
  'i_genstande', 'i_arkivmateriale', 'i_bibliotek',
  'id', 'title', 'description', 'filename_download', 'type', 'folder', 'filesize', 'width', 'height', 'duration',
  'tags', 'embed', 'focal_point_x', 'focal_point_y', 'created_on', 'modified_on', 'uploaded_on',
];

async function upsertByName(collection, name, data) {
  const found = await api('GET', `/${collection}?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (found.length) return api('PATCH', `/${collection}/${found[0].id}`, data);
  return api('POST', `/${collection}`, { name, ...data });
}

async function ensureAccess(roleId, policyId) {
  const links = await api('GET', `/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&limit=1`);
  if (!links.length) await api('POST', '/access', { role: roleId, policy: policyId });
}

async function setPermissions(policyId, rows) {
  const old = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&fields=id&limit=-1`);
  if (old.length) await api('DELETE', '/permissions', old.map((p) => p.id));
  await api('POST', '/permissions', rows.map((r) => ({
    policy: policyId, fields: ['*'], permissions: {}, validation: null, presets: null, ...r,
  })));
}

// --- Indstillinger ---------------------------------------------------------------------------------------------
await api('PATCH', '/settings', {
  project_name: 'Logearkiv',
  project_descriptor: 'Museum, arkiv og bibliotek',
  default_language: 'da-DK',
  // Kun faste størrelser (presets) må genereres - ingen vilkårlige tunge transformationer fra klienten.
  storage_asset_transform: 'presets',
  storage_asset_presets: [
    { key: 'liste', fit: 'cover', width: 240, height: 240, quality: 70, withoutEnlargement: true, format: 'webp', transforms: [] },
    { key: 'visning', fit: 'inside', width: 1600, height: 1600, quality: 80, withoutEnlargement: true, format: 'webp', transforms: [] },
  ],
});
console.log('= indstillinger');

// --- Policies og roller ----------------------------------------------------------------------------------------
const arkivarPolicy = await upsertByName('policies', 'Arkivar', {
  icon: 'edit_note', description: 'Opret og redigér i alle collections', app_access: true, admin_access: false,
});
const medlemPolicy = await upsertByName('policies', 'Medlem', {
  icon: 'visibility', description: 'Kun læseadgang, filtreret på grad', app_access: true, admin_access: false,
});
const arkivar = await upsertByName('roles', 'Arkivar', { icon: 'edit_note', description: 'Registrerer og redigerer arkivet' });
const medlem = await upsertByName('roles', 'Medlem', { icon: 'visibility', description: 'Læser det grad tillader' });
await ensureAccess(arkivar.id, arkivarPolicy.id);
await ensureAccess(medlem.id, medlemPolicy.id);

// --- Arkivar: opret + redigér (ikke slet, jf. kravet). Junction-rækker skal kunne slettes for at fjerne et billede
//     fra en post uden at slette selve filen. -------------------------------------------------------------------
const arkivarRows = [
  ...[...MAIN, 'placeringer'].flatMap((collection) =>
    ['create', 'read', 'update'].map((action) => ({ collection, action }))),
  ...Object.keys(JUNCTIONS).flatMap((collection) =>
    ['create', 'read', 'update', 'delete'].map((action) => ({ collection, action }))),
  ...['create', 'read', 'update'].map((action) => ({ collection: 'directus_files', action })),
  { collection: 'directus_folders', action: 'read' },
];
await setPermissions(arkivarPolicy.id, arkivarRows);
console.log(`= Arkivar: ${arkivarRows.length} rettigheder`);

// --- Medlem: kun læse ------------------------------------------------------------------------------------------
const medlemRows = [
  ...MAIN.map((collection) => ({ collection, action: 'read', permissions: GRAD_OK })),
  { collection: 'placeringer', action: 'read' },
  { collection: 'directus_folders', action: 'read' }, // ellers fejler fil-modulet med en "Forbudt"-dialog
  // Junction-rækkerne røber hvilke filer der hører til en post, så de følger postens grad.
  ...Object.entries(JUNCTIONS).map(([collection, parentField]) => ({
    collection, action: 'read', permissions: { [parentField]: GRAD_OK },
  })),
  // Filer: kun dem der bruges af en post medlemmet må se. Ikke-tilknyttede filer er skjulte (fejler lukket).
  {
    collection: 'directus_files', action: 'read', fields: FILE_FIELDS_FOR_MEDLEM,
    permissions: {
      _or: [
        { i_genstande: { genstande_id: GRAD_OK } },
        { i_arkivmateriale: { arkivmateriale_id: GRAD_OK } },
        { i_bibliotek: GRAD_OK },
      ],
    },
  },
];
await setPermissions(medlemPolicy.id, medlemRows);
console.log(`= Medlem: ${medlemRows.length} rettigheder`);
console.log('Roller og rettigheder færdige.');
