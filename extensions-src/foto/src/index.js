import { defineComponent, h, ref, onMounted, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Vælg placering (rum -> montre -> hylde) -> vælg post -> "Tag billede" -> billedet knyttes til posten.
const TYPER = {
  genstande: { label: 'Genstande', nr: 'inventarnummer', junction: 'genstande_files', fk: 'genstande_id', alias: 'billeder' },
  arkivmateriale: { label: 'Arkivmateriale', nr: 'arkivnummer', junction: 'arkivmateriale_files', fk: 'arkivmateriale_id', alias: 'filer' },
};

const border = '1px solid var(--theme--border-color)';
const st = {
  page: { padding: '16px', maxWidth: '640px', margin: '0 auto', fontSize: '16px' },
  btn: { padding: '16px', fontSize: '18px', borderRadius: '8px', border: 'none', background: 'var(--theme--primary)', color: '#fff', width: '100%', marginTop: '12px' },
  ghost: { padding: '14px', fontSize: '16px', borderRadius: '8px', border, background: 'transparent', color: 'inherit', width: '100%', marginTop: '12px' },
  tab: (on) => ({ flex: 1, padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid var(--theme--primary)', background: on ? 'var(--theme--primary)' : 'transparent', color: on ? '#fff' : 'inherit' }),
  input: { width: '100%', padding: '12px', fontSize: '16px', margin: '12px 0', boxSizing: 'border-box' },
  row: { display: 'block', width: '100%', textAlign: 'left', padding: '14px', fontSize: '16px', border, borderRadius: '8px', marginBottom: '8px', background: 'transparent', color: 'inherit' },
  crumbs: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '16px 0 8px', alignItems: 'center' },
  crumb: { padding: '6px 10px', borderRadius: '16px', border, background: 'transparent', color: 'inherit', fontSize: '14px' },
  h3: { margin: '16px 0 8px', fontSize: '14px', textTransform: 'uppercase', opacity: 0.7 },
};

const felter = (t) => ['id', t.nr, 'titel', `${t.alias}.directus_files_id`];
const filer = (it, t) => (it[t.alias] || []).map((j) => j.directus_files_id).filter(Boolean);
const asset = (id, key) => `/assets/${id}?key=${key}`;
const thumb = (id, size) => h('img', { src: asset(id, 'liste'), style: `width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;flex:none;background:#8884`, loading: 'lazy' });
const fejl = (e) => e.response?.data?.errors?.[0]?.message || e.message;

const Foto = defineComponent({
  setup() {
    const api = useApi();
    const type = ref('genstande');
    const sti = ref([]);          // valgte placeringer: rum -> montre -> hylde
    const born = ref([]);         // underplaceringer under den nuværende
    const items = ref([]);        // poster på den nuværende placering (eller søgeresultat)
    const search = ref('');
    const valgt = ref(null);
    const msg = ref('');
    const busy = ref(false);
    const fil = ref(null);
    let seq = 0;

    async function load() {
      const my = ++seq;
      const t = TYPER[type.value];
      const nu = sti.value[sti.value.length - 1];
      try {
        let b = [], i = [];
        if (search.value) {
          i = (await api.get(`/items/${type.value}`, { params: { fields: felter(t), search: search.value, sort: [t.nr], limit: 50 } })).data.data;
        } else {
          b = (await api.get('/items/placeringer', { params: { fields: ['id', 'navn', 'type'], sort: ['navn'], limit: -1, filter: { overordnet: nu ? { _eq: nu.id } : { _null: true } } } })).data.data;
          if (nu) i = (await api.get(`/items/${type.value}`, { params: { fields: felter(t), sort: [t.nr], limit: 200, filter: { placering: { _eq: nu.id } } } })).data.data;
        }
        if (my !== seq) return;
        born.value = b; items.value = i;
      } catch (e) { msg.value = 'Kunne ikke hente: ' + fejl(e); }
    }

    function gaaTil(n) { sti.value = sti.value.slice(0, n); search.value = ''; valgt.value = null; msg.value = ''; load(); }
    function ind(p) { sti.value = [...sti.value, p]; search.value = ''; msg.value = ''; load(); }

    async function upload(ev) {
      const file = ev.target.files?.[0];
      ev.target.value = '';
      if (!file || !valgt.value) return;
      const t = TYPER[type.value];
      busy.value = true; msg.value = 'Overfører…';
      try {
        const form = new FormData();
        form.append('title', `${valgt.value[t.nr] || valgt.value.id}`);
        form.append('file', file);
        const up = await api.post('/files', form);
        await api.post(`/items/${t.junction}`, { [t.fk]: valgt.value.id, directus_files_id: up.data.data.id });
        valgt.value = (await api.get(`/items/${type.value}/${valgt.value.id}`, { params: { fields: felter(t) } })).data.data;
        msg.value = `✓ Billedet er gemt på ${valgt.value[t.nr] || ''} ${valgt.value.titel || ''}`;
      } catch (e) { msg.value = 'Fejl: ' + fejl(e); }
      finally { busy.value = false; }
    }

    onMounted(load);

    return () => {
      const t = TYPER[type.value];
      const k = [];
      k.push(h('div', { style: 'display:flex;gap:8px' }, Object.entries(TYPER).map(([key, v]) =>
        h('button', { style: st.tab(type.value === key), onClick: () => { type.value = key; valgt.value = null; msg.value = ''; load(); } }, v.label))));

      if (valgt.value) {
        k.push(h('p', { style: 'margin-top:16px' }, [h('strong', `${valgt.value[t.nr] || ''} ${valgt.value.titel || ''}`)]));
        const ids = filer(valgt.value, t);
        k.push(h('div', { style: st.h3 }, ids.length ? `Eksisterende billeder (${ids.length})` : 'Ingen billeder endnu'));
        if (ids.length) k.push(h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, ids.map((id) =>
          h('a', { href: asset(id, 'visning'), target: '_blank' }, [thumb(id, 96)]))));
        k.push(h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', ref: fil, onChange: upload }));
        k.push(h('button', { style: st.btn, disabled: busy.value, onClick: () => fil.value.click() }, '📷 Tag billede'));
        k.push(h('button', { style: st.ghost, onClick: () => { valgt.value = null; msg.value = ''; } }, 'Tilbage til listen'));
      } else {
        k.push(h('input', { style: st.input, placeholder: 'Søg efter nummer eller titel…', value: search.value, onInput: (e) => { search.value = e.target.value; load(); } }));
        if (!search.value) {
          const c = [h('button', { style: st.crumb, onClick: () => gaaTil(0) }, 'Alle placeringer')];
          sti.value.forEach((p, n) => { c.push('›'); c.push(h('button', { style: st.crumb, onClick: () => gaaTil(n + 1) }, p.navn)); });
          k.push(h('div', { style: st.crumbs }, c));
          if (born.value.length) {
            k.push(h('div', { style: st.h3 }, sti.value.length ? 'Underplaceringer' : 'Vælg placering'));
            born.value.forEach((p) => k.push(h('button', { style: st.row, onClick: () => ind(p) }, `${p.navn}${p.type ? ' (' + p.type + ')' : ''}`)));
          }
          if (sti.value.length) {
            k.push(h('div', { style: st.h3 }, `${t.label} her (${items.value.length})`));
            if (!items.value.length) k.push(h('p', { style: 'opacity:.7' }, 'Ingen poster direkte på denne placering.'));
          }
        } else {
          k.push(h('div', { style: st.h3 }, `Søgeresultat (${items.value.length})`));
        }
        items.value.forEach((it) => k.push(h('button', { style: st.row, onClick: () => { valgt.value = it; msg.value = ''; } }, [
          h('span', { style: 'display:flex;align-items:center;gap:12px' }, [
            filer(it, t).length ? thumb(filer(it, t)[0], 48) : h('span', { style: 'width:48px;height:48px;flex:none;border-radius:6px;border:1px dashed var(--theme--border-color)' }),
            h('span', { style: 'flex:1' }, `${it[t.nr] || ''} – ${it.titel || ''}`),
            h('span', { style: 'opacity:.7;white-space:nowrap' }, filer(it, t).length ? `📷 ${filer(it, t).length}` : 'ingen billeder'),
          ])])));
      }
      if (msg.value) k.push(h('p', { style: 'margin-top:16px;font-weight:bold' }, msg.value));

      // private-view giver Directus' menu, topbjælke og navigation
      return h(resolveComponent('private-view'), { title: 'Tag billede' }, { default: () => h('div', { style: st.page }, k) });
    };
  },
});

export default {
  id: 'foto',
  name: 'Tag billede',
  icon: 'photo_camera',
  routes: [{ path: '', component: Foto }],
  // Skjules for dem, der ikke må oprette (fx Medlem), så de ikke møder en fejl ved gem.
  preRegisterCheck(user, rettigheder) {
    if (user.admin_access) return true;
    const a = rettigheder.directus_files?.create?.access;
    return a === 'partial' || a === 'full';
  },
};
