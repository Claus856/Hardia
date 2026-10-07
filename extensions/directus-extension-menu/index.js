// Skjuler menupunkter pr. rolle. Administratoren vælger dem under Indstillinger -> Brugerroller -> (rolle)
// -> "Skjul i menuen" (feltet skjul_i_menu på directus_roles). Administratorer ser altid det hele.
// Menuen (module_bar) er fælles for alle roller i Directus, så det gøres med en stilregel.
// Kun menupunkterne skjules; hvad brugeren må se, styres stadig af rettighederne.
// Modulet har ingen side og registreres aldrig: Directus kalder preRegisterCheck for hver bruger ved login.
const ID = 'logearkiv-menu';
const link = (punkt) => (punkt === 'docs' ? 'https://docs.directus.io' : `/admin/${punkt}`);

export default {
  id: 'logearkiv-menu',
  name: 'Menu',
  icon: 'menu',
  routes: [],
  async preRegisterCheck(user) {
    document.getElementById(ID)?.remove();
    if (user.admin_access) return false;
    try {
      const svar = await fetch('/users/me?fields=role.skjul_i_menu', { credentials: 'include' });
      const skjul = (await svar.json()).data?.role?.skjul_i_menu;
      if (Array.isArray(skjul) && skjul.length) {
        const stil = document.createElement('style');
        stil.id = ID;
        stil.textContent = `${skjul.map((p) => `.module-bar .modules .v-button:has(> a[href="${link(p)}"])`).join(',')}{display:none}`;
        document.head.append(stil);
      }
    } catch { /* kan indstillingen ikke hentes, vises hele menuen */ }
    return false;
  },
};
