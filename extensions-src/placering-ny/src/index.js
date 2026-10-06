import { defineComponent, h, ref, computed, onMounted, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Opret en placering (fx en montre) og dens hylder/bagvæg på én gang.
const TYPER = [['rum', 'Rum'], ['montre', 'Montre'], ['skab', 'Skab'], ['reol', 'Reol'], ['vaeg', 'Væg'], ['hylde', 'Hylde'], ['kasse', 'Kasse/skuffe'], ['andet', 'Andet']];
const border = '1px solid var(--theme--border-color)';
const st = {
  page: { padding: '16px', maxWidth: '640px', margin: '0 auto', fontSize: '16px' },
  label: { display: 'block', margin: '14px 0 4px', fontSize: '14px', opacity: 0.8 },
  input: { width: '100%', padding: '12px', fontSize: '16px', boxSizing: 'border-box', borderRadius: '6px', border },
  btn: { padding: '16px', fontSize: '18px', borderRadius: '8px', border: 'none', background: 'var(--theme--primary)', color: '#fff', width: '100%', marginTop: '16px' },
  crumb: { padding: '6px 10px', borderRadius: '16px', border, background: 'transparent', color: 'inherit', fontSize: '14px' },
  row: { display: 'block', width: '100%', textAlign: 'left', padding: '12px', fontSize: '16px', border, borderRadius: '8px', marginBottom: '6px', background: 'transparent', color: 'inherit' },
  box: { padding: '12px', border, borderRadius: '8px', marginTop: '8px' },
};
const fejl = (e) => e.response?.data?.errors?.[0]?.message || e.message;

const Ny = defineComponent({
  setup() {
    const api = useApi();
    const alle = ref([]);
    const forælder = ref(null);
    const type = ref('montre');
    const navn = ref('');
    const kode = ref('');
    const kodeRørt = ref(false);
    const hylder = ref(0);
    const bagvæg = ref(false);
    const msg = ref('');
    const busy = ref(false);

    const byId = computed(() => new Map(alle.value.map((p) => [p.id, p])));
    const sti = (id) => { const s = []; let p = byId.value.get(id); for (let n = 0; p && n < 25; n++) { s.unshift(p); p = byId.value.get(p.overordnet); } return s; };
    const born = (id) => alle.value.filter((p) => (p.overordnet ?? null) === id).sort((a, b) => a.navn.localeCompare(b.navn, 'da'));
    const prefix = computed(() => sti(forælder.value).map((p) => p.kode || '?').join('-'));

    function forslag() {
      if (kodeRørt.value) return;
      const t = TYPER.find((x) => x[0] === type.value);
      const antal = born(forælder.value).filter((p) => p.type === type.value).length;
      kode.value = (t[1][0] + (antal + 1)).toUpperCase();
    }
    async function load() {
      try { alle.value = (await api.get('/items/placeringer', { params: { fields: ['id', 'navn', 'kode', 'type', 'overordnet'], limit: -1 } })).data.data; forslag(); }
      catch (e) { msg.value = 'Kunne ikke hente placeringer: ' + fejl(e); }
    }
    onMounted(load);

    const kodeFuld = (k) => [prefix.value, k].filter(Boolean).join('-');
    const børn = () => {
      const l = [];
      for (let i = 1; i <= Number(hylder.value || 0); i++) l.push({ navn: `Hylde ${i}`, kode: `H${i}`, type: 'hylde' });
      if (bagvæg.value) l.push({ navn: 'Bagvæg', kode: 'BV', type: 'bagvaeg' });
      return l;
    };

    async function opret() {
      msg.value = '';
      if (!navn.value.trim() || !kode.value.trim()) { msg.value = 'Udfyld både navn og kode.'; return; }
      busy.value = true;
      try {
        const p = (await api.post('/items/placeringer', { navn: navn.value.trim(), kode: kode.value.trim(), type: type.value, overordnet: forælder.value })).data.data;
        const kids = børn().map((b) => ({ ...b, overordnet: p.id }));
        if (kids.length) await api.post('/items/placeringer', kids);
        msg.value = `✓ Oprettet ${kodeFuld(p.kode)} "${p.navn}"${kids.length ? ` med ${kids.length} underplaceringer` : ''}.`;
        navn.value = ''; kodeRørt.value = false; hylder.value = 0; bagvæg.value = false;
        await load();
      } catch (e) { msg.value = 'Fejl: ' + fejl(e); }
      finally { busy.value = false; }
    }

    return () => {
      const k = [h('h2', 'Ny placering')];

      // 1) Hvor skal den ligge?
      k.push(h('span', { style: st.label }, 'Hvor skal den ligge?'));
      const c = [h('button', { type: 'button', style: st.crumb, onClick: () => { forælder.value = null; forslag(); } }, 'Øverste niveau')];
      sti(forælder.value).forEach((p) => { c.push('›'); c.push(h('button', { type: 'button', style: st.crumb, onClick: () => { forælder.value = p.id; forslag(); } }, p.navn)); });
      k.push(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' }, c));
      const b = born(forælder.value);
      if (b.length) k.push(h('div', { style: { marginTop: '8px' } }, b.map((p) => h('button', { type: 'button', style: st.row, onClick: () => { forælder.value = p.id; forslag(); } }, `${p.navn} › (${p.kode || '?'})`))));

      // 2) Hvad er det?
      k.push(h('span', { style: st.label }, 'Type'));
      k.push(h('select', { style: st.input, value: type.value, onChange: (e) => { type.value = e.target.value; forslag(); } }, TYPER.map(([v, l]) => h('option', { value: v, selected: v === type.value }, l))));
      k.push(h('span', { style: st.label }, 'Navn'));
      k.push(h('input', { style: st.input, value: navn.value, placeholder: 'fx Montre 1', onInput: (e) => { navn.value = e.target.value; } }));
      k.push(h('span', { style: st.label }, 'Kode (bruges i genstandsnumre; kun A-Z og tal)'));
      k.push(h('input', { style: st.input, value: kode.value, onInput: (e) => { kode.value = e.target.value.toUpperCase(); kodeRørt.value = true; } }));

      // 3) Skabelon
      k.push(h('span', { style: st.label }, 'Antal hylder'));
      k.push(h('input', { style: st.input, type: 'number', min: 0, max: 40, value: hylder.value, onInput: (e) => { hylder.value = Math.max(0, Math.min(40, Number(e.target.value))); } }));
      k.push(h('label', { style: 'display:flex;gap:10px;align-items:center;margin-top:14px' }, [
        h('input', { type: 'checkbox', checked: bagvæg.value, style: 'width:22px;height:22px', onChange: (e) => { bagvæg.value = e.target.checked; } }), 'Med bagvæg']));

      // 4) Forhåndsvisning
      const kids = børn();
      k.push(h('div', { style: st.box }, [
        h('strong', 'Det bliver oprettet'),
        h('div', { style: 'margin-top:6px' }, `${kodeFuld(kode.value) || '…'}  ${navn.value || '(navn mangler)'}`),
        ...kids.map((x) => h('div', { style: 'opacity:.8;padding-left:16px' }, `${kodeFuld(kode.value)}-${x.kode}  ${x.navn}`)),
      ]));
      k.push(h('button', { type: 'button', style: st.btn, disabled: busy.value, onClick: opret }, 'Opret'));
      if (msg.value) k.push(h('p', { style: 'margin-top:16px;font-weight:bold' }, msg.value));
      return h(resolveComponent('private-view'), { title: 'Ny placering' }, { default: () => h('div', { style: st.page }, k) });
    };
  },
});

export default { id: 'ny-placering', name: 'Ny placering', icon: 'add_location_alt', routes: [{ path: '', component: Ny }] };
