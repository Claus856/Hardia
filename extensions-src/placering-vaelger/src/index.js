import { defineComponent, h, ref, computed, onMounted, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Trin-for-trin valg af placering (rum -> montre -> hylde) i stedet for en lang dropdown.
const border = '1px solid var(--theme--border-color)';
const st = {
  btn: { padding: '12px 14px', fontSize: '16px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', textAlign: 'left' },
  primary: { padding: '12px 14px', fontSize: '16px', borderRadius: '8px', border: 'none', background: 'var(--theme--primary)', color: '#fff' },
  row: { display: 'flex', width: '100%', justifyContent: 'space-between', padding: '14px', fontSize: '16px', border, borderRadius: '8px', marginBottom: '6px', background: 'transparent', color: 'inherit', textAlign: 'left' },
  crumb: { padding: '6px 10px', borderRadius: '16px', border, background: 'transparent', color: 'inherit', fontSize: '14px' },
};

const Vaelger = defineComponent({
  props: { value: { default: null }, disabled: { type: Boolean, default: false } },
  emits: ['input'],
  setup(props, { emit }) {
    const api = useApi();
    const alle = ref([]);
    const aaben = ref(false);
    const nu = ref(null); // id på den placering vi browser i (null = øverste niveau)
    const fejl = ref('');

    const idOf = (v) => (v && typeof v === 'object' ? v.id : v);
    const byId = computed(() => new Map(alle.value.map((p) => [p.id, p])));
    const sti = (id) => { const s = []; let p = byId.value.get(id); for (let n = 0; p && n < 25; n++) { s.unshift(p); p = byId.value.get(p.overordnet); } return s; };
    const born = (id) => alle.value.filter((p) => (p.overordnet ?? null) === id).sort((a, b) => a.navn.localeCompare(b.navn, 'da'));

    async function load() {
      try { alle.value = (await api.get('/items/placeringer', { params: { fields: ['id', 'navn', 'kode', 'type', 'overordnet'], limit: -1 } })).data.data; }
      catch (e) { fejl.value = 'Kunne ikke hente placeringer'; }
    }
    onMounted(load);
    watch(aaben, (v) => { if (v) { const cur = idOf(props.value); const p = byId.value.get(cur); nu.value = p ? (p.overordnet ?? null) : null; load(); } });

    const vaelg = (id) => { emit('input', id); aaben.value = false; };

    return () => {
      const cur = idOf(props.value);
      const valgtSti = cur != null ? sti(cur) : [];
      const k = [];
      k.push(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        h('div', { style: { ...st.btn, flex: 1, minWidth: '200px', cursor: 'default', opacity: cur != null ? 1 : 0.6 } },
          cur != null ? valgtSti.map((p) => p.navn).join(' › ') : 'Ingen placering valgt'),
        !props.disabled && h('button', { type: 'button', style: st.primary, onClick: () => { aaben.value = !aaben.value; } }, aaben.value ? 'Luk' : (cur != null ? 'Skift placering' : 'Vælg placering')),
      ]));
      if (cur != null && valgtSti.length) k.push(h('div', { style: 'margin-top:4px;font-size:13px;opacity:.7' }, 'Kode: ' + valgtSti.map((p) => p.kode || '?').join('-')));

      if (aaben.value && !props.disabled) {
        const stien = sti(nu.value);
        const c = [h('button', { type: 'button', style: st.crumb, onClick: () => { nu.value = null; } }, 'Alle')];
        stien.forEach((p) => { c.push('›'); c.push(h('button', { type: 'button', style: st.crumb, onClick: () => { nu.value = p.id; } }, p.navn)); });
        const panel = [h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0' }, c)];
        if (nu.value != null) panel.push(h('button', { type: 'button', style: { ...st.primary, width: '100%', marginBottom: '10px' }, onClick: () => vaelg(nu.value) }, `✓ Vælg "${byId.value.get(nu.value)?.navn}"`));
        const b = born(nu.value);
        if (nu.value != null && b.length) panel.push(h('div', { style: 'font-size:13px;opacity:.7;margin:4px 0' }, 'eller gå længere ned:'));
        b.forEach((p) => {
          const harBorn = alle.value.some((x) => x.overordnet === p.id);
          panel.push(h('button', { type: 'button', style: st.row, onClick: () => (harBorn ? (nu.value = p.id) : vaelg(p.id)) },
            [h('span', `${p.navn}${p.type ? ' (' + p.type + ')' : ''}`), h('span', { style: 'opacity:.7' }, harBorn ? '›' : '✓ vælg')]));
        });
        if (!b.length && nu.value == null) panel.push(h('p', { style: 'opacity:.7' }, 'Der er ingen placeringer endnu. Opret dem under "Ny placering".'));
        k.push(h('div', { style: `margin-top:10px;padding:10px;${'border:' + border};border-radius:8px` }, panel));
      }
      if (fejl.value) k.push(h('p', fejl.value));
      return h('div', k);
    };
  },
});

export default {
  id: 'placering-vaelger',
  name: 'Placeringsvælger',
  icon: 'account_tree',
  description: 'Vælg placering trin for trin',
  component: Vaelger,
  options: null,
  types: ['integer'],
  localTypes: ['m2o'],
  group: 'relational',
  relational: true,
};
