import { defineComponent, h, ref, computed, onMounted, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Søg i hele arkivet: fritekst, afgrænset til samling, placering (med alt nedenunder) og evt. ét felt.
// Alt hentes som den indloggede bruger, så grad-filtreringen gælder uændret.
const SAML = {
  genstande: { label: 'Genstande', nr: 'inventarnummer', billede: 'billeder.directus_files_id' },
  arkivmateriale: { label: 'Arkiv', nr: 'arkivnummer', billede: 'filer.directus_files_id' },
  bibliotek: { label: 'Bibliotek', nr: null, billede: 'omslagsbillede' },
};
const TRIN = 50;

const border = '1px solid var(--theme--border-color)';
const st = {
  page: { padding: '16px', maxWidth: '720px', margin: '0 auto', fontSize: '16px' },
  input: { width: '100%', padding: '12px', fontSize: '16px', boxSizing: 'border-box', borderRadius: '6px', border },
  tab: (on) => ({ flex: 1, padding: '10px 4px', fontSize: '15px', borderRadius: '8px', border: '1px solid var(--theme--primary)', background: on ? 'var(--theme--primary)' : 'transparent', color: on ? '#fff' : 'inherit' }),
  label: { display: 'block', margin: '14px 0 4px', fontSize: '14px', opacity: 0.8 },
  crumbs: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  crumb: (on) => ({ padding: '6px 10px', borderRadius: '16px', border, background: on ? 'var(--theme--primary)' : 'transparent', color: on ? '#fff' : 'inherit', fontSize: '14px' }),
  row: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', border, borderRadius: '8px', marginBottom: '8px', color: 'inherit', textDecoration: 'none' },
  h3: { margin: '20px 0 8px', fontSize: '14px', textTransform: 'uppercase', opacity: 0.7 },
  ghost: { padding: '12px', fontSize: '16px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', width: '100%' },
};
const fejl = (e) => e.response?.data?.errors?.[0]?.message || e.message;
const thumb = (id) => h('img', { src: `/assets/${id}?key=liste`, style: 'width:48px;height:48px;object-fit:cover;border-radius:6px;flex:none;background:#8884', loading: 'lazy' });
const tom = () => h('span', { style: 'width:48px;height:48px;flex:none;border-radius:6px;border:1px dashed var(--theme--border-color)' });

const SPRING_OVER = ['m2o', 'o2m', 'm2m', 'files', 'file', 'date-created', 'date-updated'];
const TAL = ['integer', 'bigInteger', 'float', 'decimal'];
/** Directus-feltdefinition -> { felt, label, slags: 'tekst'|'valg'|'tal', valg, andet } eller null, hvis der ikke kan søges i feltet. */
function soegbart(f) {
  const m = f.meta || {};
  if (m.hidden || (m.special || []).some((s) => SPRING_OVER.includes(s))) return null;
  const label = (m.translations || []).find((t) => t.language === 'da-DK')?.translation || f.field;
  const valg = m.options?.choices;
  if (Array.isArray(valg)) return { felt: f.field, label, slags: 'valg', valg, andet: !!m.options.allowOther };
  if (['string', 'text'].includes(f.type)) return { felt: f.field, label, slags: 'tekst' };
  if (TAL.includes(f.type)) return { felt: f.field, label, slags: 'tal' };
  return null;
}
/** Betingelser for ét ord i ét felt (tom liste = ordet kan ikke findes i feltet). */
function betingelser(f, ord) {
  if (f.slags === 'tekst') return [{ [f.felt]: { _icontains: ord } }];
  if (f.slags === 'tal') return /^\d+$/.test(ord) ? [{ [f.felt]: { _eq: Number(ord) } }] : [];
  const b = [];
  const koder = f.valg.filter((v) => String(v.text).toLowerCase().includes(ord.toLowerCase())).map((v) => v.value);
  if (koder.length) b.push({ [f.felt]: { _in: koder } });
  if (f.andet) b.push({ [f.felt]: { _icontains: ord } });
  return b;
}

const Soeg = defineComponent({
  setup() {
    const api = useApi();
    const q = ref('');
    const hvor = ref('alt');
    const felt = ref('');            // '' = alle felter, ellers feltets danske navn
    const sti = ref([]);             // valgt placering: rum -> montre -> hylde
    const placeringer = ref([]);
    const felter = ref({});          // samling -> søgbare felter
    const res = ref({});             // samling -> { items, antal }
    const graense = ref(TRIN);
    const msg = ref('');
    const klar = ref(false);
    let seq = 0, timer = null;

    const samlinger = computed(() => (hvor.value === 'alt' ? Object.keys(SAML) : [hvor.value]).filter((c) => felter.value[c]));
    const feltvalg = computed(() => [...new Set(samlinger.value.flatMap((c) => felter.value[c].map((f) => f.label)))]);
    const born = (id) => placeringer.value.filter((p) => (p.overordnet ?? null) === id);
    const undertrae = (id) => { const ids = [id]; for (let i = 0; i < ids.length; i++) born(ids[i]).forEach((p) => ids.push(p.id)); return ids; };

    function filter(c) {
      const og = [];
      const mulige = felt.value ? felter.value[c].filter((f) => f.label === felt.value) : felter.value[c];
      if (felt.value && !mulige.length) return null; // samlingen har ikke det valgte felt
      for (const ord of q.value.trim().split(/\s+/).filter(Boolean)) {
        const eller = mulige.flatMap((f) => betingelser(f, ord));
        if (!eller.length) return null;
        og.push({ _or: eller });
      }
      const nu = sti.value[sti.value.length - 1];
      if (nu) og.push({ placering: { _in: undertrae(nu.id) } });
      return og.length ? { _and: og } : {};
    }

    async function load() {
      const my = ++seq;
      msg.value = '';
      if (!q.value.trim() && hvor.value === 'alt' && !sti.value.length) { res.value = {}; return; }
      try {
        const ny = {};
        await Promise.all(samlinger.value.map(async (c) => {
          const s = SAML[c], f = filter(c);
          if (!f) { ny[c] = { items: [], antal: 0 }; return; }
          const har = (n) => felter.value[c].some((x) => x.felt === n);
          const r = (await api.get(`/items/${c}`, { params: {
            filter: JSON.stringify(f), limit: graense.value, meta: 'filter_count', sort: [s.nr || 'titel'],
            fields: ['id', 'titel', s.nr, har('forfatter') && 'forfatter', har('status') && 'status', 'placering.sti', 'placering.navn', s.billede].filter(Boolean),
          } })).data;
          ny[c] = { items: r.data, antal: r.meta?.filter_count ?? r.data.length };
        }));
        if (my === seq) res.value = ny;
      } catch (e) { if (my === seq) msg.value = 'Søgningen fejlede: ' + fejl(e); }
    }
    const nyt = () => { graense.value = TRIN; if (!feltvalg.value.includes(felt.value)) felt.value = ''; load(); };
    const tast = (e) => { q.value = e.target.value; clearTimeout(timer); timer = setTimeout(nyt, 300); };

    onMounted(async () => {
      try {
        const f = {};
        await Promise.all(Object.keys(SAML).map(async (c) => {
          // En samling, brugeren ikke må se, udelades blot.
          try { f[c] = (await api.get(`/fields/${c}`)).data.data.sort((x, y) => (x.meta?.sort ?? 99) - (y.meta?.sort ?? 99)).map(soegbart).filter(Boolean); } catch { /* ingen adgang */ }
        }));
        felter.value = f;
        placeringer.value = (await api.get('/items/placeringer', { params: { fields: ['id', 'navn', 'kode', 'overordnet'], sort: ['sortering'], limit: -1 } })).data.data;
      } catch (e) { msg.value = 'Kunne ikke hente opsætningen: ' + fejl(e); }
      klar.value = true;
    });

    const billede = (it, c) => { const v = c === 'bibliotek' ? it.omslagsbillede : (it.billeder || it.filer || [])[0]?.directus_files_id; return v ? thumb(v) : tom(); };
    const statustekst = (c, v) => felter.value[c].find((f) => f.felt === 'status')?.valg?.find((x) => x.value === v)?.text || v;

    return () => {
      const Link = resolveComponent('router-link');
      const k = [];
      k.push(h('input', { style: st.input, type: 'search', placeholder: 'Søg i arkivet…', value: q.value, onInput: tast, autofocus: true }));

      k.push(h('div', { style: 'display:flex;gap:6px;margin-top:12px' }, [['alt', 'Alt'], ...Object.entries(SAML).filter(([c]) => felter.value[c]).map(([c, s]) => [c, s.label])].map(([c, l]) =>
        h('button', { type: 'button', style: st.tab(hvor.value === c), onClick: () => { hvor.value = c; nyt(); } }, l))));

      k.push(h('span', { style: st.label }, 'Placering (inkl. alt under den)'));
      const gaa = (n) => { sti.value = sti.value.slice(0, n); nyt(); };
      const c = [h('button', { type: 'button', style: st.crumb(!sti.value.length), onClick: () => gaa(0) }, 'Alle placeringer')];
      sti.value.forEach((p, n) => { c.push('›'); c.push(h('button', { type: 'button', style: st.crumb(n === sti.value.length - 1), onClick: () => gaa(n + 1) }, p.navn)); });
      k.push(h('div', { style: st.crumbs }, c));
      const b = born(sti.value[sti.value.length - 1]?.id ?? null);
      if (b.length) k.push(h('div', { style: { ...st.crumbs, marginTop: '8px' } }, b.map((p) =>
        h('button', { type: 'button', style: st.crumb(false), onClick: () => { sti.value = [...sti.value, p]; nyt(); } }, `${p.navn} ›`))));

      k.push(h('span', { style: st.label }, 'Søg i'));
      k.push(h('select', { style: st.input, value: felt.value, onChange: (e) => { felt.value = e.target.value; nyt(); } },
        [h('option', { value: '', selected: !felt.value }, 'Alle felter'), ...feltvalg.value.map((l) => h('option', { value: l, selected: l === felt.value }, l))]));

      if (msg.value) k.push(h('p', { style: 'margin-top:16px;font-weight:bold' }, msg.value));

      const vist = samlinger.value.filter((s) => res.value[s]);
      if (!vist.length && klar.value && !msg.value) k.push(h('p', { style: 'margin-top:20px;opacity:.7' }, 'Skriv et søgeord, eller vælg en samling eller placering for at se alt dér.'));
      else if (vist.length && !vist.some((s) => res.value[s].antal)) k.push(h('p', { style: 'margin-top:20px;opacity:.7' }, 'Ingen poster fundet.'));
      for (const s of vist) {
        const r = res.value[s];
        if (!r.antal) continue;
        k.push(h('div', { style: st.h3 }, `${SAML[s].label} (${r.antal})`));
        r.items.forEach((it) => k.push(h(Link, { to: `/content/${s}/${it.id}`, style: st.row }, { default: () => [
          billede(it, s),
          h('span', { style: 'flex:1;min-width:0' }, [
            h('div', [SAML[s].nr ? h('strong', `${it[SAML[s].nr] || ''} ` ) : null, it.titel || '', it.forfatter ? ` (${it.forfatter})` : '']),
            h('div', { style: 'font-size:14px;opacity:.7' }, [it.placering ? `${it.placering.sti || ''} ${it.placering.navn || ''}` : 'Ingen placering', it.status ? ` · ${statustekst(s, it.status)}` : '']),
          ]),
        ] })));
      }
      if (vist.some((s) => res.value[s].antal > res.value[s].items.length)) {
        k.push(h('button', { type: 'button', style: st.ghost, onClick: () => { graense.value += TRIN; load(); } }, 'Vis flere'));
      }
      return h(resolveComponent('private-view'), { title: 'Søg' }, { default: () => h('div', { style: st.page }, k) });
    };
  },
});

export default { id: 'soeg', name: 'Søg', icon: 'search', routes: [{ path: '', component: Soeg }] };
