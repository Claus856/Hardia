import { defineComponent, h, ref, inject, onMounted, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Tilvalg af søgbar tekst pr. PDF på en post i arkivmateriale: ét hak pr. fil (soegbar på koblingen
// arkivmateriale_files). Uden hak henter tekstservicen ikke filen, og der gemmes ingen tekst fra den.
// Hakket gemmes med det samme (ikke sammen med resten af formularen), og flowet "Tekstudtræk: filer ændret"
// sætter posten i kø. Feltet selv gemmer ingenting (alias uden data). Ren JS, ingen build.
const border = '1px solid var(--theme--border-color)';
const st = {
  raekke: (aktiv) => ({ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', fontSize: '16px', border, borderRadius: '8px', marginBottom: '6px', cursor: aktiv ? 'pointer' : 'default' }),
  hak: { width: '22px', height: '22px', flex: 'none', accentColor: 'var(--theme--primary)' },
  svag: { fontSize: '14px', opacity: 0.7 },
};
const fejltekst = (e) => e.response?.data?.errors?.[0]?.message || e.message;

const SoegbarTekst = defineComponent({
  props: { primaryKey: { default: null }, disabled: { type: Boolean, default: false } },
  setup(props) {
    const api = useApi();
    const vaerdier = inject('values', ref({}));
    const pdfer = ref([]);
    const hentet = ref(false);
    const gemmer = ref(null);   // id på den kobling, der gemmes lige nu
    const besked = ref('');
    let seq = 0;                // kun det nyeste svar bruges, så et gammelt svar ikke overskriver et nyt valg

    const nyPost = () => props.primaryKey == null || props.primaryKey === '+';
    async function load() {
      const my = ++seq;
      if (nyPost()) { pdfer.value = []; hentet.value = true; return; }
      try {
        const r = (await api.get('/items/arkivmateriale_files', { params: {
          filter: JSON.stringify({ arkivmateriale_id: { _eq: props.primaryKey } }), sort: ['sort', 'id'], limit: -1,
          fields: ['id', 'soegbar', 'directus_files_id.title', 'directus_files_id.filename_download', 'directus_files_id.type'],
        } })).data.data;
        if (my !== seq) return;
        pdfer.value = r.filter((k) => k.directus_files_id?.type === 'application/pdf');
      } catch (e) { if (my === seq) besked.value = 'Kunne ikke hente postens filer: ' + fejltekst(e); }
      hentet.value = true;
    }
    onMounted(load);
    // Når posten gemmes (eller en anden post åbnes), kan filerne være ændret.
    watch([() => props.primaryKey, () => vaerdier.value?.filer], load);

    async function skift(k) {
      if (props.disabled || gemmer.value != null) return;
      const valgt = !k.soegbar;
      gemmer.value = k.id;
      besked.value = '';
      seq++;
      try {
        await api.patch(`/items/arkivmateriale_files/${k.id}`, { soegbar: valgt });
        await load();
        besked.value = valgt
          ? 'Gemt. Teksten læses nu; genindlæs siden om et øjeblik for at se Tekststatus og forslag til søgeord.'
          : 'Gemt. Teksten fra filen fjernes fra posten om et øjeblik.';
      } catch (e) { besked.value = 'Valget blev ikke gemt: ' + fejltekst(e); }
      gemmer.value = null;
    }

    return () => {
      const k = pdfer.value.map((p) => h('label', { style: st.raekke(!props.disabled) }, [
        h('input', { type: 'checkbox', style: st.hak, checked: !!p.soegbar, disabled: props.disabled || gemmer.value != null, onChange: (e) => { e.target.checked = !!p.soegbar; skift(p); } }),
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, p.directus_files_id.title || p.directus_files_id.filename_download),
        h('span', { style: st.svag }, p.soegbar ? 'Søgbar' : 'Læses ikke'),
      ]));
      if (hentet.value && !pdfer.value.length) {
        k.push(h('div', { style: st.svag }, nyPost()
          ? 'Gem posten først. Derefter kan du vælge her, hvilke PDF\'er der skal kunne søges i.'
          : 'Posten har ingen gemte PDF-filer. Læg en PDF på under Filer/scanninger, og gem posten; så kan du vælge den her.'));
      }
      if (besked.value) k.push(h('div', { style: { ...st.svag, marginTop: '6px' } }, besked.value));
      return h('div', k);
    };
  },
});

export default {
  id: 'soegbar-tekst',
  name: 'Søgbar tekst (tilvalg pr. PDF)',
  icon: 'manage_search',
  description: 'Vælg, hvilke af postens PDF\'er der må læses, så der kan søges i teksten',
  component: SoegbarTekst,
  options: null,
  types: ['alias'],
  localTypes: ['presentation'],
  group: 'presentation',
};
