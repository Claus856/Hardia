import { defineComponent, h, ref, inject, onMounted, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Tilvalg af søgbar tekst pr. fil på en post i arkivmateriale: ét hak pr. PDF eller billede (soegbar på koblingen
// arkivmateriale_files). Uden hak henter tekstservicen ikke filen, og der gemmes ingen tekst fra den.
// Hakket gemmes med det samme (ikke sammen med resten af formularen), og flowet "Tekstudtræk: filer ændret"
// sætter posten i kø. Feltet selv gemmer ingenting (alias uden data). Ren JS, ingen build.
// Tekstservicens egne søgbare PDF'er (ocr_type på koblingen) har intet hak: de følger hakket på deres kilder.
const border = '1px solid var(--theme--border-color)';
const st = {
  raekke: (aktiv) => ({ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', fontSize: '16px', border, borderRadius: '8px', marginBottom: '6px', cursor: aktiv ? 'pointer' : 'default' }),
  hak: { width: '22px', height: '22px', flex: 'none', accentColor: 'var(--theme--primary)' },
  svag: { fontSize: '14px', opacity: 0.7 },
  knap: { padding: '8px 12px', fontSize: '14px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', marginBottom: '8px' },
  thumb: 'width:36px;height:36px;object-fit:cover;border-radius:4px;flex:none;background:#8884',
};
const fejltekst = (e) => e.response?.data?.errors?.[0]?.message || e.message;
const erPdf = (k) => k.directus_files_id?.type === 'application/pdf';
const erBillede = (k) => (k.directus_files_id?.type || '').startsWith('image/');
const navn = (k) => k.directus_files_id?.title || k.directus_files_id?.filename_download || '';

const SoegbarTekst = defineComponent({
  props: { primaryKey: { default: null }, disabled: { type: Boolean, default: false } },
  setup(props) {
    const api = useApi();
    const vaerdier = inject('values', ref({}));
    const filer = ref([]);      // koblinger, der kan vælges (PDF'er og billeder)
    const egne = ref([]);       // tekstservicens søgbare PDF'er, hvis kilder stadig er på posten
    const hentet = ref(false);
    const gemmer = ref(false);
    const besked = ref('');
    let seq = 0;                // kun det nyeste svar bruges, så et gammelt svar ikke overskriver et nyt valg

    const nyPost = () => props.primaryKey == null || props.primaryKey === '+';
    async function load() {
      const my = ++seq;
      if (nyPost()) { filer.value = []; egne.value = []; hentet.value = true; return; }
      try {
        const r = (await api.get('/items/arkivmateriale_files', { params: {
          filter: JSON.stringify({ arkivmateriale_id: { _eq: props.primaryKey } }), sort: ['sort', 'id'], limit: -1,
          fields: ['id', 'soegbar', 'ocr_type', 'ocr_kilder', 'directus_files_id.id', 'directus_files_id.title', 'directus_files_id.filename_download', 'directus_files_id.type'],
        } })).data.data;
        if (my !== seq) return;
        const paaPosten = new Set(r.filter((k) => !k.ocr_type).map((k) => k.directus_files_id?.id));
        const foelger = (k) => k.ocr_type && (k.ocr_kilder || []).some((id) => paaPosten.has(id));
        egne.value = r.filter(foelger);
        filer.value = r.filter((k) => !foelger(k) && (erPdf(k) || erBillede(k)));
      } catch (e) { if (my === seq) besked.value = 'Kunne ikke hente postens filer: ' + fejltekst(e); }
      hentet.value = true;
    }
    onMounted(load);
    // Når posten gemmes (eller en anden post åbnes), kan filerne være ændret.
    watch([() => props.primaryKey, () => vaerdier.value?.filer], load);

    async function gem(koblinger, valgt) {
      if (props.disabled || gemmer.value || !koblinger.length) return;
      gemmer.value = true;
      besked.value = '';
      seq++;
      try {
        await api.patch('/items/arkivmateriale_files', { keys: koblinger.map((k) => k.id), data: { soegbar: valgt } });
        await load();
        besked.value = valgt
          ? 'Gemt. Teksten læses nu (scanninger og billeder tager lidt længere); genindlæs siden om et øjeblik for at se Tekststatus og forslag til søgeord.'
          : 'Gemt. Teksten fra filen fjernes fra posten om et øjeblik.';
      } catch (e) { besked.value = 'Valget blev ikke gemt: ' + fejltekst(e); }
      gemmer.value = false;
    }

    return () => {
      const k = [];
      const uden = filer.value.filter((p) => !p.soegbar);
      if (!props.disabled && filer.value.length > 1 && uden.length) {
        k.push(h('button', { type: 'button', style: st.knap, disabled: gemmer.value, onClick: () => gem(uden, true) }, `Sæt hak ved alle ${filer.value.length}`));
      }
      filer.value.forEach((p) => k.push(h('label', { style: st.raekke(!props.disabled) }, [
        h('input', { type: 'checkbox', style: st.hak, checked: !!p.soegbar, disabled: props.disabled || gemmer.value, onChange: (e) => { e.target.checked = !!p.soegbar; gem([p], !p.soegbar); } }),
        erBillede(p) ? h('img', { src: `/assets/${p.directus_files_id.id}?key=liste`, style: st.thumb, loading: 'lazy' }) : null,
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, navn(p)),
        h('span', { style: st.svag }, p.soegbar ? 'Søgbar' : 'Læses ikke'),
      ])));
      egne.value.forEach((p) => k.push(h('div', { style: { ...st.raekke(false), borderStyle: 'dashed' } }, [
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, navn(p)),
        h('span', { style: st.svag }, p.ocr_type === 'samlet' ? 'Samlet af tjenesten – følger billedernes hak' : 'Søgbar kopi fra tjenesten – følger scanningens hak'),
      ])));
      if (hentet.value && !filer.value.length && !egne.value.length) {
        k.push(h('div', { style: st.svag }, nyPost()
          ? 'Gem posten først. Derefter kan du vælge her, hvilke filer der skal kunne søges i.'
          : 'Posten har ingen gemte PDF-filer eller billeder. Læg en fil på under Filer/scanninger, og gem posten; så kan du vælge den her.'));
      }
      if (besked.value) k.push(h('div', { style: { ...st.svag, marginTop: '6px' } }, besked.value));
      return h('div', k);
    };
  },
});

export default {
  id: 'soegbar-tekst',
  name: 'Søgbar tekst (tilvalg pr. fil)',
  icon: 'manage_search',
  description: 'Vælg, hvilke af postens PDF\'er og billeder der må læses, så der kan søges i teksten',
  component: SoegbarTekst,
  options: null,
  types: ['alias'],
  localTypes: ['presentation'],
  group: 'presentation',
};
