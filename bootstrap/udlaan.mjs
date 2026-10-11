// Udlån: flowet, der rydder udlånsoplysningerne ved retur, og bogmærket "Udlånt" til arkivar og administrator.
// Felterne og køen (reservationer) kommer fra schema/snapshot.yaml, rettighederne fra configure.mjs.
// Idempotent: flowet og bogmærkerne nulstilles og lægges ind igen.
import { adminClient, waitForServer } from './lib.mjs';

const api = await (async () => { await waitForServer(); return adminClient(); })();
const SAMLINGER = ['genstande', 'arkivmateriale', 'bibliotek'];

// --- Flow: status sættes til andet end Udlånt -> tøm "Udlånt til", "Udlånt den" og "Forventet retur" ------------
// Filter-flow (kører før ændringen gemmes): det scriptet returnerer, er det, der bliver gemt.
const RYD = `module.exports = function (data) {
  const p = data.$trigger.payload || {};
  if (p.status === undefined || p.status === 'udlaant') return p;
  return { ...p, udlaant_til: null, udlaant_dato: null, retur_dato: null };
};`;
const fundet = await api('GET', `/flows?filter[name][_eq]=${encodeURIComponent('Ryd udlån ved retur')}&limit=1`);
const data = {
  status: 'active', accountability: null, icon: 'assignment_return', trigger: 'event', operation: null,
  description: 'Tømmer udlånsoplysningerne, når status på en post ikke længere er Udlånt.',
  options: { type: 'filter', scope: ['items.update'], collections: SAMLINGER, return: '$last' },
};
const f = fundet.length ? await api('PATCH', `/flows/${fundet[0].id}`, data) : await api('POST', '/flows', { name: 'Ryd udlån ved retur', ...data });
const gamle = await api('GET', `/operations?filter[flow][_eq]=${f.id}&fields=id&limit=-1`);
if (gamle.length) await api('DELETE', '/operations', gamle.map((o) => o.id));
const trin = await api('POST', '/operations', { flow: f.id, name: 'Ryd felterne', key: 'ryd', type: 'exec', position_x: 19, position_y: 1, options: { code: RYD } });
await api('PATCH', `/flows/${f.id}`, { operation: trin.id });
console.log('= flow "Ryd udlån ved retur"');

// --- Bogmærket "Udlånt" pr. samling. Kun for Arkivar og Administrator: kolonnen "Udlånt til" må et medlem ikke
//     hente, så et fælles bogmærke ville give medlemmer en fejl. ------------------------------------------------
const KOLONNER = {
  genstande: ['inventarnummer', 'titel'], arkivmateriale: ['arkivnummer', 'titel'], bibliotek: ['titel', 'forfatter'],
};
const roller = await api('GET', '/roles?fields=id,name&limit=-1');
for (const rolle of roller.filter((r) => ['Arkivar', 'Administrator'].includes(r.name))) {
  for (const collection of SAMLINGER) {
    const preset = {
      icon: 'assignment_ind', layout: 'tabular', filter: { _and: [{ status: { _eq: 'udlaant' } }] },
      layout_query: { tabular: { fields: [...KOLONNER[collection], 'udlaant_til', 'udlaant_dato', 'retur_dato'], sort: ['udlaant_dato'] } },
    };
    const q = `filter[collection][_eq]=${collection}&filter[bookmark][_eq]=${encodeURIComponent('Udlånt')}&filter[role][_eq]=${rolle.id}&filter[user][_null]=true`;
    const har = await api('GET', `/presets?${q}&limit=1`);
    if (har.length) await api('PATCH', `/presets/${har[0].id}`, preset);
    else await api('POST', '/presets', { collection, bookmark: 'Udlånt', role: rolle.id, ...preset });
  }
}
console.log('= bogmærket "Udlånt" for Arkivar og Administrator');
console.log('Udlån færdig.');
