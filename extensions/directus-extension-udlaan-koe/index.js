import { defineComponent, h, ref, onMounted, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Kø til en post (genstand, dokument eller bog): alle kan stille sig i kø og se, hvor mange der står der.
// Hvem der står i køen, ser kun arkivar og administrator - det afgør rettighederne på collectionen reservationer,
// ikke denne fil. Pladsen gemmes med det samme (ikke sammen med resten af formularen). Feltet selv gemmer
// ingenting (alias uden data). Ren JS, ingen build.
const border = '1px solid var(--theme--border-color)';
const st = {
  linje: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '16px' },
  raekke: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 14px', fontSize: '16px', border, borderRadius: '8px', marginTop: '6px' },
  svag: { fontSize: '14px', opacity: 0.7 },
  knap: { padding: '8px 12px', fontSize: '14px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', cursor: 'pointer' },
};
const FELT = { genstande: 'genstand', arkivmateriale: 'arkivmateriale', bibliotek: 'bog' };
const fejltekst = (e) => e.response?.data?.errors?.[0]?.message || e.message;
const dato = (t) => (t ? new Date(t).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const navn = (b) => [b?.first_name, b?.last_name].filter(Boolean).join(' ') || 'Ukendt bruger';

const UdlaanKoe = defineComponent({
  props: { primaryKey: { default: null }, collection: { type: String, default: '' } },
  setup(props) {
    const api = useApi();
    const antal = ref(0);
    const egen = ref(null);     // id på brugerens egen plads i køen
    const liste = ref(null);    // kun for arkivar/administrator: alle pladser med navn
    const hentet = ref(false);
    const gemmer = ref(false);
    const besked = ref('');
    let seq = 0;                // kun det nyeste svar bruges

    const felt = () => FELT[props.collection];
    const nyPost = () => props.primaryKey == null || props.primaryKey === '+';
    const hent = async (filter, fields) => (await api.get('/items/reservationer', { params: {
      filter: JSON.stringify({ _and: [{ [felt()]: { _eq: props.primaryKey } }, ...filter] }), fields, sort: ['id'], limit: -1,
    } })).data.data;

    async function load() {
      const my = ++seq;
      if (nyPost() || !felt()) return;
      try {
        const [alle, mine] = await Promise.all([hent([], ['id']), hent([{ bruger: { _eq: '$CURRENT_USER' } }], ['id'])]);
        // Navnene må kun arkivar og administrator hente; for et medlem afviser Directus kaldet.
        const navne = await hent([], ['id', 'oprettet', 'bruger.first_name', 'bruger.last_name']).catch(() => null);
        if (my !== seq) return;
        antal.value = alle.length;
        egen.value = mine[0]?.id ?? null;
        liste.value = navne && navne.length === alle.length && navne.every((r) => r.bruger) ? navne : null;
        hentet.value = true;
      } catch (e) { if (my === seq) besked.value = 'Kunne ikke hente køen: ' + fejltekst(e); }
    }
    onMounted(load);
    watch([() => props.primaryKey, () => props.collection], load);

    async function udfoer(kald, ok) {
      if (gemmer.value) return;
      gemmer.value = true;
      besked.value = '';
      try { await kald(); await load(); besked.value = ok; } catch (e) { besked.value = 'Det lykkedes ikke: ' + fejltekst(e); }
      gemmer.value = false;
    }
    const stilIKoe = () => udfoer(() => api.post('/items/reservationer', { [felt()]: props.primaryKey }), 'Du står nu i køen. Arkivaren kan se det.');
    const forlad = () => udfoer(() => api.delete(`/items/reservationer/${egen.value}`), 'Du står ikke længere i køen.');
    const fjern = (r) => udfoer(() => api.delete(`/items/reservationer/${r.id}`), 'Pladsen er fjernet fra køen.');

    return () => {
      if (nyPost()) return h('div', { style: st.svag }, 'Gem posten først. Derefter kan man stille sig i kø her.');
      if (!hentet.value) return h('div', { style: st.svag }, besked.value || 'Henter …');
      const k = [h('div', { style: st.linje }, [
        h('span', antal.value === 0 ? 'Ingen står i kø' : antal.value === 1 ? '1 står i kø' : `${antal.value} står i kø`),
        egen.value ? h('span', { style: st.svag }, 'Du står i køen') : null,
        h('button', { type: 'button', style: st.knap, disabled: gemmer.value, onClick: egen.value ? forlad : stilIKoe }, egen.value ? 'Forlad køen' : 'Stil mig i kø'),
      ])];
      (liste.value || []).forEach((r, i) => k.push(h('div', { style: st.raekke }, [
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, `${i + 1}. ${navn(r.bruger)}`),
        h('span', { style: st.svag }, dato(r.oprettet)),
        h('button', { type: 'button', style: st.knap, disabled: gemmer.value, onClick: () => fjern(r) }, 'Fjern'),
      ])));
      if (besked.value) k.push(h('div', { style: { ...st.svag, marginTop: '6px' } }, besked.value));
      return h('div', k);
    };
  },
});

export default {
  id: 'udlaan-koe',
  name: 'Kø til udlån',
  icon: 'group',
  description: 'Stil dig i kø til en post, og se hvor mange der står i køen',
  component: UdlaanKoe,
  options: null,
  types: ['alias'],
  localTypes: ['presentation'],
  group: 'presentation',
};
