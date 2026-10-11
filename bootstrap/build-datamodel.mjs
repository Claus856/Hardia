// Engangs-generator for datamodellen (collections, felter, relationer, danske labels).
//
// Efter første kørsel er schema/snapshot.yaml "sandheden": ret datamodellen i Directus' Data Model-UI
// og kør ./scripts/snapshot.sh, og brug ./scripts/provision.sh til at gendanne den på en ny server.
// Dette script er med for at dokumentere designet og kunne bygge modellen op igen fra bunden.
// Idempotent: det der allerede findes, springes over.
import { adminClient, exists, waitForServer } from './lib.mjs';

const LANG = 'da-DK';
const label = (translation) => [{ language: LANG, translation }];
const choices = (...pairs) => pairs.map(([value, text]) => ({ text, value }));

/** Kort skrivemåde for et felt. `o` følger Directus' meta/schema-begreber. */
function field(name, type, o = {}) {
  const required = o.required ?? false;
  return {
    field: name,
    type,
    meta: {
      interface: o.interface,
      options: o.options,
      display: o.display,
      display_options: o.display_options,
      special: o.special,
      width: o.width ?? 'full',
      note: o.note,
      required,
      readonly: o.readonly ?? false,
      hidden: o.hidden ?? false,
      sort: o.sort,
      translations: o.label ? label(o.label) : undefined,
      validation: o.validation,
      validation_message: o.validation_message,
      conditions: o.conditions,
    },
    schema: {
      is_nullable: !required,
      is_unique: o.unique ?? false,
      default_value: o.default,
      max_length: o.maxLength,
    },
  };
}

const text = (name, labelText, o = {}) =>
  field(name, 'string', { interface: 'input', width: 'half', label: labelText, ...o });
const multiline = (name, labelText, o = {}) =>
  field(name, 'text', { interface: 'input-multiline', label: labelText, ...o });
const dropdown = (name, labelText, choiceList, o = {}) =>
  field(name, 'string', {
    interface: 'select-dropdown',
    options: { choices: choiceList, allowOther: o.allowOther ?? false },
    display: 'labels',
    display_options: { choices: choiceList, showAsDot: false },
    width: 'half',
    label: labelText,
    ...o,
  });

const pk = () => ({
  field: 'id',
  type: 'integer',
  meta: { hidden: true, readonly: true, interface: 'input', special: null },
  schema: { is_primary_key: true, has_auto_increment: true },
});

/** Felter alle tre hovedcollections deler. */
const minGrad = (sort) =>
  field('min_grad', 'integer', {
    interface: 'slider',
    options: { minValue: 1, maxValue: 10, stepInterval: 1, alwaysShowValue: true },
    width: 'full',
    label: 'Min. grad',
    note: 'Laveste grad der må se posten (1 = alle medlemmer, 10 = kun højeste grad)',
    required: true,
    default: 1,
    sort,
    validation: { _and: [{ min_grad: { _gte: 1 } }, { min_grad: { _lte: 10 } }] },
    validation_message: 'Graden skal være et helt tal fra 1 til 10',
  });
const noter = (sort) => multiline('noter', 'Noter', { sort });
const oprettet = (sort) =>
  field('oprettet', 'timestamp', {
    interface: 'datetime',
    special: ['date-created'],
    readonly: true,
    display: 'datetime',
    display_options: { relative: true },
    width: 'half',
    label: 'Oprettet',
    sort,
  });
const opdateret = (sort) =>
  field('opdateret', 'timestamp', {
    interface: 'datetime',
    special: ['date-updated'],
    readonly: true,
    display: 'datetime',
    display_options: { relative: true },
    width: 'half',
    label: 'Opdateret',
    sort: sort,
  });

const placeringType = choices(
  ['rum', 'Rum'], ['reol', 'Reol'], ['montre', 'Montre'], ['vaeg', 'Væg'],
  ['skab', 'Skab'], ['hylde', 'Hylde'], ['kasse', 'Kasse/skuffe'], ['andet', 'Andet'],
);

const collections = [
  {
    collection: 'placeringer',
    meta: {
      icon: 'shelves',
      note: 'Rum, reoler, montrer, vægge, hylder og lignende. Brug "Overordnet placering" til at bygge et hierarki (rum > reol > hylde).',
      display_template: '{{navn}}',
      translations: [{ language: LANG, translation: 'Placeringer', singular: 'Placering', plural: 'Placeringer' }],
      sort: 4,
    },
    fields: [
      pk(),
      text('navn', 'Navn', { width: 'full', required: true, sort: 1, note: 'Fx "Reol 2" eller "Skab 2, hylde 3"' }),
      dropdown('type', 'Type', placeringType, { sort: 2 }),
      multiline('beskrivelse', 'Beskrivelse', { sort: 4 }),
    ],
  },
  {
    collection: 'genstande',
    meta: {
      icon: 'museum',
      note: 'Museumsgenstande',
      display_template: '{{inventarnummer}} – {{titel}}',
      translations: [{ language: LANG, translation: 'Genstande', singular: 'Genstand', plural: 'Genstande' }],
      sort: 1,
    },
    fields: [
      pk(),
      text('inventarnummer', 'Inventarnummer', { required: true, unique: true, sort: 2 }),
      dropdown('status', 'Status', choices(['i_arkiv', 'I arkiv'], ['udstillet', 'Udstillet'], ['udlaant', 'Udlånt']),
        { default: 'i_arkiv', required: true, sort: 3 }),
      text('titel', 'Titel', { width: 'full', required: true, sort: 4 }),
      multiline('beskrivelse', 'Beskrivelse', { sort: 5 }),
      dropdown('kategori', 'Kategori', choices(
        ['regalier', 'Regalier'], ['dokumenter', 'Dokumenter'], ['moebler_inventar', 'Møbler/inventar'],
        ['fotografier', 'Fotografier'], ['andet', 'Andet'],
      ), { sort: 6 }),
      text('datering', 'Datering', { sort: 7, note: 'Fx "ca. 1890" eller "1920-1930"' }),
      text('materiale', 'Materiale', { sort: 8 }),
      text('maal', 'Mål', { sort: 9, note: 'Fx "H 45 × B 30 × D 20 cm"' }),
      dropdown('stand', 'Stand', choices(
        ['fremragende', 'Fremragende'], ['god', 'God'], ['acceptabel', 'Acceptabel'],
        ['darlig', 'Dårlig'], ['skroebelig', 'Skrøbelig – kræver konservering'],
      ), { sort: 10 }),
      multiline('proveniens', 'Proveniens', { sort: 11, note: 'Oprindelse og giver' }),
      minGrad(13), noter(14), oprettet(15), opdateret(16),
    ],
  },
  {
    collection: 'arkivmateriale',
    meta: {
      icon: 'description',
      note: 'Dokumenter i arkivet',
      display_template: '{{arkivnummer}} – {{titel}}',
      translations: [{ language: LANG, translation: 'Arkivmateriale', singular: 'Dokument', plural: 'Arkivmateriale' }],
      sort: 2,
    },
    fields: [
      pk(),
      text('arkivnummer', 'Arkivnummer', { required: true, unique: true, sort: 2 }),
      dropdown('dokumenttype', 'Dokumenttype', choices(
        ['protokol', 'Protokol'], ['referat', 'Referat'], ['brev', 'Brev/korrespondance'],
        ['regnskab', 'Regnskab'], ['medlemsliste', 'Medlemsliste/matrikel'], ['program', 'Program/indbydelse'],
        ['tale', 'Tale/foredrag'], ['tegning', 'Tegning/plan'], ['fotografi', 'Fotografi'], ['andet', 'Andet'],
      ), { allowOther: true, sort: 3 }),
      text('titel', 'Titel', { width: 'full', required: true, sort: 4 }),
      field('dato', 'date', { interface: 'datetime', width: 'half', label: 'Dato', sort: 5, note: 'Kun årstal kendt? Skriv det i noter.' }),
      multiline('beskrivelse', 'Beskrivelse', { sort: 6 }),
      minGrad(8), noter(9), oprettet(10), opdateret(11),
    ],
  },
  {
    collection: 'bibliotek',
    meta: {
      icon: 'menu_book',
      note: 'Bøger på biblioteket',
      display_template: '{{titel}} ({{forfatter}})',
      translations: [{ language: LANG, translation: 'Bibliotek', singular: 'Bog', plural: 'Bøger' }],
      sort: 3,
    },
    fields: [
      pk(),
      text('titel', 'Titel', { width: 'full', required: true, sort: 2 }),
      text('forfatter', 'Forfatter', { sort: 3 }),
      field('udgivelsesaar', 'integer', {
        interface: 'input', width: 'half', label: 'Udgivelsesår', sort: 4,
        validation: { _and: [{ udgivelsesaar: { _gte: 1000 } }, { udgivelsesaar: { _lte: 2100 } }] },
        validation_message: 'Angiv et årstal mellem 1000 og 2100',
      }),
      text('udgiver', 'Udgiver', { sort: 5 }),
      text('isbn', 'ISBN', { sort: 6 }),
      dropdown('sprog', 'Sprog', choices(
        ['dansk', 'Dansk'], ['engelsk', 'Engelsk'], ['tysk', 'Tysk'], ['svensk', 'Svensk'],
        ['norsk', 'Norsk'], ['latin', 'Latin'], ['andet', 'Andet'],
      ), { allowOther: true, sort: 7 }),
      field('antal_eksemplarer', 'integer', {
        interface: 'input', width: 'half', label: 'Antal eksemplarer', sort: 8, required: true, default: 1,
        validation: { antal_eksemplarer: { _gte: 1 } }, validation_message: 'Mindst 1 eksemplar',
      }),
      dropdown('status', 'Status', choices(['paa_hylden', 'På hylden'], ['udlaant', 'Udlånt']),
        { default: 'paa_hylden', required: true, sort: 9 }),
      minGrad(11), noter(12), oprettet(13), opdateret(14),
    ],
  },
];

/** Many-to-many mod directus_files via junction-collection. Returnerer { aliasField } til hovedcollectionen. */
async function addFileGallery(api, { main, junction, aliasName, aliasLabel, filesBackref, backrefLabel, sort, note }) {
  const fk = `${main}_id`;
  if (!(await exists(api, `/collections/${junction}`))) {
    await api('POST', '/collections', {
      collection: junction,
      meta: { hidden: true, icon: 'import_export' },
      schema: {},
      fields: [pk()],
    });
    await api('POST', `/fields/${junction}`, { field: fk, type: 'integer', schema: {}, meta: { hidden: true } });
    await api('POST', `/fields/${junction}`, { field: 'directus_files_id', type: 'uuid', schema: {}, meta: { hidden: true } });
    await api('POST', `/fields/${junction}`, { field: 'sort', type: 'integer', schema: {}, meta: { hidden: true } });
  }
  if (!(await exists(api, `/relations/${junction}/${fk}`))) {
    await api('POST', '/relations', {
      collection: junction, field: fk, related_collection: main,
      meta: { one_field: aliasName, junction_field: 'directus_files_id', sort_field: 'sort', one_deselect_action: 'delete' },
      schema: { on_delete: 'CASCADE' },
    });
  }
  if (!(await exists(api, `/relations/${junction}/directus_files_id`))) {
    await api('POST', '/relations', {
      collection: junction, field: 'directus_files_id', related_collection: 'directus_files',
      meta: { one_field: filesBackref, junction_field: fk, one_deselect_action: 'nullify' },
      schema: { on_delete: 'CASCADE' },
    });
  }
  if (!(await exists(api, `/fields/${main}/${aliasName}`))) {
    await api('POST', `/fields/${main}`, {
      field: aliasName, type: 'alias', schema: null,
      meta: {
        special: ['files'], interface: 'files', display: 'related-values',
        options: { layout: 'grid', enableCreate: true, enableSelect: true },
        display_options: { template: '{{directus_files_id.title}}' },
        width: 'full', sort, note, translations: label(aliasLabel),
      },
    });
  }
  await addBackrefField(api, filesBackref, backrefLabel, junction);
}

/** Skjult alias-felt på directus_files, som lader rettighederne følge fra post til fil. */
async function addBackrefField(api, name, labelText, relatedCollection) {
  if (await exists(api, `/fields/directus_files/${name}`)) return;
  await api('POST', '/fields/directus_files', {
    field: name, type: 'alias', schema: null,
    meta: {
      special: ['o2m'], interface: 'list-o2m', hidden: true, readonly: true, width: 'full',
      note: `Bruges til at styre adgang: filen følger graden på posterne i ${relatedCollection}`,
      translations: label(labelText),
    },
  });
}

/** Many-to-one-felt (placering, overordnet, omslag) med evt. omvendt alias-felt. */
async function addM2O(api, { collection, fieldName, related, type, meta, oneField, oneFieldMeta, onDelete = 'SET NULL' }) {
  if (!(await exists(api, `/fields/${collection}/${fieldName}`))) {
    await api('POST', `/fields/${collection}`, { field: fieldName, type, schema: {}, meta });
  }
  if (!(await exists(api, `/relations/${collection}/${fieldName}`))) {
    await api('POST', '/relations', {
      collection, field: fieldName, related_collection: related,
      meta: { one_field: oneField ?? null, one_deselect_action: 'nullify' },
      schema: { on_delete: onDelete },
    });
  }
  if (oneField && oneFieldMeta && !(await exists(api, `/fields/${related}/${oneField}`))) {
    await api('POST', `/fields/${related}`, { field: oneField, type: 'alias', schema: null, meta: oneFieldMeta });
  }
}

const placeringMeta = (sort) => ({
  special: ['m2o'], interface: 'select-dropdown-m2o', width: 'full', sort,
  options: { template: '{{navn}}' },
  display: 'related-values', display_options: { template: '{{navn}}' },
  translations: label('Placering'),
});
const contentList = (template, labelText, sort) => ({
  special: ['o2m'], interface: 'list-o2m', readonly: true, width: 'full', sort,
  options: { template, enableCreate: false, enableSelect: false },
  display: 'related-values', display_options: { template },
  translations: label(labelText),
});

/** Udlån: hvem, hvornår og forventet retur. Felterne vises kun, når status er Udlånt, og er da påkrævede. */
const IKKE_UDLAANT = { name: 'Skjul når ikke udlånt', rule: { _and: [{ status: { _neq: 'udlaant' } }] }, hidden: true, options: {} };
const UDLAANT = (required) => ({ name: 'Udlånt', rule: { _and: [{ status: { _eq: 'udlaant' } }] }, hidden: false, required, options: {} });
const udlaansfelter = () => [
  text('udlaant_til', 'Udlånt til', { width: 'full', note: 'Navnet på låneren. Ses kun af arkivar og administrator.', conditions: [IKKE_UDLAANT, UDLAANT(true)] }),
  field('udlaant_dato', 'date', { interface: 'datetime', width: 'half', label: 'Udlånt den', conditions: [IKKE_UDLAANT, UDLAANT(true)] }),
  field('retur_dato', 'date', { interface: 'datetime', width: 'half', label: 'Forventet retur', note: 'Udfyldes, hvis der er aftalt en dato', conditions: [IKKE_UDLAANT, UDLAANT(false)] }),
];
const KOE = { genstande: 'genstand', arkivmateriale: 'arkivmateriale', bibliotek: 'bog' };

async function addUdlaan(api) {
  if (!(await exists(api, '/fields/arkivmateriale/status'))) {
    await api('POST', '/fields/arkivmateriale', dropdown('status', 'Status', choices(['i_arkiv', 'I arkiv'], ['udlaant', 'Udlånt']),
      { default: 'i_arkiv', required: true }));
  }
  // Køen: én række pr. bruger pr. post. Hvem der står i kø, ses kun af arkivar og administrator (se configure.mjs).
  if (!(await exists(api, '/collections/reservationer'))) {
    await api('POST', '/collections', {
      collection: 'reservationer',
      meta: { hidden: true, icon: 'group', note: 'Kø til udlån', translations: [{ language: LANG, translation: 'Kø', singular: 'Plads i køen', plural: 'Kø' }] },
      schema: {},
      fields: [pk(), oprettet(6)],
    });
  }
  await addM2O(api, {
    collection: 'reservationer', fieldName: 'bruger', related: 'directus_users', type: 'uuid',
    meta: {
      special: ['user-created'], interface: 'select-dropdown-m2o', readonly: true, width: 'half', sort: 2,
      options: { template: '{{first_name}} {{last_name}}' }, display: 'user', translations: label('Bruger'),
    },
    onDelete: 'CASCADE',
  });
  for (const [i, [collection, fieldName]] of Object.entries(KOE).entries()) {
    await addM2O(api, {
      collection: 'reservationer', fieldName, related: collection, type: 'integer',
      meta: { special: ['m2o'], interface: 'select-dropdown-m2o', width: 'half', sort: 3 + i },
      onDelete: 'CASCADE',
    });
    for (const f of udlaansfelter()) {
      if (!(await exists(api, `/fields/${collection}/${f.field}`))) await api('POST', `/fields/${collection}`, f);
    }
    if (!(await exists(api, `/fields/${collection}/koe`))) {
      await api('POST', `/fields/${collection}`, {
        field: 'koe', type: 'alias', schema: null,
        meta: { special: ['alias', 'no-data'], interface: 'udlaan-koe', width: 'full', translations: label('Kø') },
      });
    }
    // Rækkefølge i formularen: udlånsfelterne og køen lige efter status (på arkivmateriale: status efter dato).
    const felter = (await api('GET', `/fields/${collection}`)).sort((a, b) => (a.meta?.sort ?? 999) - (b.meta?.sort ?? 999)).map((f) => f.field);
    const flyt = ['udlaant_til', 'udlaant_dato', 'retur_dato', 'koe'];
    let orden = felter.filter((f) => !flyt.includes(f));
    if (collection === 'arkivmateriale') {
      orden = orden.filter((f) => f !== 'status');
      orden.splice(orden.indexOf('dato') + 1, 0, 'status');
    }
    orden.splice(orden.indexOf('status') + 1, 0, ...flyt);
    for (const [n, f] of orden.entries()) await api('PATCH', `/fields/${collection}/${f}`, { meta: { sort: n + 1 } });
  }
  console.log('= udlån og kø');
}

/** Oversigtsbilleder: et foto af en placering med markeringer (prikker), der peger på genstande og arkivmateriale. */
async function addOversigt(api) {
  if (!(await exists(api, '/collections/oversigtsbilleder'))) {
    await api('POST', '/collections', {
      collection: 'oversigtsbilleder',
      meta: {
        icon: 'pin_drop', note: 'Fotos af placeringer med markerede genstande', display_template: '{{placering.sti}} {{titel}}', sort: 4,
        translations: [{ language: LANG, translation: 'Oversigtsbilleder', singular: 'Oversigtsbillede', plural: 'Oversigtsbilleder' }],
      },
      schema: {},
      fields: [
        pk(),
        text('titel', 'Titel', { width: 'full', sort: 3, note: 'Valgfri, fx "Forside" eller "Bagvæg"' }),
        { ...minGrad(4), meta: { ...minGrad(4).meta, note: 'Laveste grad der må se billedet og dets markeringer (1 = alle medlemmer). Vælg efter, hvem der har adgang til at se stedet i virkeligheden.' } },
        field('billede_skiftet', 'timestamp', { interface: 'datetime', hidden: true, readonly: true, label: 'Billede skiftet', sort: 6 }),
        noter(7), oprettet(8), opdateret(9),
      ],
    });
  }
  await addM2O(api, {
    collection: 'oversigtsbilleder', fieldName: 'placering', related: 'placeringer', type: 'integer',
    meta: { ...placeringMeta(1), interface: 'placering-vaelger', required: true },
    oneField: 'oversigtsbilleder', oneFieldMeta: contentList('{{titel}} (grad {{min_grad}})', 'Oversigtsbilleder', 9),
    onDelete: 'NO ACTION',
  });
  await addM2O(api, {
    collection: 'oversigtsbilleder', fieldName: 'billede', related: 'directus_files', type: 'uuid',
    meta: {
      special: ['file'], interface: 'file-image', width: 'full', sort: 2, display: 'image', required: true,
      note: 'Skiftes billedet, skal markeringerne bekræftes igen i modulet Oversigtsbilleder', translations: label('Billede'),
    },
    oneField: 'i_oversigtsbilleder',
    oneFieldMeta: {
      special: ['o2m'], interface: 'list-o2m', hidden: true, readonly: true, width: 'full',
      note: 'Bruges til at styre adgang: filen følger graden på oversigtsbilledet', translations: label('Bruges i oversigtsbilleder'),
    },
    onDelete: 'NO ACTION',
  });

  const markeringStatus = choices(['placeret', 'Placeret'], ['skal_placeres', 'Skal placeres igen'], ['flyttet', 'Flyttet']);
  if (!(await exists(api, '/collections/markeringer'))) {
    const procent = (name, labelText, sort) => field(name, 'float', {
      interface: 'input', width: 'half', label: labelText, required: true, sort,
      note: 'Procent af billedets ' + (name === 'x' ? 'bredde' : 'højde'),
      validation: { _and: [{ [name]: { _gte: 0 } }, { [name]: { _lte: 100 } }] }, validation_message: 'Angiv et tal fra 0 til 100',
    });
    await api('POST', '/collections', {
      collection: 'markeringer',
      meta: {
        icon: 'location_on', note: 'Prikker på oversigtsbilleder', hidden: true, sort: 5,
        translations: [{ language: LANG, translation: 'Markeringer', singular: 'Markering', plural: 'Markeringer' }],
      },
      schema: {},
      fields: [
        pk(), procent('x', 'X', 4), procent('y', 'Y', 5),
        dropdown('status', 'Status', markeringStatus, { default: 'placeret', required: true, sort: 6 }),
      ],
    });
  }
  await addM2O(api, {
    collection: 'markeringer', fieldName: 'oversigtsbillede', related: 'oversigtsbilleder', type: 'integer',
    meta: {
      special: ['m2o'], interface: 'select-dropdown-m2o', width: 'full', sort: 1, required: true,
      options: { template: '{{placering.sti}} {{titel}}' }, display: 'related-values', display_options: { template: '{{placering.sti}} {{titel}}' },
      translations: label('Oversigtsbillede'),
    },
    oneField: 'markeringer', oneFieldMeta: contentList('{{genstand.inventarnummer}}{{arkivmateriale.arkivnummer}} ({{status}})', 'Markeringer', 5),
    onDelete: 'CASCADE',
  });
  // Præcis én af de to skal være udfyldt; det håndhæves af udvidelsen oversigt-regler. Slettes posten, forsvinder
  // dens markering. Det omvendte felt på posten viser linket "Vis på oversigtsbillede".
  const poster = {
    genstand: ['genstande', '{{inventarnummer}} – {{titel}}', 'Genstand', 2],
    arkivmateriale: ['arkivmateriale', '{{arkivnummer}} – {{titel}}', 'Arkivmateriale', 3],
  };
  for (const [fieldName, [related, template, labelText, sort]] of Object.entries(poster)) {
    await addM2O(api, {
      collection: 'markeringer', fieldName, related, type: 'integer',
      meta: {
        special: ['m2o'], interface: 'select-dropdown-m2o', width: 'half', sort,
        options: { template }, display: 'related-values', display_options: { template }, translations: label(labelText),
      },
      oneField: 'paa_oversigtsbilleder',
      oneFieldMeta: {
        special: ['o2m'], interface: 'oversigt-link', readonly: true, width: 'full',
        display: 'related-values', display_options: { template: '{{oversigtsbillede.titel}}' }, translations: label('Oversigtsbilleder'),
      },
      onDelete: 'CASCADE',
    });
    // Linket står lige efter placeringen på posten.
    const felter = (await api('GET', `/fields/${related}`)).sort((a, b) => (a.meta?.sort ?? 999) - (b.meta?.sort ?? 999)).map((f) => f.field);
    const orden = felter.filter((f) => f !== 'paa_oversigtsbilleder');
    orden.splice(orden.indexOf('placering') + 1, 0, 'paa_oversigtsbilleder');
    for (const [n, f] of orden.entries()) await api('PATCH', `/fields/${related}/${f}`, { meta: { sort: n + 1 } });
  }
  // Modulet skal kunne skjules pr. rolle (udvidelsen menu).
  const skjul = await api('GET', '/fields/directus_roles/skjul_i_menu').catch(() => null);
  const valg = skjul?.meta?.options?.choices;
  if (valg && !valg.some((v) => v.value === 'oversigt')) {
    valg.splice(valg.findIndex((v) => v.value === 'foto') + 1, 0, { text: 'Oversigtsbilleder', value: 'oversigt' });
    await api('PATCH', '/fields/directus_roles/skjul_i_menu', { meta: { options: { ...skjul.meta.options, choices: valg } } });
  }
  console.log('= oversigtsbilleder og markeringer');
}

async function main() {
  await waitForServer();
  const api = await adminClient();

  // directus_users.grad
  if (!(await exists(api, '/fields/directus_users/grad'))) {
    await api('POST', '/fields/directus_users', field('grad', 'integer', {
      interface: 'slider',
      options: { minValue: 1, maxValue: 10, stepInterval: 1, alwaysShowValue: true },
      label: 'Grad', width: 'full', default: 1,
      note: 'Brugerens grad (1-10). Medlemmer ser kun poster hvor "Min. grad" er lig med eller under deres egen grad.',
      validation: { _and: [{ grad: { _gte: 1 } }, { grad: { _lte: 10 } }] },
      validation_message: 'Graden skal være et helt tal fra 1 til 10',
    }));
    console.log('+ directus_users.grad');
  }

  for (const c of collections) {
    if (await exists(api, `/collections/${c.collection}`)) { console.log(`= ${c.collection} findes`); continue; }
    await api('POST', '/collections', { collection: c.collection, meta: c.meta, schema: {}, fields: c.fields });
    console.log(`+ ${c.collection}`);
  }

  // placeringer: hierarki
  await addM2O(api, {
    collection: 'placeringer', fieldName: 'overordnet', related: 'placeringer', type: 'integer',
    meta: {
      special: ['m2o'], interface: 'select-dropdown-m2o', width: 'half', sort: 3,
      options: { template: '{{navn}}' }, display: 'related-values', display_options: { template: '{{navn}}' },
      note: 'Fx reolen en hylde står i, eller rummet en reol står i',
      translations: label('Overordnet placering'),
    },
    oneField: 'underordnede',
    oneFieldMeta: {
      special: ['o2m'], interface: 'list-o2m', readonly: true, width: 'full', sort: 5,
      options: { template: '{{type}}: {{navn}}', enableCreate: false, enableSelect: false },
      display: 'related-values', display_options: { template: '{{navn}}' },
      translations: label('Indeholder'),
    },
  });

  // placering på de tre hovedcollections (+ omvendte lister på placeringer)
  const indhold = {
    genstande: ['indhold_genstande', '{{inventarnummer}} – {{titel}}', 'Genstande her', 6],
    arkivmateriale: ['indhold_arkivmateriale', '{{arkivnummer}} – {{titel}}', 'Arkivmateriale her', 7],
    bibliotek: ['indhold_bibliotek', '{{titel}}', 'Bøger her', 8],
  };
  const placeringSort = { genstande: 12, arkivmateriale: 7, bibliotek: 10 };
  for (const [collection, [oneField, template, labelText, sort]] of Object.entries(indhold)) {
    await addM2O(api, {
      collection, fieldName: 'placering', related: 'placeringer', type: 'integer',
      meta: placeringMeta(placeringSort[collection]),
      oneField, oneFieldMeta: contentList(template, labelText, sort),
    });
  }

  // billeder / scanninger (many-to-many) øverst i formularerne
  await addFileGallery(api, {
    main: 'genstande', junction: 'genstande_files', aliasName: 'billeder', aliasLabel: 'Billeder',
    filesBackref: 'i_genstande', backrefLabel: 'Bruges i genstande', sort: 1,
    note: 'Brug "Tag billede" i menuen til at tage billeder med kameraet. Her kan du også vælge billeder fra galleriet. Første billede er hovedbilledet.',
  });
  await addFileGallery(api, {
    main: 'arkivmateriale', junction: 'arkivmateriale_files', aliasName: 'filer', aliasLabel: 'Filer/scanninger',
    filesBackref: 'i_arkivmateriale', backrefLabel: 'Bruges i arkivmateriale', sort: 1,
    note: 'Scanninger eller fotos af dokumentet. Brug "Tag billede" i menuen til at tage billeder med kameraet.',
  });

  // bibliotek: enkelt omslagsbillede (også øverst)
  await addM2O(api, {
    collection: 'bibliotek', fieldName: 'omslagsbillede', related: 'directus_files', type: 'uuid',
    meta: {
      special: ['file'], interface: 'file-image', width: 'full', sort: 1, display: 'image',
      note: 'Tag et billede af omslaget med kameraet eller vælg fra galleriet',
      translations: label('Omslagsbillede'),
    },
    oneField: 'i_bibliotek',
    oneFieldMeta: {
      special: ['o2m'], interface: 'list-o2m', hidden: true, readonly: true, width: 'full',
      note: 'Bruges til at styre adgang: filen følger graden på bogen',
      translations: label('Bruges i bibliotek'),
    },
  });

  await addUdlaan(api);
  await addOversigt(api);

  console.log('Datamodel færdig.');
}

main().catch((e) => { console.error(e); process.exit(1); });
