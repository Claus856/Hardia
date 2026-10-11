import { defineComponent, h, ref, onMounted, watch, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// "Vis på oversigtsbillede" på en genstand eller et arkivmateriale: ét link pr. oversigtsbillede, posten er markeret
// på. Linket åbner modulet Oversigtsbilleder med billedet fremme og prikken fremhævet. Feltet er det omvendte
// alias-felt for relationen fra markeringer; det viser kun og gemmer ingenting. Ren JS, ingen build.
const FELT = { genstande: 'genstand', arkivmateriale: 'arkivmateriale' };
const st = {
  link: { display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px', fontSize: '16px', borderRadius: '8px', border: '1px solid var(--theme--primary)', color: 'var(--theme--primary)', marginRight: '8px', marginBottom: '6px', textDecoration: 'none' },
  svag: { fontSize: '14px', opacity: 0.7 },
};

const OversigtLink = defineComponent({
  props: { primaryKey: { default: null }, collection: { type: String, default: '' } },
  setup(props) {
    const api = useApi();
    const markeringer = ref(null);
    let seq = 0;
    async function load() {
      const my = ++seq;
      const felt = FELT[props.collection];
      if (!felt || props.primaryKey == null || props.primaryKey === '+') { markeringer.value = []; return; }
      try {
        const r = (await api.get('/items/markeringer', { params: {
          filter: JSON.stringify({ [felt]: { _eq: props.primaryKey } }), limit: -1,
          fields: ['id', 'status', 'oversigtsbillede.id', 'oversigtsbillede.titel', 'oversigtsbillede.placering.navn'],
        } })).data.data;
        if (my === seq) markeringer.value = r.filter((m) => m.oversigtsbillede);
      } catch { if (my === seq) markeringer.value = []; }
    }
    onMounted(load);
    watch([() => props.primaryKey, () => props.collection], load);

    return () => {
      if (!markeringer.value) return h('div', { style: st.svag }, 'Henter …');
      if (!markeringer.value.length) return h('div', { style: st.svag }, 'Posten er ikke markeret på noget oversigtsbillede.');
      return h('div', markeringer.value.map((m) => h(resolveComponent('router-link'), {
        to: { path: `/oversigt/${m.oversigtsbillede.id}`, query: { prik: m.id } }, style: st.link,
      }, () => [
        '📍 Vis på oversigtsbillede: ',
        [m.oversigtsbillede.placering?.navn, m.oversigtsbillede.titel].filter(Boolean).join(' – '),
        m.status === 'placeret' ? '' : m.status === 'flyttet' ? ' (flyttet)' : ' (skal placeres igen)',
      ])));
    };
  },
});

export default {
  id: 'oversigt-link',
  name: 'Vis på oversigtsbillede',
  icon: 'pin_drop',
  description: 'Link til de oversigtsbilleder, posten er markeret på',
  component: OversigtLink,
  options: null,
  types: ['alias'],
  localTypes: ['o2m'],
  group: 'relational',
  relational: true,
};
