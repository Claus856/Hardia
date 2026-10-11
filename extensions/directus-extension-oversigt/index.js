import { defineComponent, h, ref, computed, onMounted, watch, resolveComponent } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { useRoute, useRouter } from 'vue-router';

// Oversigtsbilleder: et stort foto af en placering (montre, rum, væg …) med en prik på hver genstand.
// Vælg placering trin for trin -> vælg billede -> tryk på en prik for at se posten.
// Arkivar og administrator kan tage et nyt oversigtsbillede, sætte og flytte prikker og bekræfte dem igen,
// når billedet er skiftet. Hvad den enkelte må se, afgøres af rettighederne i Directus (se configure.mjs),
// ikke af denne fil: et medlem får slet ikke markeringer for poster over sin grad. Ren JS, ingen build.
const TYPER = {
  genstande: { felt: 'genstand', nr: 'inventarnummer', filer: 'billeder', navn: 'Genstand' },
  arkivmateriale: { felt: 'arkivmateriale', nr: 'arkivnummer', filer: 'filer', navn: 'Dokument' },
};
const STATUS = { i_arkiv: 'I arkiv', udstillet: 'Udstillet', udlaant: 'Udlånt' };
const FARVE = { placeret: 'var(--theme--primary)', skal_placeres: '#e8a400', flyttet: '#d6336c' };
const PLACERINGSTYPE = { rum: 'rum', reol: 'reol', montre: 'montre', vaeg: 'væg', skab: 'skab', hylde: 'hylde', kasse: 'kasse/skuffe', andet: 'andet' };
const MAX_ZOOM = 6;

const border = '1px solid var(--theme--border-color)';
const st = {
  page: { padding: '16px', maxWidth: '900px', margin: '0 auto', fontSize: '16px' },
  btn: { padding: '14px', fontSize: '17px', borderRadius: '8px', border: 'none', background: 'var(--theme--primary)', color: '#fff', width: '100%', marginTop: '10px', cursor: 'pointer' },
  ghost: { padding: '12px', fontSize: '16px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', width: '100%', marginTop: '10px', cursor: 'pointer' },
  lille: { padding: '8px 12px', fontSize: '15px', borderRadius: '8px', border, background: 'var(--theme--background)', color: 'inherit', cursor: 'pointer' },
  row: (on) => ({ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: '16px', border: on ? '2px solid var(--theme--primary)' : border, borderRadius: '8px', marginBottom: '6px', background: 'transparent', color: 'inherit', cursor: 'pointer' }),
  crumbs: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '4px 0 12px', alignItems: 'center' },
  crumb: { padding: '6px 10px', borderRadius: '16px', border, background: 'transparent', color: 'inherit', fontSize: '14px', cursor: 'pointer' },
  h3: { margin: '18px 0 8px', fontSize: '14px', textTransform: 'uppercase', opacity: 0.7 },
  svag: { fontSize: '14px', opacity: 0.7 },
  input: { width: '100%', padding: '12px', fontSize: '16px', margin: '8px 0', boxSizing: 'border-box', border, borderRadius: '8px', background: 'var(--theme--background)', color: 'inherit' },
  kort: { display: 'flex', gap: '12px', padding: '12px', border: '2px solid var(--theme--primary)', borderRadius: '8px', marginTop: '10px', alignItems: 'flex-start' },
  maerke: (farve) => ({ fontSize: '13px', padding: '2px 8px', borderRadius: '10px', background: farve, color: '#fff', whiteSpace: 'nowrap' }),
  nummer: (farve) => ({ width: '26px', height: '26px', flex: 'none', borderRadius: '50%', background: farve, color: '#fff', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }),
  overlay: { position: 'fixed', inset: 0, zIndex: 600, background: 'var(--theme--background)', overflowY: 'auto', padding: '16px' },
};
const STIL = `@keyframes oversigt-puls{0%{box-shadow:0 0 0 0 #fffc,0 0 0 2px #000a}70%{box-shadow:0 0 0 14px #fff0,0 0 0 2px #000a}100%{box-shadow:0 0 0 0 #fff0,0 0 0 2px #000a}}`;

const asset = (id, key) => `/assets/${id}?key=${key}`;
const thumb = (id, size) => (id
  ? h('img', { src: asset(id, 'liste'), style: `width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;flex:none;background:#8884`, loading: 'lazy' })
  : h('span', { style: `width:${size}px;height:${size}px;flex:none;border-radius:6px;border:1px dashed var(--theme--border-color)` }));
const fejltekst = (e) => e.response?.data?.errors?.[0]?.message || e.message;
const begraens = (v, min, max) => Math.min(max, Math.max(min, v));
const postFelter = (c, p = '') => { const t = TYPER[c]; return ['id', t.nr, 'titel', 'status', 'beskrivelse', 'placering', `${t.filer}.directus_files_id.id`, `${t.filer}.directus_files_id.type`].map((f) => p + f); };
/** Ens form for genstande og arkivmateriale, så resten af siden ikke skal skelne. */
function somPost(c, r) {
  const t = TYPER[c];
  const billede = (r[t.filer] || []).map((j) => j.directus_files_id).find((f) => f && (f.type || '').startsWith('image/'));
  return { c, id: r.id, noegle: `${c}:${r.id}`, nr: r[t.nr] || '', titel: r.titel || '', status: r.status, beskrivelse: r.beskrivelse || '', placering: r.placering, thumb: billede?.id || null };
}

const Oversigt = defineComponent({
  setup() {
    const api = useApi();
    const route = useRoute();
    const router = useRouter();
    const { useUserStore, usePermissionsStore } = useStores();
    const kanRette = !!useUserStore().currentUser?.admin_access || usePermissionsStore().hasPermission('oversigtsbilleder', 'create');

    const placeringer = ref([]);
    const billeder = ref([]);       // alle oversigtsbilleder, brugeren må se
    const hentet = ref(false);
    const msg = ref('');
    const busy = ref(false);

    // --- placeringstræet ---
    const byId = computed(() => new Map(placeringer.value.map((p) => [p.id, p])));
    const born = (id) => placeringer.value.filter((p) => (p.overordnet ?? null) === id).sort((a, b) => (a.sortering || '').localeCompare(b.sortering || ''));
    const sti = (id) => { const s = []; let p = byId.value.get(id); for (let n = 0; p && n < 25; n++) { s.unshift(p); p = byId.value.get(p.overordnet); } return s; };
    const undertrae = (id) => { const ids = [id]; for (let i = 0; i < ids.length; i++) born(ids[i]).forEach((p) => ids.push(p.id)); return ids; };
    const stiNavn = (id) => sti(id).map((p) => p.navn).join(' › ');
    const antalBilleder = (id) => { const ids = new Set(undertrae(id)); return billeder.value.filter((b) => ids.has(b.placering)).length; };

    async function hentGrund() {
      try {
        const [p, b] = await Promise.all([
          api.get('/items/placeringer', { params: { fields: ['id', 'navn', 'kode', 'type', 'overordnet', 'sti', 'sortering'], limit: -1 } }),
          api.get('/items/oversigtsbilleder', { params: { fields: ['id', 'titel', 'placering', 'min_grad', 'billede.id', 'billede.width', 'billede.height'], sort: ['id'], limit: -1 } }),
        ]);
        placeringer.value = p.data.data;
        billeder.value = b.data.data.filter((x) => x.billede);
      } catch (e) { msg.value = 'Kunne ikke hente: ' + fejltekst(e); }
      hentet.value = true;
    }

    // --- hvad vises: rutens id er billedet, ?placering er placeringen i træet, ?ny=1 er formularen ---
    const billedeId = computed(() => (route.params.id ? Number(route.params.id) : null));
    const nu = computed(() => (route.query.placering ? Number(route.query.placering) : null));
    const bil = computed(() => billeder.value.find((b) => b.id === billedeId.value) || null);
    const gaa = (placering, ekstra = {}) => router.push({ path: '/oversigt', query: { ...(placering != null ? { placering } : {}), ...ekstra } });
    const aabn = (id, query = {}) => router.push({ path: `/oversigt/${id}`, query });

    // ================= Nyt oversigtsbillede =================
    const ny = ref({ titel: '', grad: '', foreslaaet: null, filer: [] });
    const kamera = ref(null);
    const galleri = ref(null);
    async function forberedNy() {
      const ids = undertrae(nu.value);
      ny.value = { titel: '', grad: '', foreslaaet: null, filer: [] };
      try {
        const maks = async (c) => Number((await api.get(`/items/${c}`, { params: { aggregate: { max: 'min_grad' }, filter: JSON.stringify({ placering: { _in: ids } }) } })).data.data[0]?.max?.min_grad || 0);
        const grad = Math.max(1, await maks('genstande'), await maks('arkivmateriale'));
        const g = (await api.get('/items/genstande', { params: { fields: ['billeder.directus_files_id'], filter: JSON.stringify({ placering: { _in: ids } }), limit: -1 } })).data.data;
        // Titlen (og en grad, brugeren allerede har skrevet) bevares, hvis svaret kommer sent.
        ny.value = { titel: ny.value.titel, grad: ny.value.grad || grad, foreslaaet: grad, filer: [...new Set(g.flatMap((x) => (x.billeder || []).map((j) => j.directus_files_id)).filter(Boolean))] };
      } catch (e) { ny.value.foreslaaet = 0; msg.value = 'Kunne ikke foreslå en grad: ' + fejltekst(e); }
    }
    async function laegOp(file, titel) {
      const form = new FormData();
      form.append('title', titel);
      form.append('file', file);
      return (await api.post('/files', form)).data.data.id;
    }
    async function opret(filId, file) {
      if (busy.value) return;
      const grad = Number(ny.value.grad);
      if (!(grad >= 1 && grad <= 10)) { msg.value = 'Graden skal være et helt tal fra 1 til 10.'; return; }
      busy.value = true; msg.value = file ? 'Overfører…' : '';
      try {
        const navn = `Oversigt ${byId.value.get(nu.value)?.sti || ''} ${ny.value.titel}`.trim();
        const billede = filId || await laegOp(file, navn);
        const r = (await api.post('/items/oversigtsbilleder', { placering: nu.value, billede, titel: ny.value.titel || null, min_grad: grad })).data.data;
        await hentGrund();
        msg.value = '';
        aabn(r.id, { rediger: 1 });
      } catch (e) { msg.value = 'Billedet blev ikke gemt: ' + fejltekst(e); }
      busy.value = false;
    }
    const valgtFil = (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) opret(null, f); };

    // ================= Ét oversigtsbillede =================
    const mark = ref([]);           // markeringer på billedet (kun dem, brugeren må se)
    const valgt = ref(null);        // id på den fremhævede markering
    const rediger = ref(false);
    const poster = ref([]);         // poster under billedets placering (til vælgeren og tælleren; kun arkivar)
    const vaelger = ref(null);      // { x, y } når der er trykket på billedet i redigering
    const soeg = ref('');
    const soegRes = ref([]);
    const kunUmarkerede = ref(false);
    const zoom = ref({ s: 1, tx: 0, ty: 0 });
    const flade = ref(null);
    const nytFoto = ref(null);
    let seq = 0;

    const sortNoegle = (p) => `${byId.value.get(p.placering)?.sortering || '~'} ${p.nr}`;
    const liste = computed(() => [...mark.value].sort((a, b) => sortNoegle(a.post).localeCompare(sortNoegle(b.post), 'da')));
    const nrAf = computed(() => new Map(liste.value.map((m, i) => [m.id, i + 1])));
    const iTrae = computed(() => new Set(bil.value ? undertrae(bil.value.placering) : []));

    async function hentMarkeringer() {
      const my = ++seq;
      const id = billedeId.value;
      if (id == null) return;
      try {
        const r = (await api.get('/items/markeringer', { params: {
          filter: JSON.stringify({ oversigtsbillede: { _eq: id } }), limit: -1,
          fields: ['id', 'x', 'y', 'status', ...postFelter('genstande', 'genstand.'), ...postFelter('arkivmateriale', 'arkivmateriale.')],
        } })).data.data;
        if (my !== seq) return;
        mark.value = r.map((m) => {
          const c = m.genstand ? 'genstande' : m.arkivmateriale ? 'arkivmateriale' : null;
          return c ? { id: m.id, x: Number(m.x), y: Number(m.y), status: m.status, post: somPost(c, m[TYPER[c].felt]) } : null;
        }).filter(Boolean);
      } catch (e) { if (my === seq) msg.value = 'Kunne ikke hente markeringerne: ' + fejltekst(e); }
    }
    async function hentPoster() {
      if (!kanRette || !bil.value) { poster.value = []; return; }
      const filter = JSON.stringify({ placering: { _in: undertrae(bil.value.placering) } });
      try {
        const [g, a] = await Promise.all(Object.keys(TYPER).map((c) => api.get(`/items/${c}`, { params: { fields: postFelter(c), filter, limit: -1 } })));
        poster.value = [...g.data.data.map((r) => somPost('genstande', r)), ...a.data.data.map((r) => somPost('arkivmateriale', r))]
          .sort((x, y) => sortNoegle(x).localeCompare(sortNoegle(y), 'da'));
      } catch (e) { msg.value = 'Kunne ikke hente posterne: ' + fejltekst(e); }
    }
    async function aabnBillede() {
      mark.value = []; poster.value = []; vaelger.value = null; msg.value = '';
      zoom.value = { s: 1, tx: 0, ty: 0 };
      rediger.value = kanRette && !!route.query.rediger;
      valgt.value = route.query.prik ? Number(route.query.prik) : null;
      await Promise.all([hentMarkeringer(), hentPoster()]);
    }

    // --- zoom og panorering: billedet skaleres, prikkerne flyttes med, men beholder deres størrelse ---
    const pegere = new Map();
    let trukket = false;
    let sidste = null;              // afstand og midtpunkt mellem to fingre ved sidste bevægelse
    const maal = () => flade.value.getBoundingClientRect();
    function saetZoom(s, tx, ty) {
      const r = maal();
      s = begraens(s, 1, MAX_ZOOM);
      zoom.value = { s, tx: begraens(tx, r.width - r.width * s, 0), ty: begraens(ty, r.height - r.height * s, 0) };
    }
    function zoomOm(faktor, px, py) {
      const { s, tx, ty } = zoom.value;
      const ny2 = begraens(s * faktor, 1, MAX_ZOOM);
      saetZoom(ny2, px - (px - tx) * (ny2 / s), py - (py - ty) * (ny2 / s));
    }
    const zoomKnap = (faktor) => { const r = maal(); zoomOm(faktor, r.width / 2, r.height / 2); };
    /** Skærmpunkt -> procent af billedet. */
    function tilProcent(ev) {
      const r = maal();
      const { s, tx, ty } = zoom.value;
      return { x: begraens(((ev.clientX - r.left - tx) / (r.width * s)) * 100, 0, 100), y: begraens(((ev.clientY - r.top - ty) / (r.height * s)) * 100, 0, 100) };
    }
    const toFingre = () => { const [a, b] = [...pegere.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    function ned(ev) {
      if (ev.button > 0) return;
      flade.value.setPointerCapture?.(ev.pointerId);
      pegere.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pegere.size === 1) trukket = false;
      if (pegere.size === 2) { trukket = true; sidste = toFingre(); }
    }
    function flyt(ev) {
      const p = pegere.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      if (pegere.size === 1) {
        if (!trukket && Math.hypot(dx, dy) < 8) return;
        trukket = true;
        pegere.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        saetZoom(zoom.value.s, zoom.value.tx + dx, zoom.value.ty + dy);
      } else if (pegere.size === 2) {
        pegere.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const nu2 = toFingre();
        const r = maal();
        zoomOm(nu2.d / (sidste.d || nu2.d), nu2.mx - r.left, nu2.my - r.top);
        saetZoom(zoom.value.s, zoom.value.tx + nu2.mx - sidste.mx, zoom.value.ty + nu2.my - sidste.my);
        sidste = nu2;
      }
    }
    function op(ev, afbrudt) {
      if (!pegere.delete(ev.pointerId)) return;
      if (pegere.size || trukket || afbrudt) return;
      // Et rent tryk på billedet: i redigering sættes en markering her, ellers lukkes kortet.
      if (rediger.value) { vaelger.value = tilProcent(ev); soeg.value = ''; soegRes.value = []; } else valgt.value = null;
    }
    function hjul(ev) {
      ev.preventDefault();
      const r = maal();
      zoomOm(ev.deltaY < 0 ? 1.25 : 0.8, ev.clientX - r.left, ev.clientY - r.top);
    }
    function visPrik(m) {
      valgt.value = m.id;
      if (!flade.value) return;
      const r = maal();
      const { s } = zoom.value;
      if (s > 1) saetZoom(s, r.width / 2 - (m.x / 100) * r.width * s, r.height / 2 - (m.y / 100) * r.height * s);
      flade.value.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }

    // --- prikker: tryk vælger, træk flytter (kun i redigering) ---
    let traek = null;
    function prikNed(ev, m) {
      ev.stopPropagation();
      if (!rediger.value) return;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
      traek = { id: m.id, x0: ev.clientX, y0: ev.clientY, flyttet: false };
    }
    function prikFlyt(ev, m) {
      if (!traek || traek.id !== m.id) return;
      if (!traek.flyttet && Math.hypot(ev.clientX - traek.x0, ev.clientY - traek.y0) < 6) return;
      traek.flyttet = true;
      Object.assign(m, tilProcent(ev));
    }
    async function prikOp(ev, m) {
      ev.stopPropagation();
      const t = traek; traek = null;
      valgt.value = m.id;
      if (t?.id === m.id && t.flyttet) await gemMarkering(m.id, { x: m.x, y: m.y, status: 'placeret' }, 'Prikken er flyttet.');
    }

    async function udfoer(kald, ok) {
      if (busy.value) return;
      busy.value = true; msg.value = '';
      try { await kald(); await hentMarkeringer(); msg.value = ok; } catch (e) { msg.value = 'Det lykkedes ikke: ' + fejltekst(e); await hentMarkeringer(); }
      busy.value = false;
    }
    const gemMarkering = (id, data, ok) => udfoer(() => api.patch(`/items/markeringer/${id}`, data), ok);
    const fjern = (m) => { if (window.confirm(`Fjern markeringen af ${m.post.nr} ${m.post.titel}? Selve posten slettes ikke.`)) udfoer(() => api.delete(`/items/markeringer/${m.id}`), 'Markeringen er fjernet.').then(() => { valgt.value = null; }); };
    const ubekraeftede = computed(() => mark.value.filter((m) => m.status !== 'placeret'));
    const bekraeftAlle = () => udfoer(() => api.patch('/items/markeringer', { keys: ubekraeftede.value.map((m) => m.id), data: { status: 'placeret' } }), 'Alle markeringer er bekræftet.');
    async function vaelg(post) {
      const { x, y } = vaelger.value;
      const har = mark.value.find((m) => m.post.noegle === post.noegle);
      vaelger.value = null;
      await udfoer(async () => {
        if (har) { await api.patch(`/items/markeringer/${har.id}`, { x, y, status: 'placeret' }); valgt.value = har.id; }
        else valgt.value = (await api.post('/items/markeringer', { oversigtsbillede: billedeId.value, [TYPER[post.c].felt]: post.id, x, y })).data.data.id;
      }, har ? 'Markeringen er flyttet hertil.' : `${post.nr} er markeret.`);
    }
    let soegSeq = 0;
    async function soegPoster() {
      const my = ++soegSeq;
      if (!soeg.value.trim()) { soegRes.value = []; return; }
      try {
        const [g, a] = await Promise.all(Object.keys(TYPER).map((c) => api.get(`/items/${c}`, { params: { fields: postFelter(c), search: soeg.value, limit: 30 } })));
        if (my === soegSeq) soegRes.value = [...g.data.data.map((r) => somPost('genstande', r)), ...a.data.data.map((r) => somPost('arkivmateriale', r))];
      } catch (e) { msg.value = 'Søgningen fejlede: ' + fejltekst(e); }
    }
    async function skiftFoto(ev) {
      const f = ev.target.files?.[0]; ev.target.value = '';
      if (!f || busy.value) return;
      if (mark.value.length && !window.confirm('Skift billedet? Alle markeringer skal derefter bekræftes eller flyttes, før medlemmer kan se dem.')) return;
      busy.value = true; msg.value = 'Overfører…';
      try {
        const id = await laegOp(f, `Oversigt ${byId.value.get(bil.value.placering)?.sti || ''} ${bil.value.titel || ''}`.trim());
        await api.patch(`/items/oversigtsbilleder/${bil.value.id}`, { billede: id });
        await hentGrund(); await hentMarkeringer();
        zoom.value = { s: 1, tx: 0, ty: 0 }; rediger.value = true;
        msg.value = mark.value.length ? 'Billedet er skiftet. Træk prikkerne på plads, eller bekræft dem.' : 'Billedet er skiftet.';
      } catch (e) { msg.value = 'Billedet blev ikke skiftet: ' + fejltekst(e); }
      busy.value = false;
    }

    onMounted(async () => {
      if (!document.getElementById('oversigt-stil')) { const s = document.createElement('style'); s.id = 'oversigt-stil'; s.textContent = STIL; document.head.append(s); }
      await hentGrund();
      if (billedeId.value != null) await aabnBillede(); else if (route.query.ny && nu.value != null) await forberedNy();
    });
    watch(billedeId, (id) => { if (id != null && hentet.value) aabnBillede(); });
    watch(() => [route.query.ny, nu.value], () => { msg.value = ''; if (hentet.value && route.query.ny && nu.value != null && billedeId.value == null) forberedNy(); });

    // ================= Tegning =================
    const krummer = (id, sidst) => {
      const c = [h('button', { style: st.crumb, onClick: () => gaa(null) }, 'Alle placeringer')];
      sti(id).forEach((p) => { c.push('›'); c.push(h('button', { style: st.crumb, onClick: () => gaa(p.id) }, p.navn)); });
      if (sidst) { c.push('›'); c.push(h('strong', sidst)); }
      return h('div', { style: st.crumbs }, c);
    };
    const postRaekke = (p, { nr, on, onClick, ekstra }) => h('button', { type: 'button', style: st.row(on), onClick }, [
      nr != null ? h('span', { style: st.nummer(nr.farve) }, nr.tal) : null,
      thumb(p.thumb, 44),
      h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, [h('div', `${p.nr}${p.nr && p.titel ? ' – ' : ''}${p.titel}`), h('div', { style: st.svag }, stiNavn(p.placering) || 'Ingen placering')]),
      ...(ekstra || []),
    ]);

    function tegnTrae() {
      const k = [krummer(nu.value)];
      const her = billeder.value.filter((b) => b.placering === nu.value);
      if (nu.value != null) {
        k.push(h('div', { style: st.h3 }, her.length ? `Oversigtsbilleder af ${byId.value.get(nu.value)?.navn || ''} (${her.length})` : 'Ingen oversigtsbilleder af denne placering'));
        if (her.length) k.push(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px' }, her.map((b) => h('button', { type: 'button', style: 'padding:0;border:none;background:none;color:inherit;cursor:pointer;text-align:left', onClick: () => aabn(b.id) }, [
          h('img', { src: asset(b.billede.id, 'liste'), style: 'width:150px;height:150px;object-fit:cover;border-radius:8px;display:block;background:#8884' }),
          h('div', { style: 'max-width:150px;margin-top:4px' }, b.titel || 'Oversigtsbillede'),
          kanRette ? h('div', { style: st.svag }, `Grad ${b.min_grad}`) : null,
        ]))));
        if (kanRette) k.push(h('button', { type: 'button', style: st.btn, onClick: () => gaa(nu.value, { ny: 1 }) }, '📷 Nyt oversigtsbillede'));
      }
      const b = born(nu.value);
      if (b.length) k.push(h('div', { style: st.h3 }, nu.value != null ? 'Underplaceringer' : 'Vælg placering'));
      b.forEach((p) => {
        const n = antalBilleder(p.id);
        k.push(h('button', { type: 'button', style: st.row(n > 0), onClick: () => gaa(p.id) }, [
          h('span', { style: 'flex:1' }, `${p.navn}${p.type ? ' (' + (PLACERINGSTYPE[p.type] || p.type) + ')' : ''}`),
          n ? h('span', { style: st.maerke('var(--theme--primary)') }, `📷 ${n}`) : null,
          h('span', { style: 'opacity:.7' }, '›'),
        ]));
      });
      if (hentet.value && !placeringer.value.length) k.push(h('p', { style: st.svag }, 'Der er ingen placeringer endnu.'));
      if (hentet.value && nu.value == null && !billeder.value.length) k.push(h('p', { style: st.svag }, 'Der er ingen oversigtsbilleder, du kan se, endnu.'));
      return k;
    }

    function tegnNy() {
      const p = byId.value.get(nu.value);
      const k = [krummer(nu.value, 'Nyt oversigtsbillede')];
      k.push(h('p', `Tag et billede af ${p?.navn || 'placeringen'} lige på og i godt lys, så alle genstande kan ses. Bagefter markerer du genstandene på billedet.`));
      k.push(h('label', { style: st.svag }, 'Titel (valgfri), fx "Forside" eller "Bagvæg"'));
      k.push(h('input', { style: st.input, value: ny.value.titel, maxlength: 100, onInput: (e) => { ny.value.titel = e.target.value; } }));
      k.push(h('label', { style: st.svag }, 'Min. grad: den laveste grad, der må se billedet og dets markeringer'));
      k.push(h('input', { style: st.input, type: 'number', min: 1, max: 10, step: 1, value: ny.value.grad, onInput: (e) => { ny.value.grad = e.target.value; } }));
      k.push(h('p', { style: st.svag }, ny.value.foreslaaet == null ? 'Henter forslag til grad …' : `Forslag: ${ny.value.foreslaaet || '?'}, den højeste grad blandt genstande og dokumenter her og nedenunder. Vælg graden efter, hvem der har adgang til at se stedet i virkeligheden. Genstande over et medlems grad vises ikke som prikker, men de kan ses på selve billedet.`));
      k.push(h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', ref: kamera, onChange: valgtFil }));
      k.push(h('input', { type: 'file', accept: 'image/*', style: 'display:none', ref: galleri, onChange: valgtFil }));
      k.push(h('button', { type: 'button', style: st.btn, disabled: busy.value, onClick: () => kamera.value.click() }, '📷 Tag billedet'));
      k.push(h('button', { type: 'button', style: st.ghost, disabled: busy.value, onClick: () => galleri.value.click() }, 'Vælg et billede fra enheden'));
      if (ny.value.filer.length) {
        k.push(h('div', { style: st.h3 }, 'Eller brug et billede, der allerede ligger på en genstand her'));
        k.push(h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, ny.value.filer.map((id) => h('button', { type: 'button', style: 'padding:0;border:none;background:none;cursor:pointer', disabled: busy.value, onClick: () => opret(id) }, [thumb(id, 96)]))));
      }
      k.push(h('button', { type: 'button', style: st.ghost, onClick: () => gaa(nu.value) }, 'Annullér'));
      return k;
    }

    function tegnVaelger() {
      const markeret = new Map(mark.value.map((m) => [m.post.noegle, m]));
      const raekke = (p) => {
        const m = markeret.get(p.noegle);
        if (m && kunUmarkerede.value) return null;
        const ude = !iTrae.value.has(p.placering);
        return h('div', { style: { opacity: m ? 0.55 : 1 } }, [postRaekke(p, { onClick: () => vaelg(p), ekstra: [
          m ? h('span', { style: st.maerke('#888') }, 'markeret – flyt hertil') : null,
          ude ? h('span', { style: st.maerke('#e8a400') }, '⚠ står et andet sted') : null,
        ] })]);
      };
      const k = [h('div', { style: 'display:flex;align-items:center;gap:12px;max-width:900px;margin:0 auto' }, [
        h('strong', { style: 'flex:1;font-size:18px' }, 'Hvad står her?'),
        h('button', { type: 'button', style: st.lille, onClick: () => { vaelger.value = null; } }, 'Luk'),
      ])];
      const indhold = [];
      indhold.push(h('input', { style: st.input, placeholder: 'Søg i hele arkivet på nummer eller titel…', value: soeg.value, onInput: (e) => { soeg.value = e.target.value; soegPoster(); } }));
      indhold.push(h('label', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0 8px' }, [
        h('input', { type: 'checkbox', style: 'width:20px;height:20px', checked: kunUmarkerede.value, onChange: (e) => { kunUmarkerede.value = e.target.checked; } }), 'Vis kun umarkerede']));
      if (soeg.value.trim()) {
        indhold.push(h('div', { style: st.h3 }, `Søgeresultat (${soegRes.value.length})`));
        if (soegRes.value.some((p) => !iTrae.value.has(p.placering))) indhold.push(h('p', { style: st.svag }, 'Poster med ⚠ er registreret på en anden placering end billedets. De kan godt markeres, fx et maleri, der hænger i rummet.'));
        soegRes.value.forEach((p) => indhold.push(raekke(p)));
      } else {
        undertrae(bil.value.placering).map((id) => byId.value.get(id)).filter(Boolean).sort((a, b) => (a.sortering || '').localeCompare(b.sortering || '')).forEach((pl) => {
          const r = poster.value.filter((p) => p.placering === pl.id).map(raekke).filter(Boolean);
          if (!r.length) return;
          indhold.push(h('div', { style: st.h3 }, stiNavn(pl.id)));
          indhold.push(...r);
        });
        if (!poster.value.length) indhold.push(h('p', { style: st.svag }, 'Der er ingen genstande eller dokumenter registreret på denne placering. Brug søgefeltet for at markere en post, der står et andet sted.'));
      }
      k.push(h('div', { style: 'max-width:900px;margin:0 auto' }, indhold));
      return h('div', { style: st.overlay }, k);
    }

    function tegnBillede() {
      const b = bil.value;
      if (!b) return [krummer(null), h('p', hentet.value ? 'Oversigtsbilledet findes ikke, eller du har ikke adgang til det.' : 'Henter …')];
      const k = [krummer(b.placering, b.titel || 'Oversigtsbillede')];
      const { s, tx, ty } = zoom.value;
      const forhold = b.billede.width && b.billede.height ? b.billede.width / b.billede.height : 4 / 3;
      const synlige = liste.value.filter((m) => rediger.value || m.status === 'placeret');

      // Værktøjslinje
      const linje = [
        h('button', { type: 'button', style: st.lille, title: 'Zoom ud', onClick: () => zoomKnap(0.67) }, '−'),
        h('button', { type: 'button', style: st.lille, title: 'Zoom ind', onClick: () => zoomKnap(1.5) }, '+'),
        s > 1 ? h('button', { type: 'button', style: st.lille, onClick: () => { zoom.value = { s: 1, tx: 0, ty: 0 }; } }, 'Hele billedet') : null,
        h('span', { style: 'flex:1' }),
      ];
      if (kanRette) linje.push(h('button', { type: 'button', style: { ...st.lille, ...(rediger.value ? { background: 'var(--theme--primary)', color: '#fff', border: 'none' } : {}) }, onClick: () => { rediger.value = !rediger.value; msg.value = ''; } }, rediger.value ? '✓ Færdig' : '✎ Redigér markeringer'));
      k.push(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, linje));
      if (kanRette) {
        const medPrik = new Set(mark.value.map((m) => m.post.noegle));
        k.push(h('div', { style: { ...st.svag, marginBottom: '8px' }, 'data-test': 'taeller' }, [
          `${poster.value.filter((p) => medPrik.has(p.noegle)).length} af ${poster.value.length} genstande og dokumenter her er markeret · Grad ${b.min_grad}`,
          rediger.value ? ' · Tryk på billedet for at markere en post. Træk en prik for at flytte den.' : '',
        ]));
      }

      // Billedet med prikker. Bredden begrænses, så hele billedet kan være på skærmen.
      const prikker = synlige.map((m) => {
        const on = valgt.value === m.id;
        const str = on ? 34 : 28;
        return h('button', {
          type: 'button', key: m.id, 'data-prik': m.id, title: `${m.post.nr} ${m.post.titel}`,
          style: {
            position: 'absolute', left: `calc(${tx}px + ${m.x * s}%)`, top: `calc(${ty}px + ${m.y * s}%)`, width: `${str}px`, height: `${str}px`,
            transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '2px solid #fff', background: FARVE[m.status] || FARVE.placeret, color: '#fff',
            fontSize: '13px', fontWeight: 'bold', padding: 0, cursor: rediger.value ? 'grab' : 'pointer', touchAction: 'none', zIndex: on ? 3 : 2,
            boxShadow: '0 0 0 2px #000a', animation: on ? 'oversigt-puls 1.4s ease-out 3' : 'none',
          },
          onPointerdown: (e) => prikNed(e, m), onPointermove: (e) => prikFlyt(e, m), onPointerup: (e) => prikOp(e, m),
          onPointercancel: () => { traek = null; hentMarkeringer(); },
        }, nrAf.value.get(m.id));
      });
      if (vaelger.value) prikker.push(h('span', { style: { position: 'absolute', left: `calc(${tx}px + ${vaelger.value.x * s}%)`, top: `calc(${ty}px + ${vaelger.value.y * s}%)`, width: '20px', height: '20px', transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '3px dashed #fff', boxShadow: '0 0 0 2px #000a' } }));
      k.push(h('div', {
        ref: flade, 'data-test': 'flade',
        style: { position: 'relative', overflow: 'hidden', width: `min(100%, calc(78vh * ${forhold}))`, aspectRatio: String(forhold), margin: '0 auto', borderRadius: '8px', background: '#8884', touchAction: s > 1 || rediger.value ? 'none' : 'pan-y', userSelect: 'none', cursor: rediger.value ? 'crosshair' : s > 1 ? 'grab' : 'default' },
        onPointerdown: ned, onPointermove: flyt, onPointerup: (e) => op(e, false), onPointercancel: (e) => op(e, true), onWheel: hjul,
      }, [
        h('img', { src: asset(b.billede.id, 'visning'), draggable: false, alt: b.titel || 'Oversigtsbillede', style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', transformOrigin: '0 0', transform: `translate(${tx}px,${ty}px) scale(${s})`, pointerEvents: 'none' } }),
        ...prikker,
      ]));

      if (msg.value) k.push(h('p', { style: 'margin:10px 0 0;font-weight:bold' }, msg.value));
      if (rediger.value && ubekraeftede.value.length) k.push(h('button', { type: 'button', style: st.ghost, disabled: busy.value, onClick: bekraeftAlle }, `Bekræft alle ${ubekraeftede.value.length} markeringer, som de står`));

      // Kortet for den valgte prik
      const m = synlige.find((x) => x.id === valgt.value);
      if (m) {
        const p = m.post;
        const tekst = p.beskrivelse.length > 160 ? p.beskrivelse.slice(0, 160).trimEnd() + '…' : p.beskrivelse;
        const kort = [
          h('div', { style: 'font-weight:bold;overflow-wrap:anywhere' }, `${p.nr}${p.nr && p.titel ? ' – ' : ''}${p.titel}`),
          h('div', { style: st.svag }, [TYPER[p.c].navn, STATUS[p.status] ? ` · ${STATUS[p.status]}` : '', ` · ${stiNavn(p.placering) || 'Ingen placering'}`]),
          tekst ? h('div', { style: 'margin-top:6px' }, tekst) : null,
        ];
        if (kanRette && m.status === 'skal_placeres') kort.push(h('div', { style: 'margin-top:6px;color:#e8a400' }, 'Billedet er skiftet. Træk prikken på plads, eller bekræft, at den står rigtigt.'));
        if (kanRette && m.status === 'flyttet') kort.push(h('div', { style: 'margin-top:6px;color:#d6336c' }, 'Posten er flyttet til en placering uden for dette billede. Fjern markeringen, eller bekræft den, hvis den stadig kan ses her.'));
        const knapper = [h(resolveComponent('router-link'), { to: `/content/${p.c}/${p.id}`, style: { ...st.lille, textDecoration: 'none', background: 'var(--theme--primary)', color: '#fff', border: 'none' } }, () => 'Åbn post')];
        if (rediger.value && m.status !== 'placeret') knapper.push(h('button', { type: 'button', style: st.lille, disabled: busy.value, onClick: () => gemMarkering(m.id, { status: 'placeret' }, 'Markeringen er bekræftet.') }, 'Bekræft placering'));
        if (rediger.value) knapper.push(h('button', { type: 'button', style: st.lille, disabled: busy.value, onClick: () => fjern(m) }, 'Fjern markering'));
        kort.push(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, knapper));
        k.push(h('div', { style: st.kort, 'data-test': 'kort' }, [thumb(p.thumb, 72), h('div', { style: 'flex:1;min-width:0' }, kort)]));
      }

      // Listen: de samme markeringer, hylde for hylde
      k.push(h('div', { style: st.h3 }, synlige.length ? `Markeret på billedet (${synlige.length})` : 'Ingen markeringer endnu'));
      synlige.forEach((x) => k.push(postRaekke(x.post, {
        nr: { tal: nrAf.value.get(x.id), farve: FARVE[x.status] || FARVE.placeret }, on: valgt.value === x.id, onClick: () => visPrik(x),
        ekstra: x.status === 'skal_placeres' ? [h('span', { style: st.maerke(FARVE.skal_placeres) }, 'skal placeres igen')] : x.status === 'flyttet' ? [h('span', { style: st.maerke(FARVE.flyttet) }, 'flyttet')] : [],
      })));
      if (kanRette && !rediger.value && ubekraeftede.value.length) k.push(h('p', { style: st.svag }, `${ubekraeftede.value.length} markeringer skal bekræftes og er skjult for medlemmer. Tryk Redigér markeringer for at se dem.`));

      if (kanRette && rediger.value) {
        k.push(h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', ref: nytFoto, onChange: skiftFoto }));
        k.push(h('button', { type: 'button', style: st.ghost, disabled: busy.value, onClick: () => nytFoto.value.click() }, '📷 Skift billedet (nyt foto af samme placering)'));
        k.push(h(resolveComponent('router-link'), { to: `/content/oversigtsbilleder/${b.id}`, style: { ...st.svag, display: 'block', marginTop: '12px' } }, () => 'Ret titel, grad og noter'));
      }
      if (vaelger.value) k.push(tegnVaelger());
      return k;
    }

    return () => {
      const k = billedeId.value != null ? tegnBillede() : route.query.ny && nu.value != null && kanRette ? tegnNy() : tegnTrae();
      if (billedeId.value == null && msg.value) k.push(h('p', { style: 'margin-top:16px;font-weight:bold' }, msg.value));
      // private-view giver Directus' menu, topbjælke og navigation
      return h(resolveComponent('private-view'), { title: 'Oversigtsbilleder' }, { default: () => h('div', { style: st.page }, k) });
    };
  },
});

export default {
  id: 'oversigt',
  name: 'Oversigtsbilleder',
  icon: 'pin_drop',
  routes: [{ path: '', component: Oversigt }, { path: ':id', component: Oversigt }],
  // Vises kun for dem, der må læse oversigtsbilleder.
  preRegisterCheck(user, rettigheder) {
    if (user.admin_access) return true;
    const a = rettigheder.oversigtsbilleder?.read?.access;
    return a === 'partial' || a === 'full';
  },
};
