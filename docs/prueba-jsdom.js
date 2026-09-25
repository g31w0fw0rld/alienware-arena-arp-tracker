// Banco de pruebas del panel, contra los volcados saneados de este mismo docs/.
//
// Uso:  npm install jsdom      (en cualquier carpeta; ajusta la ruta del require)
//       node docs/prueba-jsdom.js
//
// Por que existe: cada estado que hay que comprobar —Twitch a 0 / a medias /
// completo, una quest incompleta, un sorteo sin claves para Mexico— el sitio
// solo lo sirve cuando le toca. Los volcados los congelan, asi que se pueden
// probar los doce casos en un segundo y sin tocar la cuenta.
//
// Dos cosas que costaron un rato y conviene no volver a descubrir:
//   - jsdom dispara DOMContentLoaded en el TICK SIGUIENTE al constructor, asi
//     que hay que esperar un turno antes de mirar el DOM o parece que el script
//     no ha corrido.
//   - Los volcados llevan el JS entero del sitio, que en jsdom revienta. Se
//     evaluan SOLO las declaraciones de las globales, una a una y por nombre.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');

const DOCS = __dirname;
// Igual que en §46 y §47: la fuente se puede apuntar a otra copia con AWA_FUENTE, que
// es como se corren los controles negativos —las mismas pruebas contra el codigo de
// antes del cambio—. Una prueba que pasa igual con el codigo viejo no mide lo que dice.
const SCRIPT = fs.readFileSync(process.env.AWA_FUENTE
  || __dirname + '/../alienware-arena-arp-tracker.user.js', 'utf8');

let ok = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// Los volcados llevan el JS entero del sitio (jQuery, Weglot, anuncios), que en
// jsdom revienta y no aporta nada. Se ejecuta SOLO el bloque de globales, que es
// lo único que el script lee, y se identifica por su primera variable.
function globalsOf(html) {
  // Se extraen las declaraciones UNA A UNA por nombre. Cortar el bloque por
  // longitud fallaba de dos maneras: quedarse corto (sin arp_balance) o
  // arrastrar código con jQuery detrás.
  const nombres = ['user_is_logged_in', 'arp_balance', 'arp_lifetime', 'arp_tier',
    'user_country', 'consecutive_logins', 'steamId', 'countryKeys', 'artifactLangDiscount'];
  const out = [];
  for (const n of nombres) {
    const re = new RegExp('var\\s+' + n + '\\s*=\\s*([\\s\\S]*?);\\s*\\n');
    const m = html.match(re);
    if (m) out.push('var ' + n + ' = ' + m[1] + ';');
  }
  return out.join('\n');
}

// jsdom dispara DOMContentLoaded en el tick siguiente al constructor, asi que
// el script se engancha ahi y no ha corrido cuando vuelve mount(). Hay que
// esperar un turno antes de mirar el DOM.
const tick = () => new Promise((r) => setTimeout(r, 60));

// Reloj falso: coloca a la ventana a N minutos del reinicio de las 00:00 UTC.
// Hace falta porque el aviso depende de la hora real, y sin poder moverla el
// control positivo del aviso no se puede escribir.
function relojFalso(win, minutosAntes) {
  const objetivo = new Date();
  objetivo.setUTCHours(24, 0, 0, 0);
  const fijo = objetivo.getTime() - minutosAntes * 60000;
  const Real = win.Date;
  function Falso(...a) { return a.length ? new Real(...a) : new Real(fijo); }
  Falso.prototype = Real.prototype;
  Falso.now = () => fijo;
  Falso.parse = Real.parse;
  Falso.UTC = Real.UTC;
  win.Date = Falso;
}

// Reloj falso MOVIBLE: igual que el absoluto, pero se puede adelantar sin
// recargar la ventana. Hace falta para lo único que de verdad importa del aviso:
// que salte cuando llega la hora con la pestaña ya abierta.
function relojMovible(win, minutosAntes) {
  const objetivo = new Date();
  objetivo.setUTCHours(24, 0, 0, 0);
  let fijo = objetivo.getTime() - minutosAntes * 60000;
  const Real = win.Date;
  function Falso(...a) { return a.length ? new Real(...a) : new Real(fijo); }
  Falso.prototype = Real.prototype;
  Falso.now = () => fijo;
  Falso.parse = Real.parse;
  Falso.UTC = Real.UTC;
  win.Date = Falso;
  return (m) => { fijo = objetivo.getTime() - m * 60000; };
}

// Captura los setInterval del script para poder dispararlos a mano: esperar 30 s
// reales por prueba no es una opción.
function capturarTics(win) {
  win.__ticks = [];
  win.setInterval = (fn) => { win.__ticks.push(fn); return 0; };
}
const tic = (w) => w.__ticks.forEach((fn) => fn());

// jsdom no tiene forma de ocultar una pestaña, así que se finge el único dato
// que el script mira, y se dispara el evento como haría el navegador.
function ocultar(w, oculta) {
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => oculta });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
}

// (los dobles de audio vivían aquí; ya no hay audio)
// del respaldo sintetizado: son dos caminos distintos y hay que distinguirlos.
// El aviso ya no suena: es un `alert()`. El doble lo captura en vez de dejar que
// jsdom se queje de «not implemented», y de paso guarda el texto, que es lo que
// hay que comprobar.
function dobleAviso(win, avisos) {
  win.alert = (texto) => avisos.push(texto);
}

// Reloj falso absoluto: sitúa a la ventana en un instante UTC dado. Lo pide el
// registro de ARP, cuyas filas están fechadas: para comprobar que solo se suma
// LO DE HOY hay que poder plantarse en un día concreto de los volcados.
function relojEnDia(win, iso) {
  const fijo = Date.parse(iso);
  const Real = win.Date;
  function Falso(...a) { return a.length ? new Real(...a) : new Real(fijo); }
  Falso.prototype = Real.prototype;
  Falso.now = () => fijo;
  Falso.parse = Real.parse;
  Falso.UTC = Real.UTC;
  win.Date = Falso;
}


function leer(nombre) { return fs.readFileSync(path.join(DOCS, nombre), 'utf8'); }

// Devuelve el volcado con los contadores del día VACÍOS, que es como llegó la
// respuesta del servidor el 2026-08-25 al pulsar ⟳ en el sitio real. Se hace con
// el DOM y no partiendo el HTML a mano: contar o recortar marcado con regex ya
// ha dado tres cifras mal en este proyecto.
function sinContadores(html) {
  const d = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  ['control-center__tos-arp', 'control-center__tos-max-arp', 'control-center__twitch-arp']
    .forEach((id) => {
      const n = d.window.document.getElementById(id);
      if (n) n.textContent = '';
    });
  return d.serialize();
}

// Devuelve el volcado SIN la clase `current` de las rejillas de recompensa, que
// es como llega la respuesta del servidor: esa clase la añade el JS del sitio al
// cargar, y `DOMParser` no ejecuta scripts. Los volcados se guardaron del DOM ya
// renderizado, así que la traen; usarlos tal cual como respuesta de fetch prueba
// algo que en el navegador no pasa nunca.
function sinCurrent(html) {
  const d = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  d.window.document.querySelectorAll('.calendar-rewards__day.current')
    .forEach((n) => n.classList.remove('current'));
  return d.serialize();
}

function mount(file, urlPath, tweak) {
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const vc = new VirtualConsole();           // silencio: los errores del sitio no son nuestros
  const dom = new JSDOM(html, {
    url: 'https://www.alienwarearena.com' + (urlPath || '/'),
    runScripts: 'outside-only',
    virtualConsole: vc,
    pretendToBeVisual: true,
  });
  const w = dom.window;
  // Los `console.warn` del script son diagnóstico DELIBERADO —distinguen «no
  // sonó» de «no le tocaba», y «no hay filas» de «no llegó la respuesta»—, así
  // que son parte de lo que hay que comprobar y no ruido que silenciar.
  w.__warns = [];
  w.console = Object.assign(Object.create(w.console || {}), w.console, {
    warn: (...a) => w.__warns.push(a),
    log: () => {},
    error: () => {},
  });
  w.eval(globalsOf(html));
  if (tweak) tweak(w);
  // fetch no debe hacer falta cuando el dato está en la página; si el script lo
  // llama, la prueba lo verá porque este doble lo apunta.
  w.fetched = [];
  // Doble de fetch: apunta lo pedido y, si la prueba lo indica, contesta con un
  // volcado. Sin `respuestas` sigue rechazando, que es como se comprobaba antes
  // que el panel aguanta sin red.
  w.fetch = (u) => {
    w.fetched.push(u);
    // La clave que aparece MÁS TARDE en la ruta, que es la más específica:
    // `/control-center/battle-pass/1` contiene «control-center», así que con
    // `find` el doble contestaba el Centro de control cuando le pedían el pase, y
    // el pase parecía ilegible. Un fallo del banco de pruebas que se leía
    // exactamente igual que un fallo del script. Por la longitud tampoco vale:
    // «control-center» tiene más letras que «battle-pass».
    const clave = Object.keys(w.__respuestas || {})
      .filter((k) => String(u).indexOf(k) >= 0)
      .sort((a, b) => String(u).indexOf(b) - String(u).indexOf(a))[0];
    if (!clave) return Promise.reject(new Error('sin red en pruebas'));
    // `url` es la URL FINAL, con los redirects ya resueltos: es lo que mira el
    // script para no fiarse de una respuesta de otro origen. `__origen` deja que
    // una prueba finja el salto de na. a www.
    return Promise.resolve({
      ok: true,
      url: (w.__origen || 'https://www.alienwarearena.com') + String(u),
      text: () => Promise.resolve(w.__respuestas[clave]),
    });
  };
  w.eval(SCRIPT);
  return w;
}

const txt = (w, sel) => { const n = w.document.querySelector(sel); return n ? n.textContent.trim() : null; };
const lines = (w) => Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__line'))
  .map(l => [l.querySelector('.awa-w__k').textContent, l.querySelector('.awa-w__v').textContent, l.className]);

async function main() {
console.log('\n=== 1. Centro de control con Twitch completado (24 ago) ===');
{
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center'); await tick();
  const L = lines(w);
  check('el panel se inyecta', !!w.document.getElementById('awa-arp-widget'));
  check('saldo de la global (246 ARP)', txt(w, '.awa-w__arp') === '246 ARP', txt(w, '.awa-w__arp'));
  check('nivel y racha', /Nivel 1|Tier 1/.test(txt(w, '.awa-w__sub') || ''), txt(w, '.awa-w__sub'));
  const tw = L.find(l => /Twitch/.test(l[0]));
  check('Twitch completo: 15/15 con marca', tw && tw[1] === '15/15 ✅' && /--done/.test(tw[2]), tw && tw.join(' | '));
  const tos = L.find(l => /Tiempo|Time/.test(l[0]));
  check('tiempo en el sitio completo: 5/5 con marca', tos && tos[1] === '5/5 ✅', tos && tos.join(' | '));
  check('sin aviso de widget cuando ya está completo', !w.document.querySelector('.awa-w__note'));
  // Lo del día se lee del propio documento; el pase y el índice de eventos viven
  // en otra página, así que esas sí se piden —una vez al día cada una, no por
  // carga: ver la prueba de la caché—.
  check('estando en el Centro de control se piden el pase, el registro y los eventos',
    w.fetched.length === 3 && w.fetched.some((u) => /battle-pass/.test(u))
      && w.fetched.some((u) => /arp-log/.test(u))
      && w.fetched.some((u) => /\/steam\/events$/.test(u)), JSON.stringify(w.fetched));
}

console.log('\n=== 2. Twitch a medias (2 de 15) ===');
{
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center'); await tick();
  const tw = lines(w).find(l => /Twitch/.test(l[0]));
  check('en progreso muestra 2/15 y sin marca', tw && tw[1] === '2/15', tw && tw.join(' | '));
  check('marcado como pendiente', tw && /--todo/.test(tw[2]), tw && tw[2]);
  check('sin aviso del widget: 2 > 0, así que sí está contando', !w.document.querySelector('.awa-w__note'));
}

console.log('\n=== 3. Twitch a cero: el aviso del widget ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const note = txt(w, '.awa-w__note');
  check('aparece el aviso', !!note, String(note));
  check('el aviso habla del widget y de Hive/Nexus', note && /widget/i.test(note) && /Hive/.test(note), String(note));
}

console.log('\n=== 4. Quest diaria incompleta (6200, 24 ago) ===');
{
  const w = mount('dom-control-center-2026-08-24.html', '/control-center'); await tick();
  const L = lines(w);
  const qd = L.find(l => /diarias|Daily/.test(l[0]));
  const qs = L.find(l => /Steam/.test(l[0]));
  check('quests diarias: 0 de 1 hechas', qd && qd[1] === '0/1', qd && qd.join(' | '));
  check('quests de Steam contadas aparte', !!qs, L.map(x => x[0]).join(' / '));
  check('Steam: 2 de 3 hechas (falta darkest-dungeon)', qs && qs[1] === '2/3', qs && qs.join(' | '));
}

console.log('\n=== 5. Todas las quests completas (22 ago) ===');
{
  const w = mount('dom-control-center-daily-completed-2026-08.html', '/control-center'); await tick();
  const L = lines(w);
  const qd = L.find(l => /diarias|Daily/.test(l[0]));
  const qs = L.find(l => /Steam/.test(l[0]));
  check('diarias completas: 3/3 con marca', qd && qd[1] === '3/3 ✅', qd && qd.join(' | '));
  check('Steam sigue en 2/3 (falta cult-of-the-lamb)', qs && qs[1] === '2/3', qs && qs.join(' | '));
}

console.log('\n=== 6. Calendario de campaña: los DOS ejemplares de la página ===');
{
  // Este volcado se guardó con el overlay ABIERTO y el día 1 recién cobrado, así
  // que trae el calendario dos veces y en estados distintos:
  //   · copia del overlay, día 1: botón borrado y `claimed` visible  -> cobrado
  //   · original,          día 1: los dos con display:none
  // Los días 2-5 solo llevan `day-date` («Día 2»), o sea bloqueados.
  //
  // Hasta el 2026-08-28 esta comprobación afirmaba «detecta el día reclamable», y
  // era el FALLO escrito como especificación: el código miraba solo si EXISTÍA un
  // `button.day-claim`, encontraba el del original —oculto— y cantaba «por
  // reclamar» el mismo día en que lo habías cobrado. Que es exactamente el
  // síntoma reportado, con la prueba en un volcado de una semana antes.
  const w = mount('dom-intel-gamer-days-2026-08-day-1.html', '/control-center'); await tick();
  const c = lines(w).find(l => /Calendario|Calendar/.test(l[0]));
  check('cruza los dos ejemplares: 1 de 5 cobrado', c && c[1] === '1/5 ✅', c && c.join(' | '));
  check('y NO lo da por reclamable con los días 2-5 bloqueados',
    c && /--done/.test(c[2]), c && c.join(' | '));
}

console.log('\n=== 7. Sorteo CON claves para México ===');
{
  const w = mount('dom-giveaway-post-claimable-2026-08.html', '/ucf/show/2175732/boards/x/Giveaway/y'); await tick();
  const k = w.document.querySelector('.awa-keys');
  check('inyecta la línea de claves', !!k);
  check('dice que hay claves', k && /--ok/.test(k.className), k && k.className);
  check('con el número real (890)', k && /890/.test(k.textContent), k && k.textContent);
}

console.log('\n=== 8. Sorteo agotado para México (US-only) ===');
{
  const w = mount('dom-giveaway-post-2026-08.html', '/ucf/show/2176051/boards/x/Giveaway/y'); await tick();
  const k = w.document.querySelector('.awa-keys');
  check('avisa de que no hay claves', k && /--none/.test(k.className), k && (k.className + ' | ' + k.textContent));
  check('nombra el país del usuario', k && /MX/.test(k.textContent), k && k.textContent);
}

console.log('\n=== 9. Bóveda: precio, nivel y stock contra el saldo ===');
{
  const w = mount('dom-game-vault-2026-08.html', '/marketplace/game-vault'); await tick();
  const tags = Array.from(w.document.querySelectorAll('.awa-tag')).map(x => x.className + '::' + x.textContent);
  // Son 18, contados sobre los elementos del DOM. Un recuento anterior dijo 17
  // porque venía de trocear el HTML con una expresión, que es justo el atajo que
  // ya falló con las tarjetas de la tienda.
  check('etiqueta las 18 tarjetas', tags.length === 18, 'salieron ' + tags.length);
  check('marca lo agotado', tags.some(x => /--out/.test(x)), tags.slice(0, 3).join(' , '));
  check('marca lo que pide más nivel', tags.some(x => /--tier/.test(x)), '');
  check('calcula lo que falta en ARP', tags.some(x => /--short/.test(x) && /\d/.test(x)), tags.find(x => /--short/.test(x)) || '');
}

console.log('\n=== 10. Marketplace ===');
{
  const w = mount('dom-marketplace-2026-08.html', '/marketplace/'); await tick();
  const tags = Array.from(w.document.querySelectorAll('.awa-tag'));
  check('etiqueta las tarjetas', tags.length > 30, 'salieron ' + tags.length);
  check('las agotadas salen como agotadas', tags.some(x => /--out/.test(x.className)));
}

console.log('\n=== 11. Sin sesión no se pinta nada ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => { win.user_is_logged_in = false; });
  check('no hay panel', !w.document.getElementById('awa-arp-widget'));
  check('no hay estilos', !w.document.getElementById('awa-arp-css'));
}

console.log('\n=== 12. Fuera, se piden dos cosas y una sola vez cada una ===');
{
  const w = mount('dom-homepage-src-2026-08.html', '/'); await tick();
  check('el panel se inyecta igual', !!w.document.getElementById('awa-arp-widget'));
  // Cuatro peticiones como mucho, una de cada, y las cuatro con su propia caché:
  // el dia (5 min), el pase (un dia), el registro (5 min hasta cobrar Discord) y
  // el indice de eventos (un dia). Sin evento vivo el indice se queda en UNA: la
  // pagina del evento solo se pide si el indice dice que hay alguno.
  check('el Centro de control, el pase, el registro y los eventos: uno de cada',
    w.fetched.length === 4 && w.fetched.filter((u) => /control-center$/.test(u)).length === 1
      && w.fetched.filter((u) => /battle-pass/.test(u)).length === 1
      && w.fetched.filter((u) => /arp-log/.test(u)).length === 1
      && w.fetched.filter((u) => /\/steam\/events$/.test(u)).length === 1, JSON.stringify(w.fetched));
}
{
  // Con la caché del día puesta, el pase no se vuelve a pedir. Es lo que hace que
  // la petición extra sea una al día y no una por página.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.localStorage.setItem('awa-arp-pass', JSON.stringify({
      tokens: 45, tokensMax: 135, claimable: 0, started: true, endsAt: Date.now() + 864e5, at: Date.now(),
    }));
  }); await tick();
  check('con caché del día no se pide el pase', !w.fetched.some((u) => /battle-pass/.test(u)),
    JSON.stringify(w.fetched));
  const p = lines(w).find((l) => /[Pp]ase|Pass/.test(l[0]));
  check('y la línea sale igual, desde la caché', !!p && /45/.test(p[1]), p && p.join(' | '));
}


console.log('\n=== 13. Los dos relojes, separados ===');
{
  const w = mount('dom-control-center-2026-08-24.html', '/control-center'); await tick();
  const relojes = Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__clock')).map(x => x.textContent);
  check('hay reloj diario y semanal', relojes.length === 2, JSON.stringify(relojes));
  check('el diario habla del día', /día|day|Day/.test(relojes[0] || ''), relojes[0]);
  check('el semanal habla de Steam', /Steam/.test(relojes[1] || ''), relojes[1]);
}

console.log('\n=== 14. Motor de tooltips: delegación, guarda el title y lo devuelve ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const conAviso = w.document.querySelectorAll('#awa-arp-widget [title]');
  check('todo lo del panel que debe explicarse lleva title', conAviso.length >= 9,
    'con aviso: ' + conAviso.length);

  const linea = w.document.querySelector('#awa-arp-widget .awa-w__line');
  const textoOriginal = linea.getAttribute('title');
  linea.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  const tip0 = w.document.getElementById('awa-arp-tip');
  check('con el ratón NO sale al instante (250 ms de espera)', !tip0 || !/awa-tip--on/.test(tip0.className));

  // Por teclado sale sin retardo, porque llegar tabulando ya es intención.
  linea.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
  const tip = w.document.getElementById('awa-arp-tip');
  check('por teclado sale al instante', tip && /awa-tip--on/.test(tip.className), tip && tip.className);
  check('con el texto del title', tip && tip.textContent === textoOriginal, tip && tip.textContent.slice(0, 40));
  check('cuelga del body, no del panel', tip && tip.parentNode === w.document.body);
  check('y mientras está arriba el title se guarda aparte',
    !linea.hasAttribute('title') && linea.getAttribute('data-awa-tip') === textoOriginal,
    'title=' + linea.getAttribute('title') + ' stash=' + linea.getAttribute('data-awa-tip'));

  linea.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
  check('al cerrarse devuelve el title', linea.getAttribute('title') === textoOriginal,
    String(linea.getAttribute('title')));
  check('y se apaga la caja', !/awa-tip--on/.test(w.document.getElementById('awa-arp-tip').className));
}

console.log('\n=== 14.1 El motor no toca los tooltips de Alienware Arena ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  // Un title del propio sitio, fuera del panel: debe quedarse intacto.
  const ajeno = Array.from(w.document.querySelectorAll('[title]'))
    .find((n) => !n.closest('#awa-arp-widget') && !n.closest('.awa-keys'));
  check('hay algún title del sitio para comprobarlo', !!ajeno);
  if (ajeno) {
    const antes = ajeno.getAttribute('title');
    ajeno.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
    check('no se lo roba', ajeno.getAttribute('title') === antes, String(ajeno.getAttribute('title')));
    const tip = w.document.getElementById('awa-arp-tip');
    check('ni enciende la caja propia', !tip || !/awa-tip--on/.test(tip.className));
  }
}

console.log('\n=== 15. Ficha del script, con la forma de los demás scripts ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const boton = w.document.querySelector('#awa-arp-widget .awa-w__btn--info');
  check('el ℹ️ va en la cabecera del panel', !!boton && !!boton.closest('.awa-w__head'));
  check('ya no hay botón ancho al pie', !w.document.querySelector('#awa-arp-widget .awa-w__more'));
  boton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const modal = w.document.getElementById('awa-arp-modal');
  check('se abre la ficha', !!modal);
  const claves = Array.from(modal.querySelectorAll('.awa-modal__k')).map((n) => n.textContent);
  check('trae la ficha de cinco filas', claves.length === 5, claves.join(' '));
  check('con nombre, versión, autor, GitHub y Ko-fi',
    /Nombre|Name/.test(claves[0]) && /Ko-fi/.test(claves[4]), claves.join(' | '));
  check('el enlace de GitHub apunta al repo',
    /github\.com\/g31w0fw0rld\/alienware-arena-arp-tracker/.test(modal.querySelector('.awa-modal__v a').href),
    modal.querySelector('.awa-modal__v a').href);
  // La versión NO va escrita aquí: se saca del propio `@version` del fichero. Con
  // el número a mano, esta comprobación fallaba en cada bump y el arreglo era
  // editarla —o sea que no comprobaba nada, solo repetía lo que ya decía el
  // script—. Así verifica lo que importa: que la ficha enseñe LA versión que el
  // script declara, y de paso que `@version` y `SCRIPT_VERSION` no se separen.
  const versionDeclarada = (SCRIPT.match(/@version\s+(\S+)/) || [])[1];
  const versionInterna = (SCRIPT.match(/SCRIPT_VERSION\s*=\s*'([^']+)'/) || [])[1];
  check('@version y SCRIPT_VERSION coinciden',
    !!versionDeclarada && versionDeclarada === versionInterna,
    versionDeclarada + ' vs ' + versionInterna);
  check('dice la versión', modal.textContent.indexOf(versionDeclarada) >= 0, versionDeclarada);
  check('tres bloques de prosa', modal.querySelectorAll('.awa-modal__h').length === 3,
    String(modal.querySelectorAll('.awa-modal__h').length));
  check('y el botón de aceptar centrado al pie', !!modal.querySelector('.awa-modal__foot .awa-modal__btn'));
  check('sin botón de probar el sonido', modal.querySelectorAll('.awa-modal__foot .awa-modal__btn').length === 1,
    'botones al pie: ' + modal.querySelectorAll('.awa-modal__foot .awa-modal__btn').length);
  const ok = Array.from(modal.querySelectorAll('.awa-modal__btn')).pop();
  ok.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(); await tick(); await tick();
  check('se cierra al aceptar', !w.document.getElementById('awa-arp-modal'));
}

console.log('\n=== 16. Idioma: el del sitio cuando no hay preferencia ===');
{
  // El volcado sirve la página en español y el switcher de Weglot marca es.
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  check('sigue al sitio (es)', /ARP de hoy/.test(txt(w, '#awa-arp-widget .awa-w__title') || ''),
    txt(w, '#awa-arp-widget .awa-w__title'));
  check('ofrece los ocho idiomas más el automático',
    w.document.querySelectorAll('#awa-arp-widget .awa-w__lang option').length === 9,
    'opciones: ' + w.document.querySelectorAll('#awa-arp-widget .awa-w__lang option').length);
}

console.log('\n=== 17. Idioma: la preferencia manda sobre el sitio ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-lang', 'de');
  }); await tick();
  check('el panel va en alemán', /ARP heute/.test(txt(w, '#awa-arp-widget .awa-w__title') || ''),
    txt(w, '#awa-arp-widget .awa-w__title'));
}

console.log('\n=== 18. Ningún idioma con claves ausentes ni inglés copiado ===');
{
  const fuente = fs.readFileSync(__dirname + '/../alienware-arena-arp-tracker.user.js', 'utf8');
  const bloque = fuente.slice(fuente.indexOf('const I18N = {'), fuente.indexOf('function t(key, vars)'));
  const idiomas = ['en', 'es', 'de', 'fr', 'pt', 'br', 'zh', 'hi'];
  const claves = {};
  for (const l of idiomas) {
    const i = bloque.indexOf('\n        ' + l + ': {');
    const j = bloque.indexOf('\n        },', i);
    claves[l] = (bloque.slice(i, j).match(/^\s{12}(\w+):/gm) || []).map(x => x.trim().replace(':', ''));
  }
  const base = claves.en;
  check('los ocho idiomas están', idiomas.every(l => claves[l].length > 0), JSON.stringify(idiomas.map(l => l + ':' + claves[l].length)));
  const faltan = idiomas.filter(l => base.some(k => claves[l].indexOf(k) < 0));
  check('ninguno tiene claves ausentes', faltan.length === 0, 'incompletos: ' + faltan.join(','));
}

console.log('\n=== 19. La posición por defecto no choca con el selector de AWA ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const box = w.document.getElementById('awa-arp-widget');
  check('arranca arriba a la derecha', /awa-w--tr/.test(box.className), box.className);
  const mover = box.querySelector('.awa-w__btn');
  mover.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('el botón rota de esquina', /awa-w--br/.test(box.className), box.className);
  check('y la recuerda', w.localStorage.getItem('awa-arp-pos') === 'br', String(w.localStorage.getItem('awa-arp-pos')));
}

console.log('\n=== 20. El aviso sonoro: control negativo y positivo ===');
{
  // (a) Todo hecho: no debe avisar aunque falten minutos para el reinicio.
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    relojFalso(win, 10);
  }); await tick();
  check('con todo hecho NO avisa', w.localStorage.getItem('awa-arp-visto-dia') === null,
    String(w.localStorage.getItem('awa-arp-visto-dia')));
}
{
  // (b) Mismo reloj, pero con cosas pendientes: aquí sí tiene que avisar. Sin
  // este control el caso (a) pasaría igual si el aviso estuviera roto del todo.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    relojFalso(win, 10);
    dobleAviso(win, avisos);
  }); await tick();
  // La marca `visto-dia` ya NO se escribe al avisar: significa «ya lo viste» y
  // solo la pone marcar la banda. Lo que delata que avisó es la constancia.
  check('con cosas pendientes SÍ avisa', w.localStorage.getItem('awa-arp-aviso') !== null,
    String(w.localStorage.getItem('awa-arp-aviso')));
  check('y abre un solo diálogo', avisos.length === 1, 'avisó ' + avisos.length);
}
{
  // (c) Lejos del reinicio no avisa, aunque quede todo por hacer.
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    relojFalso(win, 600);
  }); await tick();
  check('a 10 h del reinicio no avisa', w.localStorage.getItem('awa-arp-visto-dia') === null,
    String(w.localStorage.getItem('awa-arp-visto-dia')));
}

console.log('\n=== 20.1 La casilla olvida lo ya notificado ===');
{
  // Apagar y encender es lo que hace todo el mundo cuando algo no responde, así
  // que es lo que borra las marcas de «ya lo viste». Antes esta sección fijaba lo
  // contrario —«marcar la casilla NO suena»—, y valía mientras la casilla no
  // borrara nada: ahora sonar ES la respuesta a lo que acabas de pedir.
  const avisos = [];
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-26T12:00:00Z');
    // Todo dado por visto: sin esto no habría nada que olvidar y la prueba
    // pasaría por el motivo equivocado.
    win.localStorage.setItem('awa-arp-visto-amanecer', '2026-8-26');
    win.localStorage.setItem('awa-arp-visto-dia', '2026-8-26');
    win.localStorage.setItem('awa-arp-visto-semana', '2026-08-31');
    dobleAviso(win, avisos);
  }); await tick(); await tick();
  const casilla = w.document.querySelector('#awa-arp-widget .awa-w__check input');
  check('existe la casilla', !!casilla);
  check('con todo por visto, al cargar no suena', avisos.length === 0,
    'avisó ' + avisos.length);

  casilla.checked = true;
  casilla.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick();
  check('guarda la preferencia', w.localStorage.getItem('awa-arp-alert') === '1',
    String(w.localStorage.getItem('awa-arp-alert')));
  check('borra las tres marcas de «ya lo viste»',
    !w.localStorage.getItem('awa-arp-visto-amanecer')
      && !w.localStorage.getItem('awa-arp-visto-dia')
      && !w.localStorage.getItem('awa-arp-visto-semana'),
    [w.localStorage.getItem('awa-arp-visto-amanecer'),
      w.localStorage.getItem('awa-arp-visto-dia'),
      w.localStorage.getItem('awa-arp-visto-semana')].join(' · '));
  check('y por eso vuelve a avisar en el acto', avisos.length === 1,
    'avisó ' + avisos.length);
  check('con su banda en el panel',
    !!w.document.querySelector('#awa-arp-widget .awa-w__alert'));

  // Y apagarla retira la banda: un aviso en pantalla con los avisos apagados es
  // una contradicción a la vista.
  casilla.checked = false;
  casilla.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick();
  check('apagarla retira la banda',
    !w.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y apagarla no abre diálogo', avisos.length === 1, 'avisó ' + avisos.length);
}

console.log('\n=== 20.2 El aviso salta con el reloj, no solo al cargar ===');
{
  // El fallo de fondo, y el que no se ve: el aviso se decidía únicamente al
  // pintar el panel. Con la pestaña abierta desde antes, la hora llegaba y no
  // sonaba nada; solo sonaba si recargabas dentro de la media hora justa.
  const avisos = [];
  let mover;
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    mover = relojMovible(win, 600);            // diez horas antes: no toca avisar
    amanecerVisto(win);
    dobleAviso(win, avisos);
    capturarTics(win);
  }); await tick();
  check('al cargar lejos del reinicio no avisa',
    w.localStorage.getItem('awa-arp-visto-dia') === null,
    String(w.localStorage.getItem('awa-arp-visto-dia')));
  // Dos relojes: el del panel y el que vigila el idioma hasta que Weglot carga.
  check('pero deja relojes vigilando', w.__ticks.length === 2, 'intervalos: ' + w.__ticks.length);

  mover(20);                                   // llega la hora, sin recargar nada
  tic(w); await tick(); await tick();
  check('cuando llega la hora avisa sin recargar',
    w.localStorage.getItem('awa-arp-aviso') !== null,
    String(w.localStorage.getItem('awa-arp-aviso')));
  check('y avisa', avisos.length === 1, 'avisó ' + avisos.length);

  tic(w); await tick(); await tick();
  check('y en el siguiente tic no repite', avisos.length === 1, 'avisó ' + avisos.length);
}
{
  // Control negativo del mismo mecanismo: con la casilla sin marcar, que pase la
  // hora no dispara nada.
  const avisos = [];
  let mover;
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    mover = relojMovible(win, 600);
    dobleAviso(win, avisos);
    capturarTics(win);
  }); await tick();
  mover(20);
  tic(w); await tick(); await tick();
  check('sin la casilla marcada, la hora pasa sin diálogo', avisos.length === 0,
    'avisó ' + avisos.length);
}

console.log('\n=== 20.3 La marca en el título y la persistencia del aviso ===');
{
  // Aquí se probaba la caída del fichero al beep. Ya no hay ni fichero ni beep
  // —el sonido se retiró el 2026-08-27, ver §28—, así que lo que queda por
  // comprobar son los dos canales que SÍ llegan: la marca del título y la banda
  // que sobrevive a cambiar de página.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos);
    capturarTics(win);
  }); await tick(); await tick(); await tick();
  check('sale el diálogo', avisos.length === 1, 'avisó ' + avisos.length);
  check('y marca el título de la pestaña con el alienígena',
    w.document.title.indexOf('👽') === 0, w.document.title);

  // El título no es nuestro: si el sitio lo reescribe, la marca se repone sola.
  w.document.title = 'Otra cosa';
  tic(w);
  check('la marca vuelve si el sitio reescribe el título',
    w.document.title === '👽 Otra cosa', w.document.title);

  // Otra página, misma sesión: la constancia sigue ahí, y te lo vuelve a decir.
  // Esta comprobación decía lo contrario —«no vuelve a abrir diálogo»— y fijaba
  // el fallo que se arregló el 2026-08-27: el aviso solo se abría la primerísima
  // vez, así que si te pilló en otra pestaña ya no lo veías nunca.
  const avisos2 = [];
  const w2 = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-aviso', w.localStorage.getItem('awa-arp-aviso'));
    win.localStorage.setItem('awa-arp-visto-dia', w.localStorage.getItem('awa-arp-visto-dia'));
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos2);
  }); await tick(); await tick(); await tick();
  check('al cambiar de página el aviso sigue puesto',
    !!w2.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y la marca vuelve al título', w2.document.title.indexOf('👽') === 0, w2.document.title);
  check('y vuelve a abrir el diálogo', avisos2.length === 1, 'avisó ' + avisos2.length);
}
{
  // Cuando pasa su hora se retira solo: avisar de un día que ya acabó no sirve.
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    relojEnDia(win, '2026-08-26T12:00:00Z');
    amanecerVisto(win);
    win.localStorage.setItem('awa-arp-aviso', JSON.stringify({
      avisos: [{ tipo: 'day', etiquetas: ['Twitch'], hasta: Date.parse('2026-08-26T00:00:00Z'), cada: 300000 }],
      sonoEn: Date.parse('2026-08-25T23:40:00Z'),
    }));
  }); await tick(); await tick();
  check('un aviso caducado no se pinta',
    !w.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y se borra del almacén', w.localStorage.getItem('awa-arp-aviso') === null,
    String(w.localStorage.getItem('awa-arp-aviso')));
}

console.log('\n=== 22. Pase de batalla ===');
{
  // Estando en la propia página del pase, se lee del documento y no se pide nada.
  const w = mount('dom-battle-pass-2026-08.html', '/control-center/battle-pass/1'); await tick();
  const p = lines(w).find((l) => /[Pp]ase|Pass/.test(l[0]));
  check('sale la línea del pase', !!p, lines(w).map((x) => x[0]).join(' / '));
  check('con el hito reclamable', p && /1 por reclamar|1 to claim/.test(p[1]), p && p.join(' | '));
  check('marcado como pendiente', p && /--todo/.test(p[2]), p && p[2]);
  check('sin pedir la página del pase, que ya estamos en ella',
    !w.fetched.some((u) => /battle-pass/.test(u)), JSON.stringify(w.fetched));
}
{
  // Temporada cerrada: 45/135 fichas, ningún hito reclamable y la fecha pasada.
  const w = mount('dom-battle-pass-closed-2026-08.html', '/control-center/battle-pass/1'); await tick();
  const p = lines(w).find((l) => /[Pp]ase|Pass/.test(l[0]));
  check('dice que la temporada cerró', p && /cerrada|over/.test(p[1]), p && p.join(' | '));
}
{
  // Fuera del pase se pide una vez, y solo una: la del día y la del pase.
  const w = mount('dom-homepage-src-2026-08.html', '/'); await tick();
  check('pide el Centro de control, el pase, el registro y los eventos',
    w.fetched.length === 4 && w.fetched.some((u) => /control-center$/.test(u))
      && w.fetched.some((u) => /battle-pass/.test(u)) && w.fetched.some((u) => /arp-log/.test(u))
      && w.fetched.some((u) => /\/steam\/events$/.test(u)),
    JSON.stringify(w.fetched));
}

console.log('\n=== 23. Weglot no debe retraducir lo nuestro ===');
{
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const raices = ['#awa-arp-widget', '#awa-arp-tip'];
  raices.forEach((sel) => {
    const n = w.document.querySelector(sel);
    check(sel + ' marcado como no traducible',
      n && n.getAttribute('translate') === 'no' && n.getAttribute('data-wg-notranslate') === 'true'
        && /notranslate/.test(n.className),
      n ? n.getAttribute('translate') + '/' + n.getAttribute('data-wg-notranslate') + '/' + n.className : 'ausente');
  });
  w.document.querySelector('#awa-arp-widget .awa-w__btn--info').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const modal = w.document.getElementById('awa-arp-modal');
  check('la ficha también', modal && modal.getAttribute('data-wg-notranslate') === 'true');
}
{
  const w = mount('dom-giveaway-post-claimable-2026-08.html', '/ucf/show/1/boards/x/Giveaway/y'); await tick();
  const k = w.document.querySelector('.awa-keys');
  check('la línea del sorteo también', k && k.getAttribute('data-wg-notranslate') === 'true');
}
{
  const w = mount('dom-game-vault-2026-08.html', '/marketplace/game-vault'); await tick();
  const tag = w.document.querySelector('.awa-tag');
  check('y las etiquetas de las tarjetas', tag && tag.getAttribute('data-wg-notranslate') === 'true');
}

console.log('\n=== 24. Discord como tarea diaria, leída del registro ===');
{
  // El volcado del rango completo trae TRES días con Discord (21, 24 y 25 de
  // agosto), a 5 cada uno. Es justo lo que hace falta para separar dos cosas que
  // la primera versión confundía: encontrar el icono, y sumar solo el día de hoy.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-25T12:00:00Z');
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  const url = w.fetched.find((u) => /arp-log/.test(u)) || '';
  check('pide el registro desde hoy y hasta MAÑANA, como hace el propio sitio',
    /arp-log\?from=2026-08-25&to=2026-08-26&max=100/.test(url), url);
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('sale la línea de Discord', !!d, lines(w).map((x) => x[0]).join(' / '));
  check('cobrada hoy: 5/5 con marca', d && d[1] === '5/5 ✅' && /--done/.test(d[2]), d && d.join(' | '));
}
{
  // El control negativo que faltaba, y el que habría cazado el fallo: el mismo
  // volcado, leído desde un día SIN Discord. Sumando los tres días saldría 15 y
  // la línea diría «hecho»; contando solo hoy tiene que decir 0 de 5.
  //
  // El día es MIÉRCOLES 26 y no domingo 23, que es el que había: desde que la
  // línea calla los fines de semana, el 23 dejó de probar esto y pasó a probar
  // lo otro. El 26 sirve igual —el volcado no tiene ni una fila de ese día— y
  // de paso deja dicho que en todo el registro NO hay un laborable sin Discord:
  // los cinco lo tienen, y solo faltan el sábado y el domingo.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-26T12:00:00Z');
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('un día sin encuesta no hereda el ARP de otros días',
    d && d[1] === '0/5' && /--todo/.test(d[2]), d && d.join(' | '));
}
{
  // Y el día intermedio, para que no valga con mirar solo el más reciente.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-24T12:00:00Z');
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('el 24, que sí la tiene, sale 5/5', d && d[1] === '5/5 ✅', d && d.join(' | '));
}
{
  // Las filas de detalle repiten el icono y el importe. Si se contaran, el 25
  // daría 10 en vez de 5 —y seguiría diciendo «hecho»—, así que aquí se mira la
  // cifra directamente, no la etiqueta.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-25T12:00:00Z');
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  const guardado = JSON.parse(w.localStorage.getItem('awa-arp-log') || 'null');
  check('no cuenta dos veces la fila de detalle (5, no 10)',
    guardado && guardado.discord === 5, JSON.stringify(guardado));
}
{
  // Un registro sin Discord: la línea debe salir pendiente, 0 de 5.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    // El reloj se FIJA a un laborable. Sin fijarlo, esta prueba usaba la fecha
    // real de quien la ejecuta: pasaba de lunes a viernes y fallaba el sábado,
    // que es exactamente como se descubrió. Una prueba que depende del día en
    // que se corre no prueba lo que dice probar.
    relojEnDia(win, '2026-08-26T12:00:00Z');
    // Con el marcador de sesión: sin él la respuesta se descarta entera, que es
    // otra cosa distinta y tiene su propia prueba más abajo.
    win.__respuestas = { 'arp-log': '<html><body><script>var user_is_logged_in = true;</script><main></main></body></html>' };
  }); await tick(); await tick();
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('sin cobrar, sale 0/5', d && d[1] === '0/5', d && d.join(' | '));
  check('y marcada como pendiente', d && /--todo/.test(d[2]), d && d[2]);
}
{
  // Sin red, el panel sigue en pie y simplemente no pinta la línea.
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick(); await tick();
  check('sin registro, el panel no se rompe', !!w.document.getElementById('awa-arp-widget'));
  check('y no inventa una línea de Discord', !lines(w).some((l) => /Discord/.test(l[0])));
}

console.log('\n=== 24.1 La caché de Discord evita repetir la petición ===');
{
  // Ya cobrada hoy: no se vuelve a pedir el registro en todo el día.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: Date.now() }));
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  check('con Discord ya cobrado no se pide el registro', !w.fetched.some((u) => /arp-log/.test(u)),
    JSON.stringify(w.fetched));
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('y la línea sale de la caché', d && d[1] === '5/5 ✅', d && d.join(' | '));
}
{
  // A cero y con la caché vieja, sí se recomprueba: puede llegar en cualquier
  // momento del día.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 0, at: Date.now() - 10 * 60 * 1000 }));
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  check('a cero y caducada, se vuelve a pedir', w.fetched.some((u) => /arp-log/.test(u)),
    JSON.stringify(w.fetched));
}

console.log('\n=== 25. Botón de actualizar y refresco automático ===');
{
  // Lo que hace útil al botón es que se SALTE la caché. Un botón que repinta la
  // misma caché es el que dejó encerrado al panel de bing-rewards: parece que
  // hace algo y no relee nada.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
  }); await tick(); await tick();
  const tw0 = lines(w).find((l) => /Twitch/.test(l[0]));
  check('al cargar, Twitch va por 2/15', tw0 && tw0[1] === '2/15', tw0 && tw0.join(' | '));
  const boton = w.document.querySelector('#awa-arp-widget .awa-w__refresh');
  check('existe el botón de actualizar', !!boton);

  // Cambia el estado en el servidor: si el botón relee de verdad, se ve.
  w.__respuestas['control-center'] = leer('dom-control-center-twitch-completed-2026-08.html');
  boton.click(); await tick(); await tick();
  const tw1 = lines(w).find((l) => /Twitch/.test(l[0]));
  check('al pulsar, se salta la caché y trae el dato nuevo', tw1 && tw1[1] === '15/15 ✅',
    tw1 && tw1.join(' | '));
  check('y eso fue una segunda petición, no la caché',
    w.fetched.filter((u) => /control-center$/.test(u)).length === 2,
    JSON.stringify(w.fetched));
}
{
  // El refresco automático: 15 minutos, sin tocar nada.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 600);
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  check('parte de una sola lectura',
    w.fetched.filter((u) => /control-center$/.test(u)).length === 1, JSON.stringify(w.fetched));

  mover(600 - 5);                       // cinco minutos después: todavía no toca
  tic(w); await tick(); await tick();
  check('a los 5 minutos no relee',
    w.fetched.filter((u) => /control-center$/.test(u)).length === 1, JSON.stringify(w.fetched));

  mover(600 - 16);                      // dieciséis: ya pasó el cuarto de hora
  w.__respuestas['control-center'] = leer('dom-control-center-twitch-completed-2026-08.html');
  tic(w); await tick(); await tick();
  check('a los 16 sí relee, sin tocar nada',
    w.fetched.filter((u) => /control-center$/.test(u)).length === 2, JSON.stringify(w.fetched));
  const tw = lines(w).find((l) => /Twitch/.test(l[0]));
  check('y el panel enseña el dato nuevo', tw && tw[1] === '15/15 ✅', tw && tw.join(' | '));
}
{
  // Y el control que faltaba cuando esto se escribió mal la primera vez: una
  // relectura que falla NO puede dejar el panel en blanco. Se leería como «no
  // queda nada», y de paso apagaría el aviso, que necesita `daily` para decidir.
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center');
  await tick(); await tick();
  const antes = lines(w).find((l) => /Twitch/.test(l[0]));
  check('el panel arranca con datos de la página', antes && antes[1] === '2/15',
    antes && antes.join(' | '));
  // Sin dobles de respuesta, el fetch forzado se cae.
  w.document.querySelector('#awa-arp-widget .awa-w__refresh').click();
  await tick(); await tick();
  const despues = lines(w).find((l) => /Twitch/.test(l[0]));
  check('una relectura fallida conserva lo que había', despues && despues[1] === '2/15',
    despues && despues.join(' | '));
  check('y no cae al mensaje de «no se pudo leer»',
    !w.document.querySelector('#awa-arp-widget .awa-w__empty'));
}
{
  // El fallo tal cual salió en el sitio: se pulsa ⟳ y el panel sabe MENOS que
  // antes —desaparecen «Tiempo en el sitio» y «Twitch»— porque la respuesta
  // trae esos contadores vacíos. Un campo vacío no significa «no hay», significa
  // «no lo pude leer», así que actualizar no puede quitar líneas.
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.__respuestas = { 'control-center': sinContadores(leer('dom-control-center-twitch-progress-2026-08.html')) };
  }); await tick(); await tick();
  const antes = lines(w).map((l) => l[0]);
  // Cinco: sin dobles para el pase ni el registro, esas dos líneas no se pintan.
  check('al cargar están las cinco líneas', antes.length === 5, antes.join(' / '));

  w.document.querySelector('#awa-arp-widget .awa-w__refresh').click();
  await tick(); await tick();
  const despues = lines(w);
  check('tras actualizar NO desaparece ninguna línea',
    despues.length === antes.length, despues.map((l) => l[0]).join(' / '));
  const tw = despues.find((l) => /Twitch/.test(l[0]));
  check('y Twitch conserva su cifra en vez de esfumarse', tw && tw[1] === '2/15',
    tw && tw.join(' | '));
  // Lo que SÍ venía en la respuesta se actualiza igual: la fusión no congela el
  // panel, solo tapa los huecos.
  const qs = despues.find((l) => /Steam/.test(l[0]));
  check('lo que sí llegó se sigue actualizando', qs && qs[1] === '2/3', qs && qs.join(' | '));
}
{
  // La edad del dato: sin ella no hay forma de saber si el botón releyó.
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick(); await tick();
  const boton = w.document.querySelector('#awa-arp-widget .awa-w__refresh');
  check('el botón dice cuándo se leyó', !!boton && boton.textContent.indexOf('↻') === 0
    && /\d|ahora|now|момент/i.test(boton.textContent), boton && boton.textContent);
}

console.log('\n=== 26. Una respuesta que no es nuestra se tira ===');
{
  // Si un redirect lleva la petición a otro origen, el fetch viaja SIN la sesión
  // —`credentials: 'same-origin'` no manda la cookie fuera del origen, aunque el
  // sitio la comparta entre subdominios—. Lo que vuelve no es un error: es la
  // página de un desconocido, y parsearla llena el panel con datos de nadie.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__origen = 'https://otro-origen.example.com';
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
  }); await tick(); await tick();
  check('se pidió el Centro de control', w.fetched.some((u) => /control-center/.test(u)),
    JSON.stringify(w.fetched));
  check('pero la respuesta de otro origen NO se usa',
    !!w.document.querySelector('#awa-arp-widget .awa-w__empty'),
    lines(w).map((l) => l.join('=')).join(' / '));
  check('y no se cuela ninguna línea de esa página',
    lines(w).filter((l) => /Twitch|Steam|Tiempo/.test(l[0])).length === 0,
    lines(w).map((l) => l[0]).join(' / '));
}
{
  // Mismo origen pero sin sesión: el sitio escribe `user_is_logged_in` en todas
  // sus páginas, así que su ausencia delata una respuesta de invitado.
  const html = leer('dom-control-center-twitch-progress-2026-08.html')
    .replace('user_is_logged_in = true', 'user_is_logged_in = false');
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__respuestas = { 'control-center': html };
  }); await tick(); await tick();
  check('una respuesta sin sesión tampoco se usa',
    !!w.document.querySelector('#awa-arp-widget .awa-w__empty'),
    lines(w).map((l) => l.join('=')).join(' / '));
}
{
  // Y el control positivo, que es el que impide que esto pase por estar roto:
  // misma página, mismo origen y con sesión, se usa como siempre.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
  }); await tick(); await tick();
  const tw = lines(w).find((l) => /Twitch/.test(l[0]));
  check('la respuesta buena sí se usa', tw && tw[1] === '2/15', tw && tw.join(' | '));
}

console.log('\n=== 27. El idioma sigue a Weglot, que llega tarde ===');
{
  // En `na.` el <html lang> es el idioma ORIGEN, no el elegido, y el selector de
  // Weglot no existe todavía cuando arranca el script: el panel salía en inglés
  // con el sitio en español.
  // Se simula la entrada en el idioma ORIGEN: el servidor sirve la página en
  // inglés y Weglot todavía no ha aplicado la preferencia del usuario, así que ni
  // hay switcher ni el `lang` dice la verdad. Pasa en cualquier host.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.document.documentElement.setAttribute('lang', 'en');
    const sw = win.document.querySelector('.wgcurrent');
    if (sw) sw.remove();
    capturarTics(win);
  }); await tick();
  check('sin Weglot todavía, arranca con el lang del documento',
    /ARP TODAY/i.test(txt(w, '#awa-arp-widget .awa-w__title') || ''),
    txt(w, '#awa-arp-widget .awa-w__title'));

  // Weglot termina de cargar y dice que el idioma es español.
  w.Weglot = { getCurrentLang: () => 'es' };
  tic(w); await tick();
  check('cuando Weglot carga, el panel se rehace en su idioma',
    /ARP DE HOY/i.test(txt(w, '#awa-arp-widget .awa-w__title') || ''),
    txt(w, '#awa-arp-widget .awa-w__title'));
  check('y sigue habiendo UN solo panel',
    w.document.querySelectorAll('#awa-arp-widget').length === 1,
    String(w.document.querySelectorAll('#awa-arp-widget').length));
  const tos = lines(w).find((l) => /Tiempo/.test(l[0]));
  check('con sus datos intactos', tos && tos[1] === '5/5 ✅', tos && tos.join(' | '));
}
{
  // Lo que el usuario eligió EN EL PANEL manda sobre lo que diga el sitio.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-lang', 'de');
    win.Weglot = { getCurrentLang: () => 'es' };
  }); await tick();
  check('la preferencia del panel gana a Weglot',
    /ARP HEUTE/i.test(txt(w, '#awa-arp-widget .awa-w__title') || ''),
    txt(w, '#awa-arp-widget .awa-w__title'));
}

console.log('\n=== 28. Frenos de red: los términos del sitio prohíben pedir en bucle ===');
{
  // (1) Una pestaña oculta no pide nada. Es el peor patrón —ocho horas de fondo
  // pidiendo— y el menos útil, porque nadie está mirando.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 600);
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  const alCargar = w.fetched.filter((u) => /control-center$/.test(u)).length;

  ocultar(w, true);
  mover(600 - 16);                 // pasa el cuarto de hora con la pestaña oculta
  tic(w); await tick(); await tick();
  check('con la pestaña oculta no se pide nada',
    w.fetched.filter((u) => /control-center$/.test(u)).length === alCargar,
    JSON.stringify(w.fetched));

  // Y al volver a ella se relee: es el momento exacto en que hace falta.
  ocultar(w, false); await tick(); await tick();
  check('al volver a la pestaña sí relee',
    w.fetched.filter((u) => /control-center$/.test(u)).length === alCargar + 1,
    JSON.stringify(w.fetched));
}
{
  // (1b) La excepción: dentro de la ventana del aviso SÍ se relee aunque esté
  // oculta, porque si no, no se puede decidir si avisar — y es justo cuando no
  // estás mirando cuando el aviso sirve.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    mover = relojMovible(win, 600);
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-progress-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  const alCargar = w.fetched.filter((u) => /control-center$/.test(u)).length;
  ocultar(w, true);
  mover(20);                       // veinte minutos para el reinicio
  tic(w); await tick(); await tick();
  check('oculta pero en la ventana del aviso, sí relee',
    w.fetched.filter((u) => /control-center$/.test(u)).length === alCargar + 1,
    JSON.stringify(w.fetched));
}
{
  // (2) Coordinación entre pestañas: si otra acaba de pedir, esta repinta de la
  // caché en vez de pedir lo mismo. Se finge la otra pestaña dejando su marca y
  // su caché en localStorage.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 600);
    capturarTics(win);
  }); await tick(); await tick();
  const antes = w.fetched.length;

  mover(600 - 16);
  const ahora = w.Date.now();
  // La otra pestaña pidió hace un minuto y dejó el dato.
  w.localStorage.setItem('awa-arp-refresh', String(ahora - 60000));
  w.localStorage.setItem('awa-arp-daily', JSON.stringify({
    tos: 4, tosMax: 5, twitch: 7, twitchDone: false, total: 40,
    dailyPending: 0, dailyTotal: 2, steamPending: 1, steamTotal: 3, at: ahora - 60000,
  }));
  tic(w); await tick(); await tick();
  check('si otra pestaña acaba de pedir, esta no pide',
    w.fetched.length === antes, JSON.stringify(w.fetched));
  const tw = lines(w).find((l) => /Twitch/.test(l[0]));
  check('pero se entera igual, por la caché compartida', tw && tw[1] === '7/15',
    tw && tw.join(' | '));
}
{
  // (3) El refresco automático no fuerza el pase: cambia una vez al día, y
  // forzarlo cada cuarto de hora era una petición tirada por ciclo.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 600);
    win.__respuestas = {
      'control-center': leer('dom-control-center-twitch-progress-2026-08.html'),
      'battle-pass': leer('dom-battle-pass-2026-08.html'),
      'arp-log': leer('dom-account-arp-log-completo-2026-08.html'),
    };
    capturarTics(win);
  }); await tick(); await tick();
  const pases = () => w.fetched.filter((u) => /battle-pass/.test(u)).length;
  check('al cargar se pide el pase una vez', pases() === 1, JSON.stringify(w.fetched));

  mover(600 - 16);
  tic(w); await tick(); await tick();
  check('el automático NO vuelve a pedir el pase', pases() === 1, JSON.stringify(w.fetched));
  check('pero sí el Centro de control',
    w.fetched.filter((u) => /control-center$/.test(u)).length === 2, JSON.stringify(w.fetched));

  w.document.querySelector('#awa-arp-widget .awa-w__refresh').click();
  await tick(); await tick();
  check('el botón manual sí lo fuerza', pases() === 2, JSON.stringify(w.fetched));
}

console.log('\n=== 29. Los contadores del día salen del script, no de los spans ===');
{
  // La forma REAL de la respuesta, medida en el navegador el 2026-08-26: el
  // servidor manda `tos-arp`, `twitch-arp` y `total-arp` VACÍOS y solo sirve el
  // tope. Los rellena un <script> inline al cargar. Por eso, en cuanto el dato
  // venía de un fetch, el panel se quedaba sin «Tiempo en el sitio» ni «Twitch».
  // Y aquí es primera carga: no hay nada anterior con lo que fusionar, así que la
  // línea sale o no sale.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__respuestas = { 'control-center': sinContadores(leer('dom-control-center-twitch-progress-2026-08.html')) };
  }); await tick(); await tick();
  const tos = lines(w).find((l) => /Tiempo/.test(l[0]));
  const tw = lines(w).find((l) => /Twitch/.test(l[0]));
  check('con los spans vacíos, «Tiempo en el sitio» sale igual', tos && tos[1] === '2/5',
    tos && tos.join(' | '));
  check('y Twitch también', tw && tw[1] === '2/15', tw && tw.join(' | '));
}
{
  // Control negativo: sin el script, no hay de dónde sacarlo y las dos líneas
  // desaparecen. Es lo que demuestra que el dato viene del script y no del DOM.
  const sinScript = (() => {
    const d = new JSDOM(sinContadores(leer('dom-control-center-twitch-progress-2026-08.html')),
      { virtualConsole: new VirtualConsole() });
    d.window.document.querySelectorAll('script').forEach((n) => {
      if (/dailyArpData/.test(n.textContent || '')) n.textContent = 'var user_is_logged_in = true;';
    });
    return d.serialize();
  })();
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__respuestas = { 'control-center': sinScript };
  }); await tick(); await tick();
  check('sin el script, las dos líneas no salen',
    !lines(w).some((l) => /Tiempo|Twitch/.test(l[0])), lines(w).map((l) => l[0]).join(' / '));
}
{
  // `underCap` sustituye a leer «Complete» del estado, que era texto traducido por
  // Weglot. Un booleano no tiene idioma. Para que esto lo DEMUESTRE hay que quitar
  // el texto del estado: con él puesto, la prueba pasaría por el camino viejo.
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    const st = win.document.getElementById('control-center__twitch-arp-status');
    if (st) st.textContent = 'Vollständig';        // ni «complete» ni «incomplet»
    const n = win.document.getElementById('control-center__twitch-arp');
    if (n) n.textContent = '';
  }); await tick(); await tick();
  const tw = lines(w).find((l) => /Twitch/.test(l[0]));
  check('Twitch completo se lee de underCap y no del texto del estado',
    tw && tw[1] === '15/15 ✅', tw && tw.join(' | '));
}

console.log('\n=== 30. Los tres avisos, cada uno con su reloj ===');

// Volcado con TODO lo diario hecho y una quest de Steam pendiente (2/3), que es
// justo el caso que destapó el lío. Discord se siembra en la caché para que no
// dependa de la red.
// Marca el aviso de amanecer como ya visto. Se usa en las pruebas que NO van de
// él: desde el 2026-08-27 vive TODO el día y no solo la primera media hora, así
// que sin esto se cuela en la banda y en el contador de avisos de casi
// cualquier escenario diurno, y las pruebas medirían dos avisos creyendo medir
// uno.
// Pulsar la banda del aviso. Devuelve si la había: sin esto, una prueba que se
// apoya en ella revienta con «null.dispatchEvent» y se lleva por delante TODA la
// suite que venía detrás —incluido cualquier control negativo—.
function marcarBanda(w) {
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  if (!banda) return false;
  banda.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
}

function amanecerVisto(win) {
  const d = new win.Date();
  win.localStorage.setItem('awa-arp-visto-amanecer',
    d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate());
}

function panelConSteamPendiente(win, iso, avisos, steamHecho) {
  relojEnDia(win, iso);
  amanecerVisto(win);
  win.localStorage.setItem('awa-arp-alert', '1');
  win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
  dobleAviso(win, avisos);
  if (steamHecho) {
    win.document.querySelectorAll('[id^="control-center__steam-quest-reward-"]')
      .forEach((n) => n.setAttribute('style', ''));
  }
}

{
  // (1) Se acaba el DÍA. Lo de Steam NO cuenta aquí: tiene su propio aviso, y
  // meterlo además en este sonaría cada noche de la semana por algo que no vence
  // hasta el lunes.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center',
    (win) => panelConSteamPendiente(win, '2026-08-26T23:40:00Z', avisos));   // miércoles
  await tick(); await tick();
  const qs = lines(w).find((l) => /Steam/.test(l[0]));
  check('queda una quest de Steam sin hacer', qs && qs[1] === '2/3', qs && qs.join(' | '));
  check('a 20 min del fin del día NO avisa: Steam tiene su propio reloj',
    avisos.length === 0, 'avisó ' + avisos.length);
}
{
  // Y el positivo del aviso del día: algo del día sin hacer a 20 minutos.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center',
    (win) => panelConSteamPendiente(win, '2026-08-26T23:40:00Z', avisos));
  await tick(); await tick();
  check('con algo del día pendiente, a 20 min SÍ avisa', avisos.length === 1,
    'avisó ' + avisos.length);
}

{
  // (2) Se acaba la SEMANA de Steam: seis horas antes, porque estas no se
  // despachan pulsando —hay que jugar, y el sitio tarda hasta una hora en verlo—.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center',
    (win) => panelConSteamPendiente(win, '2026-08-30T18:10:00Z', avisos));   // domingo, 5h50m
  await tick(); await tick();
  check('a menos de 6 h del lunes y con Steam pendiente, avisa', avisos.length === 1,
    'avisó ' + avisos.length);
}
{
  // Justo antes de la ventana: todavía no.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center',
    (win) => panelConSteamPendiente(win, '2026-08-30T17:30:00Z', avisos));   // 6h30m
  await tick(); await tick();
  check('a 6 h y media todavía no', avisos.length === 0, 'avisó ' + avisos.length);
}
{
  // Y con las de Steam hechas, esa misma tarde no suena. Mismo volcado que el
  // positivo, cambiando SOLO Steam: si no, el control no controla nada.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center',
    (win) => panelConSteamPendiente(win, '2026-08-30T18:10:00Z', avisos, true));
  await tick(); await tick();
  const qs = lines(w).find((l) => /Steam/.test(l[0]));
  check('con Steam al día, esa tarde no avisa',
    avisos.length === 0 && qs && /✅/.test(qs[1]), (qs && qs.join(' | ')) + ' · avisó ' + avisos.length);
}

{
  // (3) EMPIEZA el día nuevo, y su ventana es TODO el día. Un aviso que solo
  // existe entre las 00:00 y las 00:30 UTC se lo pierde quien no tenga el sitio
  // abierto a esa hora, que es casi todo el mundo casi siempre.
  const avisos = [];
  let mover;
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    mover = relojMovible(win, 600);          // diez horas antes del reinicio
    dobleAviso(win, avisos);
    capturarTics(win);
  }); await tick(); await tick();
  check('entrar al sitio a media tarde SÍ saluda', avisos.length === 1,
    'avisó ' + avisos.length);

  // Un solo diálogo aunque pase el rato: lo que se queda a la vista es la banda.
  mover(565);                                 // treinta y cinco minutos después
  tic(w); await tick(); await tick(); await tick();
  check('no abre un segundo diálogo', avisos.length === 1, 'avisó ' + avisos.length);
  check('pero la banda sigue puesta',
    !!w.document.querySelector('#awa-arp-widget .awa-w__alert'));

  // Marcarlo lo calla el resto del día.
  marcarBanda(w);
  mover(500);
  tic(w); await tick(); await tick(); await tick();
  check('marcado como visto, calla el resto del día',
    avisos.length === 1 && !w.document.querySelector('#awa-arp-widget .awa-w__alert'),
    'avisó ' + avisos.length);
}
{
  // Entrar por primera vez a media tarde: nadie tenía el sitio abierto a las
  // 00:00, y el aviso está justo para esto.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojEnDia(win, '2026-08-26T15:00:00Z');
    dobleAviso(win, avisos);
  }); await tick(); await tick();
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  check('a las 15:00 UTC, con el sitio recién abierto, saluda',
    avisos.length === 1 && banda && /día nuevo/i.test(banda.textContent),
    'avisó ' + avisos.length + ' · ' + (banda && banda.textContent.replace(/\s+/g, ' ')));
}
{
  // Y a los 40 minutos también, que antes era justo el hueco por el que se caía.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojEnDia(win, '2026-08-26T00:40:00Z');
    dobleAviso(win, avisos);
  }); await tick(); await tick();
  check('a los 40 minutos del día nuevo sigue saludando', avisos.length === 1,
    'avisó ' + avisos.length);
}
{
  // La ÚNICA hora en que se calla: la última media hora del día. «Empieza un día
  // nuevo» a las 23:40 no llega tarde, dice lo contrario de lo que pasa —y
  // saldría en la misma banda que «se acaba el día»—.
  const avisos = [];
  const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojEnDia(win, '2026-08-26T23:40:00Z');
    dobleAviso(win, avisos);
  }); await tick(); await tick();
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  check('en la última media hora no saluda',
    !banda || !/día nuevo/i.test(banda.textContent),
    banda ? banda.textContent.replace(/\s+/g, ' ') : '(sin banda)');
}

console.log('\n=== 31. Al empezar el día se relee, y lo de ayer se tira ===');
{
  // Al cruzar la medianoche los contadores del sitio se ponen a cero. Si el panel
  // conserva los de ayer —que es lo que hace `fusionar`, y está bien DENTRO de un
  // día— enseñaría «5/5 ✅» con el día entero por hacer.
  let mover;
  // A TRES minutos del reinicio: cuando se cruce la medianoche solo habrán pasado
  // cinco, muy por debajo del ciclo de 15, así que si relee solo puede haber sido
  // por el amanecer. Arrancando a 600 minutos la prueba pasaba igual sin arreglo.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 3);
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-completed-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  const antes = lines(w).find((l) => /Tiempo/.test(l[0]));
  check('de tarde, el panel enseña el día hecho', antes && antes[1] === '5/5 ✅',
    antes && antes.join(' | '));
  const pedidas = w.fetched.filter((u) => /control-center$/.test(u)).length;

  // Cruza la medianoche. El sitio ya contesta con el día nuevo empezado.
  mover(-2);
  w.__respuestas['control-center'] = leer('dom-control-center-twitch-progress-2026-08.html');
  tic(w); await tick(); await tick();
  check('al amanecer relee sin esperar al ciclo de 15 minutos',
    w.fetched.filter((u) => /control-center$/.test(u)).length === pedidas + 1,
    JSON.stringify(w.fetched));
  const despues = lines(w).find((l) => /Tiempo/.test(l[0]));
  check('y el panel enseña el día nuevo, no el de ayer', despues && despues[1] === '2/5',
    despues && despues.join(' | '));
}
{
  // Y si la relectura falla, NO se queda lo de ayer: `fusionar` conserva campos
  // dentro de un día, pero al cruzarlo eso sería mentir.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 600);
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-completed-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  check('de tarde hay datos', !!lines(w).find((l) => /Tiempo/.test(l[0])));

  mover(-2);
  delete w.__respuestas['control-center'];     // el amanecer se queda sin red
  tic(w); await tick(); await tick();
  check('sin red al amanecer NO se hereda el día de ayer',
    !lines(w).some((l) => /Tiempo|Twitch/.test(l[0])), lines(w).map((l) => l[0]).join(' / '));
  check('y lo dice en vez de callarlo',
    !!w.document.querySelector('#awa-arp-widget .awa-w__empty'));
}
{
  // La relectura NO depende del aviso: con la casilla apagada, el panel tiene que
  // enseñar el día nuevo igual.
  let mover;
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    mover = relojMovible(win, 3);          // ver arriba: cinco minutos, no diez horas
    win.__respuestas = { 'control-center': leer('dom-control-center-twitch-completed-2026-08.html') };
    capturarTics(win);
  }); await tick(); await tick();
  const pedidas = w.fetched.filter((u) => /control-center$/.test(u)).length;
  mover(-2);
  tic(w); await tick(); await tick();
  check('con los avisos apagados también relee al amanecer',
    w.fetched.filter((u) => /control-center$/.test(u)).length === pedidas + 1,
    JSON.stringify(w.fetched));
}

console.log('\n=== 32. Un diálogo por tanda, y la banda hasta que la marcas ===');
{
  // Con sonido, insistir tenía sentido: un sonido se pierde. Con un diálogo no:
  // te espera bloqueando el hilo. Así que el diálogo sale UNA vez por tanda —un
  // modal cada cinco minutos es un secuestro— y lo que insiste son los otros dos
  // canales, que no se van hasta que los marcas.
  const avisos = [];
  let mover;
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    mover = relojMovible(win, 25);
    amanecerVisto(win);
    dobleAviso(win, avisos);
    capturarTics(win);
  }); await tick(); await tick(); await tick();
  check('al entrar en la ventana sale el diálogo', avisos.length === 1, 'avisó ' + avisos.length);
  check('con la banda puesta', !!w.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y la marca en el título', w.document.title.indexOf('👽') === 0, w.document.title);

  mover(19);                                 // seis minutos después
  tic(w); await tick(); await tick(); await tick();
  check('el recordatorio NO abre otro diálogo', avisos.length === 1, 'avisó ' + avisos.length);
  check('pero la banda sigue ahí', !!w.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y la marca también', w.document.title.indexOf('👽') === 0, w.document.title);

  // Marcarlo como visto es lo ÚNICO que lo retira antes de que caduque.
  marcarBanda(w);
  check('marcado como visto, la banda se va',
    !w.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('y el título vuelve a ser el del sitio', w.document.title.indexOf('👽') !== 0,
    w.document.title);
  check('la marca «ya lo viste» queda escrita',
    w.localStorage.getItem('awa-arp-visto-dia') !== null,
    String(w.localStorage.getItem('awa-arp-visto-dia')));

  mover(13);
  tic(w); await tick(); await tick(); await tick();
  check('y ya no vuelve', avisos.length === 1 && !w.document.querySelector('#awa-arp-widget .awa-w__alert'),
    'avisó ' + avisos.length);
}
{
  // El domingo por la noche los dos se solapan: la semana de Steam y el fin del
  // día. Salen los dos en la banda y en el MISMO diálogo, y un solo «visto» los
  // calla a los dos.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojEnDia(win, '2026-08-30T23:40:00Z');   // domingo, 20 min para el lunes
    amanecerVisto(win);
    dobleAviso(win, avisos);
  }); await tick(); await tick(); await tick();
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  check('la banda enseña los dos avisos',
    banda && /semana/i.test(banda.textContent) && /acaba el día/i.test(banda.textContent),
    banda && banda.textContent.replace(/\s+/g, ' '));
  check('y el diálogo también, en uno solo',
    avisos.length === 1 && /semana/i.test(avisos[0]) && /acaba el día/i.test(avisos[0]),
    JSON.stringify(avisos[0]));
  marcarBanda(w);
  check('un solo «visto» marca los dos',
    w.localStorage.getItem('awa-arp-visto-dia') !== null
      && w.localStorage.getItem('awa-arp-visto-semana') !== null,
    'día=' + w.localStorage.getItem('awa-arp-visto-dia')
      + ' semana=' + w.localStorage.getItem('awa-arp-visto-semana'));
}

console.log('\n=== 33. Las marcas viejas no pueden callar el aviso ===');
{
  // El fallo del 2026-08-26: las tres marcas cambiaron de significado —de «ya
  // sonó» a «ya lo viste»— conservando el nombre y la forma. Una marca vieja del
  // mismo día se leía como «ya la viste» y el aviso se quedaba callado el resto
  // de la jornada, sin nada que lo delatara.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    relojFalso(win, 10);
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    // Lo que dejaría una versión anterior instalada el mismo día:
    const d = new win.Date();
    win.localStorage.setItem('awa-arp-alert-done',
      d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate());
    dobleAviso(win, avisos);
  }); await tick(); await tick();
  check('con la marca vieja puesta, el aviso sale igual', avisos.length === 1,
    'avisó ' + avisos.length);
  check('y la marca vieja se borra al arrancar',
    w.localStorage.getItem('awa-arp-alert-done') === null,
    String(w.localStorage.getItem('awa-arp-alert-done')));
}

console.log('\n=== 34. Cada página que abras con un aviso sin marcar te lo dice ===');
{
  // Reportado el 2026-08-27: «no se abre el alert hasta que se interactúa con el
  // checkbox». La constancia vive en localStorage y sobrevive a cambiar de
  // página, así que la SEGUNDA carga ya no era «un cambio» y el diálogo no
  // salía. O sea que si el primero te pilló en otra pestaña, no lo veías nunca
  // más —y tocar la casilla lo arreglaba solo porque borra la constancia—.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos);
  }); await tick(); await tick(); await tick();
  check('la primera carga abre el diálogo', avisos.length === 1, 'avisó ' + avisos.length);

  // Otra página del sitio, con la constancia YA puesta y sin marcar.
  const avisos2 = [];
  const w2 = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-aviso', w.localStorage.getItem('awa-arp-aviso'));
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos2);
  }); await tick(); await tick(); await tick();
  check('y la siguiente página también', avisos2.length === 1, 'avisó ' + avisos2.length);
  check('con la banda puesta', !!w2.document.querySelector('#awa-arp-widget .awa-w__alert'));

  // Pero una vez MARCADO, ninguna página vuelve a abrirlo.
  marcarBanda(w2);
  const avisos3 = [];
  const w3 = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-visto-dia', w2.localStorage.getItem('awa-arp-visto-dia'));
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos3);
  }); await tick(); await tick(); await tick();
  check('marcado como visto, ya ninguna página lo abre', avisos3.length === 0,
    'avisó ' + avisos3.length);
}

console.log('\n=== 35. La pestaña: favicon, y el diálogo espera a que vuelvas ===');
{
  // El navegador SE QUEDA el alert() de una pestaña de fondo: no lo pinta y la
  // llamada vuelve sin haber enseñado nada. O sea que el aviso se gastaba justo
  // cuando más falta hacía. Ahora espera; mientras, llaman título y favicon.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojFalso(win, 10);
    amanecerVisto(win);
    Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => true });
    dobleAviso(win, avisos);
  }); await tick(); await tick(); await tick();
  check('en una pestaña de fondo NO se gasta el diálogo', avisos.length === 0,
    'avisó ' + avisos.length);
  check('pero el título ya llama', w.document.title.indexOf('👽') === 0, w.document.title);

  const icono = w.document.getElementById('awa-arp-favicon');
  check('y el favicon también', !!icono && /^data:image\/svg\+xml,/.test(icono.href),
    icono ? icono.href.slice(0, 40) : '(sin icono)');
  check('los cuatro del sitio quedan desactivados, no borrados',
    w.document.querySelectorAll('link[data-awa-icon-rel]').length === 4
      && w.document.querySelectorAll('link[rel~="icon"]:not(#awa-arp-favicon)').length === 0,
    'guardados ' + w.document.querySelectorAll('link[data-awa-icon-rel]').length);

  // Al volver, el diálogo sale.
  ocultar(w, false); await tick(); await tick();
  check('al volver a la pestaña sale el diálogo', avisos.length === 1,
    'avisó ' + avisos.length);
  check('y solo una vez', avisos.length === 1, 'avisó ' + avisos.length);
  ocultar(w, true); ocultar(w, false); await tick(); await tick();
  check('volver otra vez no lo repite', avisos.length === 1, 'avisó ' + avisos.length);
}
{
  // Y marcarlo como visto devuelve la pestaña a como estaba.
  const avisos = [];
  const w = mount('dom-control-center-twitch-progress-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-alert', '1');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: win.Date.now() }));
    relojFalso(win, 10);
    amanecerVisto(win);
    dobleAviso(win, avisos);
  }); await tick(); await tick(); await tick();
  check('con la pestaña delante el diálogo sale ya', avisos.length === 1,
    'avisó ' + avisos.length);
  check('y hay favicon nuestro', !!w.document.getElementById('awa-arp-favicon'));

  marcarBanda(w);
  check('marcado como visto, el favicon nuestro se va',
    !w.document.getElementById('awa-arp-favicon'));
  check('y los del sitio vuelven con su rel',
    w.document.querySelectorAll('link[rel~="icon"]').length === 4
      && w.document.querySelectorAll('link[data-awa-icon-rel]').length === 0,
    'del sitio ' + w.document.querySelectorAll('link[rel~="icon"]').length);
  check('y el título vuelve a ser el del sitio', w.document.title.indexOf('👽') !== 0,
    w.document.title);
}

console.log('\n=== 36. Los TRES calendarios, que no son uno ===');
{
  // Volcado del 2026-08-28. El sitio tiene tres rejillas distintas y el panel
  // solo leía una, llamándola «Calendario» a secas:
  //   · la promocional (botón por día, 10 ARP)
  //   · la racha de 7 días  -> iba por el día 1, recién rota
  //   · el calendario de 28 -> iba por el día 8
  // Que los dos números NO coincidan es justo lo que hacía falta enseñar.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center'); await tick();
  const sub = txt(w, '#awa-arp-widget .awa-w__sub');
  check('la racha sale con su total', /1\/7/.test(sub || ''), String(sub));
  check('y el mes con el suyo, que es OTRO número', /8\/28/.test(sub || ''), String(sub));
  check('sin repetir la racha vieja «día N»', !/día 1(?!\/)/.test(sub || ''), String(sub));

  const cal = lines(w).find((l) => /[Cc]alendario|[Cc]alendar/.test(l[0]));
  check('el calendario del panel dice que es el de CAMPAÑA',
    cal && /campaña|campaign/i.test(cal[0]), cal && cal.join(' | '));
  // Y sigue diciendo la verdad sobre ESE: el día 5 tiene su botón sin pulsar.
  check('4 de 5 cobrados, con el quinto esperando', cal && cal[1] === '4/5', cal && cal.join(' | '));
  check('y en amarillo, que es lo que pide acción', cal && /--todo/.test(cal[2]), cal && cal.join(' | '));
}
{
  // Fuera del Centro de control las rejillas NO existen, así que el panel cae a
  // lo que sí hay —la global de la racha— en vez de inventarse un total.
  const w = mount('dom-homepage-src-2026-08.html', '/'); await tick(); await tick();
  const sub = txt(w, '#awa-arp-widget .awa-w__sub');
  check('sin rejillas, ni /7 ni /28', !/\/7|\/28/.test(sub || ''), String(sub));
  check('pero la racha de la global sigue saliendo', /1/.test(sub || ''), String(sub));
}
{
  // Y el registro nuevo cierra un hueco viejo (§13): «Premio del juego», que era
  // la única fuente del historial sin identificar, son 18 ARP de un minijuego.
  const w = mount('dom-account-arp-log-streak-2026-08.html', '/account/arp-log'); await tick();
  const filas = w.document.querySelectorAll('.card-table-row').length;
  check('el volcado del registro trae sus filas', filas >= 7, 'filas: ' + filas);
  const html = w.document.body.textContent;
  check('y entre ellas el «Premio del juego» sin identificar hasta hoy',
    /Premio del juego/.test(html));
}

console.log('\n=== 37. Cobrar el calendario, que solo pasa en la copia ===');
{
  // Se reproduce lo que hace el sitio al cobrar (visto en su propio código):
  //     $btn.remove();  $('#claimed-' + day).show();
  // sobre la COPIA del overlay, dejando el original como estaba. Antes, el panel
  // leía el original y seguía en «por reclamar» para siempre.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center',
    capturarTics); await tick();
  const antes = lines(w).find(l => /Calendario|Calendar/.test(l[0]));
  check('de partida, 4/5 y en amarillo', antes && antes[1] === '4/5' && /--todo/.test(antes[2]),
    antes && antes.join(' | '));

  const d = w.document;
  const orig = d.querySelector('#promotional-calendar-container');
  const overlay = d.querySelector('.overlay-content');
  overlay.innerHTML = orig.innerHTML;              // togglePromotionalCalendar()
  const copia = overlay.querySelector('.promotional-calendar__day[data-day="5"]');
  copia.querySelector('button.promotional-calendar__day-claim').remove();
  copia.querySelector('.promotional-calendar__day-claimed').style.display = '';
  // El original NO se toca, que es justo lo que hace el sitio.
  check('el original conserva su botón intacto',
    !!orig.querySelector('.promotional-calendar__day[data-day="5"] button.promotional-calendar__day-claim'));

  tic(w); await tick();
  const dsp = lines(w).find(l => /Calendario|Calendar/.test(l[0]));
  check('el panel se entera: 5/5 con marca', dsp && dsp[1] === '5/5 ✅', dsp && dsp.join(' | '));
  check('y deja de pedir acción', dsp && /--done/.test(dsp[2]), dsp && dsp.join(' | '));

  // Y al cerrar el overlay —que el sitio VACÍA— no se desanda: la prueba de que
  // cobraste desaparece del DOM, así que se recuerda aparte.
  overlay.textContent = '';
  tic(w); await tick();
  const tras = lines(w).find(l => /Calendario|Calendar/.test(l[0]));
  check('cerrar el overlay no lo devuelve a «por reclamar»', tras && tras[1] === '5/5 ✅',
    tras && tras.join(' | '));
}

console.log('\n=== 38. El calendario dice DÓNDE se cobra ===');
{
  // Es la única línea del panel que se cobra fuera de la página en la que estás:
  // en el icono de la campaña de la barra de arriba. Y ese icono no se puede
  // nombrar por su dibujo, porque cambia con cada campaña (en los volcados ya
  // hay dos imágenes distintas), así que la línea lo pulsa en vez de describirlo.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center');
  await tick();
  const fila = [...w.document.querySelectorAll('#awa-arp-widget .awa-w__line')]
    .find((l) => /Calendario|Calendar/.test(l.querySelector('.awa-w__k').textContent));
  check('la línea se marca como que lleva a algún sitio', /--go/.test(fila.className), fila.className);
  check('y lo enseña con una flecha en la etiqueta',
    /↗/.test(fila.querySelector('.awa-w__k').textContent), fila.querySelector('.awa-w__k').textContent);
  check('la cifra se queda limpia', !/↗/.test(fila.querySelector('.awa-w__v').textContent),
    fila.querySelector('.awa-w__v').textContent);

  // Pulsarla dispara el gatillo del sitio, que es lo que abre el calendario.
  let abierto = 0;
  const gatillo = w.document.querySelector('.nav-item-promo');
  gatillo.addEventListener('click', () => { abierto++; });   // como el delegado de jQuery
  fila.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('al pulsarla, el clic llega al icono de la campaña', abierto === 1, 'clics: ' + abierto);

  const aviso = fila.getAttribute('title') || fila.getAttribute('data-awa-tip') || '';
  check('el tooltip sitúa el icono sin nombrar la campaña',
    /barra/i.test(aviso) && /campana/i.test(aviso) && !/intel/i.test(aviso), aviso.slice(0, 90));
}
{
  // Y donde no hay gatillo, ni flecha ni clic: no se promete un sitio que no está.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center', (win) => {
    win.document.querySelectorAll('.nav-item-promo').forEach((n) => n.remove());
  }); await tick();
  const fila = [...w.document.querySelectorAll('#awa-arp-widget .awa-w__line')]
    .find((l) => /Calendario|Calendar/.test(l.querySelector('.awa-w__k').textContent));
  check('sin icono en la barra, la línea no finge llevar a ningún lado',
    !/--go/.test(fila.className) && !/↗/.test(fila.textContent), fila.className);
}

console.log('\n=== 39. Cada línea dice DÓNDE se cumple ===');
// jsdom blinda `Location` entero —ni `location.href` ni `location.assign` se
// pueden redefinir—, así que la navegación DENTRO del sitio no se puede espiar.
// El destino se fija por dónde DESAPARECE la flecha: `irA` devuelve null cuando
// ya estás en esa página, así que si en /control-center la flecha se va de las
// tres del día y se queda en el pase, es que van a sitios distintos y a los
// correctos. Lo de Discord sí se mide directo, porque pasa por `window.open`.
const filaDe = (w, re) => [...w.document.querySelectorAll('#awa-arp-widget .awa-w__line')]
  .find((l) => re.test(l.querySelector('.awa-w__k').textContent));
const llevaA = (w, re) => { const f = filaDe(w, re); return !!f && /--go/.test(f.className); };
{
  // Desde la portada, que no es ninguno de los destinos: llevan las cinco.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    win.__abiertas = [];
    win.open = (u, destino, rasgos) => { win.__abiertas.push([u, destino, rasgos]); return null; };
    win.__respuestas = {
      'control-center': leer('dom-control-center-streak-monthly-2026-08.html'),
      'battle-pass': leer('dom-battle-pass-2026-08.html'),
      'arp-log': leer('dom-account-arp-log-completo-2026-08.html'),
    };
  });
  await tick(); await tick(); await tick();

  ['Twitch', 'diarias|Daily', 'Steam', 'Pase|Pass', 'Discord'].forEach((pat) => {
    check('«' + pat.split('|')[0] + '» dice dónde se cumple', llevaA(w, new RegExp(pat)),
      String((filaDe(w, new RegExp(pat)) || {}).className));
  });
  const tw = filaDe(w, /Twitch/);
  check('con la flecha en la etiqueta y la cifra limpia',
    /↗/.test(tw.querySelector('.awa-w__k').textContent)
    && !/↗/.test(tw.querySelector('.awa-w__v').textContent),
    tw.textContent);

  const dis = filaDe(w, /Discord/);
  dis.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('Discord abre una PESTAÑA NUEVA', w.__abiertas.length === 1, JSON.stringify(w.__abiertas));
  // Con guarda: si no abrió nada, esto tiene que FALLAR, no reventar la suite.
  // Una prueba que aborta se lleva por delante todo lo que venía detrás, y eso ya
  // escondió un control negativo entero en esta misma sesión.
  const abierta = w.__abiertas[0] || [];
  // Al SERVIDOR, no a su invitación: el id del gremio se resolvió contra la API
  // de Discord (ver DISCORD_URL). Se comprueba entero y no «que contenga
  // discord», porque un id equivocado abre un servidor ajeno.
  check('al servidor de Alienware, directo y sin opener',
    abierta[0] === 'https://discord.com/channels/97149047281827840/1069815226045833296'
    && abierta[1] === '_blank' && /noopener/.test(abierta[2] || ''),
    JSON.stringify(abierta));
  check('y ya no pasa por la invitación', !/discord\.gg/.test(abierta[0] || ''),
    String(abierta[0]));
  const avisoDis = dis.getAttribute('title') || dis.getAttribute('data-awa-tip') || '';
  check('y su aviso avisa de la pestaña nueva', /PESTAÑA NUEVA|NEW TAB/i.test(avisoDis),
    avisoDis.slice(-70));
}
{
  // Ya EN el Centro de control: las tres del día no prometen un viaje que no
  // pasa. El pase sí, que vive en otra página — y eso es lo que demuestra que
  // los dos destinos son distintos.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center', (win) => {
    // El pase NO está en el Centro de control: llega por fetch, así que sin esto
    // no habría línea de pase que comprobar —y «no lleva» y «no existe» se leen
    // igual desde fuera—.
    win.__respuestas = { 'battle-pass': leer('dom-battle-pass-2026-08.html') };
  });
  await tick(); await tick(); await tick();
  check('hay línea de pase que comprobar', !!filaDe(w, /Pase|Pass/));
  ['Twitch', 'diarias|Daily', 'Steam'].forEach((pat) => {
    check('«' + pat.split('|')[0] + '» ya está aquí: sin flecha', !llevaA(w, new RegExp(pat)),
      String((filaDe(w, new RegExp(pat)) || {}).className));
  });
  check('el pase sigue llevando, porque está en otra página', llevaA(w, /Pase|Pass/));
  const tw = filaDe(w, /Twitch/);
  const aviso = tw.getAttribute('title') || tw.getAttribute('data-awa-tip') || '';
  check('y el aviso tampoco ofrece el viaje', !/Pulsa esta línea/.test(aviso), aviso.slice(-60));
}
{
  // Y en la página del pase, al revés: es la prueba de que el destino del pase
  // NO es el Centro de control.
  const w = mount('dom-battle-pass-2026-08.html', '/control-center/battle-pass/1', (win) => {
    win.__respuestas = { 'control-center': leer('dom-control-center-streak-monthly-2026-08.html') };
  });
  await tick(); await tick(); await tick();
  check('en el pase, el pase no lleva a ninguna parte', !llevaA(w, /Pase|Pass/),
    String((filaDe(w, /Pase|Pass/) || {}).className));
  check('pero Twitch sí, al Centro de control', llevaA(w, /Twitch/),
    String((filaDe(w, /Twitch/) || {}).className));
}

console.log('\n=== 40. El ⟳ no puede perder la racha ni el mes ===');
{
  // Reproduce el reporte: al pulsar ⟳ la sub-línea pasaba de «Racha 1/7 · Mes
  // 8/28» a «Racha día 1». El ⟳ fuerza una relectura de /control-center por
  // fetch, y esa respuesta NO trae la clase `current` —la pone el JS del sitio—,
  // así que leyendo la clase el día salía null. Peor: `readRejilla` devolvía
  // igualmente un objeto, y `fusionar` lo tomaba por dato bueno y pisaba el que
  // ya estaba pintado.
  const w = mount('dom-control-center-streak-monthly-2026-08.html', '/control-center', (win) => {
    win.__respuestas = {
      'control-center': sinCurrent(leer('dom-control-center-streak-monthly-2026-08.html')),
    };
  });
  await tick();
  const antes = txt(w, '#awa-arp-widget .awa-w__sub');
  check('de partida, racha y mes', /1\/7/.test(antes) && /8\/28/.test(antes), String(antes));

  // Y que la respuesta sea de verdad la del servidor, no el volcado renderizado:
  // sin esto la prueba pasaría por el motivo equivocado.
  const doc = new w.DOMParser().parseFromString(w.__respuestas['control-center'], 'text/html');
  check('la respuesta simulada NO trae la clase `current`',
    doc.querySelectorAll('.calendar-rewards__day.current').length === 0);
  check('pero sí los globales que usa el sitio',
    /consecutive_logins\s*=/.test(w.__respuestas['control-center'])
    && /monthly_logins\s*=/.test(w.__respuestas['control-center']));

  w.document.querySelector('#awa-arp-widget .awa-w__refresh')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(); await tick(); await tick(); await tick();
  const luego = txt(w, '#awa-arp-widget .awa-w__sub');
  check('tras pulsar ⟳, la racha sigue con su total', /1\/7/.test(luego), String(luego));
  check('y el mes también', /8\/28/.test(luego), String(luego));
  check('sin caer a «Racha día N»', !/día \d/i.test(luego), String(luego));
  check('y pidió de verdad el Centro de control',
    w.fetched.some((u) => String(u).indexOf('/control-center') === 0), JSON.stringify(w.fetched));
}

console.log('\n=== 21. Las traducciones no son inglés copiado ===');
{
  const fuente = fs.readFileSync(__dirname + '/../alienware-arena-arp-tracker.user.js', 'utf8');
  // Se comparan las frases largas (los tooltips y el modal), que son las que
  // delatan un idioma sin traducir. Las cortas coinciden de forma legítima:
  // «Twitch» o «{v} ARP» son iguales en los ocho.
  const largas = ['tipTos', 'tipDaily', 'tipSteam', 'mIntro', 'mQuests'];
  const val = (lang, key) => {
    const i = fuente.indexOf('\n        ' + lang + ': {');
    const j = fuente.indexOf('\n        },', i);
    const m = fuente.slice(i, j).match(new RegExp(key + ": '((?:[^'\\\\]|\\\\.)*)'"));
    return m ? m[1] : null;
  };
  const iguales = [];
  for (const l of ['es', 'de', 'fr', 'pt', 'br', 'zh', 'hi']) {
    for (const k of largas) {
      const a = val('en', k), b = val(l, k);
      if (a && b && a === b) iguales.push(l + '.' + k);
    }
  }
  check('ningún idioma repite las frases del inglés', iguales.length === 0, iguales.join(', '));
  check('pt y br no son idénticos', val('pt', 'tipSteam') !== val('br', 'tipSteam'));
  check('zh está en chino', /[\u4e00-\u9fff]/.test(val('zh', 'tipDaily') || ''), String(val('zh', 'tipDaily')).slice(0, 30));
  check('hi está en devanagari', /[\u0900-\u097f]/.test(val('hi', 'tipDaily') || ''), String(val('hi', 'tipDaily')).slice(0, 30));
}

console.log('\n=== 41. Discord no se cobra sábado ni domingo ===');
{
  // La encuesta solo paga de lunes a viernes. Lo confirma el propio registro:
  // en `dom-account-arp-log-completo-2026-08.html` los cinco laborables (21, 24
  // y 25 con datos; 22 y 23 sin) reparten Discord y los DOS días de fin de
  // semana no tienen ni una fila.
  //
  // Lo que se prueba no es el importe, es que la línea DEJE DE PEDIRLO: antes
  // se quedaba en amarillo todo el fin de semana, y como el aviso de fin de día
  // se alimenta de lo amarillo, avisaba de algo que no se podía hacer y no había
  // manera de callarlo.
  for (const [fecha, dia] of [['2026-08-22T12:00:00Z', 'sábado'], ['2026-08-23T12:00:00Z', 'domingo']]) {
    const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
      relojEnDia(win, fecha);
      win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
    }); await tick(); await tick();
    const d = lines(w).find((l) => /Discord/.test(l[0]));
    check('el ' + dia + ' la línea sigue estando', !!d, lines(w).map((x) => x[0]).join(' / '));
    // La cifra se enseña igual: el «de lunes a viernes» va en el tooltip, no en
    // la columna del valor (decisión del usuario, 2026-08-29).
    check('el ' + dia + ' sigue enseñando la cifra', d && /0\/5/.test(d[1]), d && d.join(' | '));
    check('el ' + dia + ' NO sale en amarillo', d && !/--todo/.test(d[2]), d && d[2]);
    check('el ' + dia + ' tampoco se marca como hecha', d && !/--done/.test(d[2]), d && d[2]);
    const fila = Array.from(w.document.querySelectorAll('.awa-w__line'))
      .find((n) => /Discord/.test(n.textContent));
    check('el ' + dia + ' el tooltip explica que solo paga de lunes a viernes',
      fila && /LUNES A VIERNES/.test(fila.getAttribute('title') || ''),
      fila && String(fila.getAttribute('title')).slice(-90));
  }
}
{
  // Control positivo del mismo mecanismo: el lunes siguiente vuelve a pedirse.
  // Sin esto, un `finDeSemana()` que devolviera siempre true pasaría las cuatro
  // comprobaciones de arriba.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-26T12:00:00Z');
    win.__respuestas = { 'arp-log': leer('dom-account-arp-log-completo-2026-08.html') };
  }); await tick(); await tick();
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('el miércoles vuelve a pedirlo, en amarillo y con cifra',
    d && d[1] === '0/5' && /--todo/.test(d[2]), d && d.join(' | '));
}
{
  // Y la mitad que de verdad importaba: si ALGÚN sábado llegara a pagar, la
  // línea lo enseña. El código no afirma que sea imposible, solo deja de pedirlo
  // cuando no ha pagado nada. El 21 es viernes y tiene Discord, así que se le
  // pone el reloj en sábado con el registro de ese viernes... no vale, porque
  // se filtra por fecha. Se fuerza con la caché, que es de donde sale la cifra.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    relojEnDia(win, '2026-08-22T12:00:00Z');
    win.localStorage.setItem('awa-arp-log', JSON.stringify({ discord: 5, at: Date.parse('2026-08-22T11:00:00Z') }));
  }); await tick(); await tick();
  const d = lines(w).find((l) => /Discord/.test(l[0]));
  check('un sábado que SÍ pagó se enseña igual', d && d[1] === '5/5 ✅' && /--done/.test(d[2]), d && d.join(' | '));
}

console.log('\n=== 42. La tarjeta de subasta no se etiqueta como una compra ===');
{
  // `dom-game-vault-auction-2026-08.html` trae la Bóveda con la subasta a ciegas
  // de Dinoblade (producto 1160) ya CERRADA, que resulta ser el único estado en el
  // que `data-product-in-stock` vale `false`: el atributo no sigue al stock, sigue
  // al final de la subasta (lo comprueba el bloque siguiente). Así que aquí el que
  // miente es el otro, `data-product-price="2400"`, cuando la entrada eran 100 y
  // las diez ganadoras fueron de 7.000 a 8.500.
  const w = mount('dom-game-vault-auction-2026-08.html', '/marketplace/game-vault'); await tick();
  const card = w.document.getElementById('marketplace-product-id-1160');
  const tag = card && card.querySelector('.awa-tag');
  check('la tarjeta de subasta existe en el volcado', !!card);
  check('lleva etiqueta', !!tag, card && card.className);
  check('cerrada, dice que la subasta terminó y NO «agotado»',
    tag && /termin|over|beendet|encerrad|结束|समाप्त/i.test(tag.textContent), tag && tag.textContent);
  check('y no dice «agotado»', tag && !/agotado|sold out/i.test(tag.textContent), tag && tag.textContent);
  // Control negativo del cruce: la tarjeta de al lado, que NO es subasta, sigue
  // pasando por el camino de siempre.
  const normal = w.document.getElementById('marketplace-product-id-1161');
  const tn = normal && normal.querySelector('.awa-tag');
  check('una tarjeta normal de la misma página sigue etiquetándose por precio',
    tn && /--ok|--short|--tier|--out/.test(tn.className) && !/--bid/.test(tn.className), tn && tn.className);
}
{
  // La subasta ABIERTA, por fin volcada de verdad: el Game Vault del 18/09 con
  // STALKER 2 (1181, entrada 300) y Cronos (1182, entrada 100) las dos en curso.
  //
  // Hasta aquí este caso se probaba SIMULÁNDOLO: se cogía el volcado de agosto,
  // que está cerrado, y se le ponía `data-auction-active` a true a mano. O sea que
  // el fixture era una suposición sobre el estado que faltaba, escrita desde el
  // estado contrario — y la suposición traía un error dentro: el volcado real dice
  // `data-product-in-stock="true"` en las dos, no el `false` que se daba por hecho.
  //
  // Eso cambia el control negativo, y a mejor. Mientras el atributo valía `false`,
  // que `tagCard` no llegara a ver la tarjeta se notaba porque no salía «agotado»;
  // ahora que vale `true`, un enrutado roto no diría «agotado», diría «te alcanza»
  // o «te faltan N» comparando el saldo contra un `data-product-price` que no es
  // lo que se paga. Así que se comprueban las DOS familias, la de stock y la de
  // precio: con una sola, el fallo que hoy es posible pasaría en verde.
  const w = mount('dom-marketplace-auction-active-2026-09-18.html', '/marketplace/game-vault'); await tick();
  const cards = Array.from(w.document.querySelectorAll(
    '.gamevault-marketplace-product[data-is-blind-auction="true"]'));
  check('el volcado trae las dos subastas en curso', cards.length === 2, String(cards.length));
  check('y las dos con el stock en true, que es lo que se daba por false',
    cards.every((c) => c.getAttribute('data-product-in-stock') === 'true'),
    cards.map((c) => c.getAttribute('data-product-in-stock')).join(' , '));
  const tags = cards.map((c) => c.querySelector('.awa-tag')).filter(Boolean)
    .map((x) => x.className + '::' + x.textContent);
  check('las dos se etiquetan', tags.length === 2, tags.join(' , '));
  check('abiertas, van en su propio tono', tags.every((x) => /--bid/.test(x)), tags.join(' , '));
  check('NINGUNA sale como terminada', !tags.some((x) => /--out/.test(x)), tags.join(' , '));
  check('y NINGUNA se etiqueta por precio, que es lo que haría tagCard',
    !tags.some((x) => /--ok|--short|--tier/.test(x)), tags.join(' , '));
  check('cada una enseña SU puja mínima', tags.some((x) => /300/.test(x)) && tags.some((x) => /100/.test(x)),
    tags.join(' , '));
  check('y ninguna enseña el precio de catálogo, que no es lo que se paga',
    !tags.some((x) => /6[.,]?400|6[.,]?500/.test(x)), tags.join(' , '));
  // Control POSITIVO del cruce: una tarjeta normal de la MISMA página sí pasa por
  // el camino de precio. Sin él, todo lo de arriba se cumpliría igual si no se
  // hubiera etiquetado nada en absoluto.
  const normal = Array.from(w.document.querySelectorAll('.gamevault-marketplace-product'))
    .find((c) => c.getAttribute('data-is-blind-auction') !== 'true' && c.querySelector('.awa-tag'));
  const tn = normal && normal.querySelector('.awa-tag');
  check('control positivo: una tarjeta normal de la misma página sí se etiqueta por precio',
    tn && /--ok|--short|--tier|--out/.test(tn.className) && !/--bid/.test(tn.className), tn && tn.className);
}

console.log('\n=== 43. La Tienda de Batalla: fichas que caducan ===');
{
  // El pase abierto trae 0/135 fichas: no alcanzan ni el paquete más barato.
  const w = mount('dom-battle-pass-2026-08.html', '/control-center/battle-pass/1'); await tick();
  const l = lines(w).find((x) => /[Tt]ienda|Store|Boutique|Loja|商店|स्टोर/.test(x[0]));
  check('sale la línea de la tienda', !!l, lines(w).map((x) => x[0]).join(' / '));
  check('con 0 fichas dice cuántas faltan para el primer paquete',
    l && /25/.test(l[1]), l && l.join(' | '));
  check('y no la da por buena', l && !/--done/.test(l[2]), l && l[2]);
}
{
  // La temporada cerrada trae 45/135: alcanzan el paquete de 200 ARP y NO el de
  // 500, así que sirve de control de que elige el mejor que alcanza y no el mayor.
  const w = mount('dom-battle-pass-closed-2026-08.html', '/control-center/battle-pass/1'); await tick();
  const l = lines(w).find((x) => /[Tt]ienda|Store|Boutique|Loja|商店|स्टोर/.test(x[0]));
  check('con 45 fichas ofrece el paquete de 200 ARP', l && /200/.test(l[1]), l && l.join(' | '));
  check('y NO el de 500, que no alcanza', l && !/500/.test(l[1]), l && l.join(' | '));
}
{
  // El control que de verdad importa: esta línea no puede entrar en el aviso de
  // fin de día. Las fichas caducan con la TEMPORADA, no hoy, así que ponerla en
  // amarillo sería avisar cada noche durante semanas. Se prueba con las tres
  // cantidades que cambian de rama.
  for (const [fichas, caso] of [[0, 'sin alcanzar nada'], [45, 'alcanzando 200'], [200, 'alcanzando 500']]) {
    const w = mount('dom-battle-pass-2026-08.html', '/control-center/battle-pass/1', (win) => {
      const n = win.document.querySelector('.bp-header__token-total');
      if (n) n.textContent = fichas + '/135';
    }); await tick();
    const l = lines(w).find((x) => /[Tt]ienda|Store|Boutique|Loja|商店|स्टोर/.test(x[0]));
    check('nunca sale en amarillo — ' + caso, l && !/--todo/.test(l[2]), l && l.join(' | '));
  }
}
{
  // Y con fichas de sobra, el mejor cambio de los tres.
  const w = mount('dom-battle-pass-2026-08.html', '/control-center/battle-pass/1', (win) => {
    const n = win.document.querySelector('.bp-header__token-total');
    if (n) n.textContent = '90/135';
  }); await tick();
  const l = lines(w).find((x) => /[Tt]ienda|Store|Boutique|Loja|商店|स्टोर/.test(x[0]));
  check('con 90 fichas ofrece el paquete de 500 ARP', l && /500/.test(l[1]), l && l.join(' | '));
}

console.log('\n=== 44. El panel sigue al idioma del sitio SIN esperar al reloj ===');
{
  // Reporte del usuario: cambiar el idioma en el selector de AWA «no siempre»
  // ajusta el panel. No era «no siempre»: era hasta MEDIO MINUTO. El sondeo de
  // 500 ms se apaga a los 30 s y a partir de ahí solo quedaba el reloj de 30 s.
  //
  // Aquí se prueba el camino que el sitio usa de verdad: la clase `wgcurrent`
  // moviéndose dentro del selector de Weglot. El volcado la trae en el <div> del
  // español, y `siteLang()` la lee en segundo lugar, después de la API.
  const w = mount('dom-control-center-2026-08.html', '/control-center'); await tick();
  const enEspanol = lines(w).some((l) => /Tiempo en el sitio/.test(l[0]));
  check('arranca en el idioma del selector (es)', enEspanol, lines(w).map((x) => x[0]).join(' / '));

  const actual = w.document.querySelector('.wgcurrent[data-l]');
  check('el volcado trae el selector de Weglot', !!actual, actual && actual.className);
  if (actual) {
    // Lo que hace Weglot: mueve la marca a otro idioma.
    actual.classList.remove('wgcurrent');
    const otro = w.document.createElement('div');
    otro.className = 'wg-li en wgcurrent';
    otro.setAttribute('data-l', 'en');
    actual.parentNode.appendChild(otro);
  }
  // Un solo turno de microtareas: lo que tarda un MutationObserver. NADA de
  // avanzar el reloj — el objetivo es justamente no depender de él.
  await Promise.resolve(); await Promise.resolve();
  const enIngles = lines(w).some((l) => /Time on site/.test(l[0]));
  check('cambiar el selector repinta el panel en el acto',
    enIngles, lines(w).map((x) => x[0]).join(' / '));
}
{
  // El otro aviso inmediato: el evento de la propia API de Weglot, que es la
  // fuente que manda en `siteLang()`. Se inyecta un doble porque jsdom no trae
  // Weglot, y se comprueba que el script SE SUSCRIBE y reacciona.
  let disparar = null;
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.Weglot = {
      _lang: 'es',
      getCurrentLang() { return this._lang; },
      on(evt, cb) { if (evt === 'languageChanged') disparar = cb; },
    };
  }); await tick();
  check('el script se suscribe a languageChanged de Weglot', typeof disparar === 'function');
  if (disparar) {
    w.Weglot._lang = 'de';
    disparar('de');
    await Promise.resolve();
    check('el evento de Weglot repinta el panel',
      lines(w).some((l) => /Zeit auf der Seite/.test(l[0])), lines(w).map((x) => x[0]).join(' / '));
  }
}
{
  // El control que define «automático»: con un idioma FIJADO en el panel, el
  // selector del sitio no manda. Sin esto, las dos pruebas de arriba pasarían
  // igual con un script que ignorase la preferencia del usuario.
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-lang', 'fr');
  }); await tick();
  check('con idioma fijado arranca en él, no en el del sitio',
    lines(w).some((l) => /Temps sur le site/.test(l[0])), lines(w).map((x) => x[0]).join(' / '));
  const actual = w.document.querySelector('.wgcurrent[data-l]');
  if (actual) {
    actual.classList.remove('wgcurrent');
    const otro = w.document.createElement('div');
    otro.className = 'wg-li en wgcurrent';
    otro.setAttribute('data-l', 'en');
    actual.parentNode.appendChild(otro);
  }
  await Promise.resolve(); await Promise.resolve();
  check('y cambiar el del sitio NO se lo lleva por delante',
    lines(w).some((l) => /Temps sur le site/.test(l[0])), lines(w).map((x) => x[0]).join(' / '));
}

console.log('\n=== 45. El panel en una página de quest de Steam ===');
{
  // `dom-steam-quest-choose-unstarted-2026-08.html` es el estado que llevaba
  // abierto desde el 21: tipo A, Steam conectado y SIN empezar, con `#userGames`.
  // Para el panel es una página cualquiera, y eso es justo lo que se comprueba:
  // que no confunda su contenido con el del Centro de control.
  //
  // El riesgo era real y concreto: `readDaily` cuenta quests diarias con
  // `.card-table-row` + `a.quest-title[data-quest-id]`, y una página de quest
  // podría traer filas parecidas. No las trae —cero de las dos—, pero sin una
  // prueba eso es una observación de hoy y no una garantía de mañana.
  const w = mount('dom-steam-quest-choose-unstarted-2026-08.html',
    '/steam/quests/choose-your-own-game-169'); await tick(); await tick();
  check('el panel se inyecta también aquí', !!w.document.getElementById('awa-arp-widget'));
  check('la página trae el selector de juego', !!w.document.getElementById('userGames'));
  check('y el botón de empezar', !!w.document.querySelector('.btn-start-quest'));
  // Sin contadores propios, tiene que salir a buscarlos.
  check('pide el Centro de control, que aquí no está en la página',
    w.fetched.some((u) => /control-center$/.test(u)), JSON.stringify(w.fetched));
  const L = lines(w);
  check('NO inventa una línea de quests diarias',
    !L.some((l) => /[Qq]uests diarias|Daily quests/.test(l[0])), L.map((x) => x[0]).join(' / '));
  // El calendario de campaña sí está en todas las páginas, así que esa línea sí sale.
  check('el calendario de campaña sí sale, que va en todas las páginas',
    L.some((l) => /[Cc]alendario|calendar/i.test(l[0])), L.map((x) => x[0]).join(' / '));
}
{
  // El segundo estado nuevo: juego FIJO, en propiedad y sin empezar. Ningún
  // volcado anterior lo tenía —los ocho que había eran «sin tener el juego»,
  // «en curso» o «completada»—, así que la tabla de estados de §7 se queda sin
  // ninguna fila por observar.
  const w = mount('dom-steam-quest-fixed-unstarted-2026-08.html',
    '/steam/quests/marvel-rivals-7'); await tick(); await tick();
  check('el fijo sin empezar trae botón de empezar y NO selector',
    !!w.document.querySelector('.btn-start-quest') && !w.document.getElementById('userGames'));
  check('el panel aguanta igual', !!w.document.getElementById('awa-arp-widget'));
}

console.log('\n=== 46. El consejo del mismo juego, en las tres superficies y en los ocho idiomas ===');
{
  // Un dato que vive en UNA sola de las tres superficies —tooltip, ficha «Saber más»
  // y README— es como acaba mintiendo un tooltip: pasó con el canal de Discord, que
  // estaba en el tooltip y en el README pero no en la ficha. Aquí se comprueba que el
  // consejo del §41.4 («si el juego de la quest fija sale en el selector de la que te
  // deja elegir, elígelo») está en las tres, y en los ocho idiomas, no solo en inglés.
  // `AWA_FUENTE` permite apuntar a una COPIA del script para el control negativo:
  // recortar el consejo de una copia y ver fallar estas comprobaciones, sin tocar el
  // fichero rastreado. La primera vez que se hizo a lo bruto —recortar el de verdad y
  // restaurarlo después— el comando se quedó a medias y dejó dos frases fuera durante
  // varios turnos, con un «310 en verde» de antes del recorte como única prueba.
  const RUTA = process.env.AWA_FUENTE
    || __dirname + '/../alienware-arena-arp-tracker.user.js';
  const fuente = fs.readFileSync(RUTA, 'utf8');
  const readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');

  // Un trozo distintivo de cada traducción. Se comprueba que cae en la LÍNEA de su
  // clave, no solo en el fichero: si alguien lo mueve de tipSteam a otra clave, esto
  // se entera. (En hindi el trozo del tooltip también aparece dentro del de la ficha,
  // así que la comprobación por línea es la única que distingue las dos.)
  const CONSEJO = {
    en: ['pick it: the same hour counts for both', 'picking it makes the same hour count for both'],
    es: ['elígelo: la misma hora cuenta para las dos', 'elegirlo hace que la misma hora cuente para las dos'],
    de: ['dieselbe Stunde zählt für beide', 'dann zählt dieselbe Stunde für beide'],
    fr: ['la même heure compte pour les deux', 'le choisir fait compter la même heure pour les deux'],
    pt: ['escolhe-o: a mesma hora conta para as duas', 'escolhê-lo faz a mesma hora contar para as duas'],
    br: ['escolha ele: a mesma hora conta para as duas', 'escolher ele faz a mesma hora contar para as duas'],
    zh: ['同一个小时对两个任务都算数', '选它就能让同一个小时对两个都算数'],
    hi: ['वही एक घंटा दोनों में गिना जाता है', 'उसे चुनने से वही एक घंटा दोनों में गिना जाता है'],
  };
  // La segunda mitad del consejo: el juego gratis que no tienes (§42.5). Va en las
  // mismas dos claves, así que se comprueba igual y por separado — si alguien recorta
  // el tooltip por largo, esto dice exactamente qué mitad se perdió y en qué idioma.
  const GRATIS = {
    en: ['add it to your Steam library and see whether it turns up', 'adding it to your Steam library may be enough'],
    es: ['añádelo a tu biblioteca de Steam y mira si aparece', 'añadirlo a tu biblioteca de Steam puede bastar'],
    de: ['füge es deiner Steam-Bibliothek hinzu und schau', 'es der Steam-Bibliothek hinzuzufügen'],
    fr: ['ajoute-le à ta bibliothèque Steam et regarde', 'l’ajouter à ta bibliothèque Steam peut suffire'],
    pt: ['adiciona-o à tua biblioteca Steam e vê se aparece', 'adicioná-lo à tua biblioteca Steam pode bastar'],
    br: ['adicione ele à sua biblioteca da Steam e veja se aparece', 'adicionar ele à sua biblioteca da Steam pode bastar'],
    zh: ['先把它加进 Steam 库', '把它加进 Steam 库可能就足以'],
    hi: ['अपनी Steam लाइब्रेरी में जोड़ें', 'Steam लाइब्रेरी में जोड़ना ही'],
  };
  const lineas = fuente.split('\n');
  const lineaDe = (clave, n) => lineas.filter((l) => l.trim().indexOf(clave + ':') === 0)[n] || '';
  const idiomas = Object.keys(CONSEJO);
  const sinTip = [];
  const sinFicha = [];
  idiomas.forEach((l, i) => {
    if (lineaDe('tipSteam', i).indexOf(CONSEJO[l][0]) < 0) sinTip.push(l);
    if (lineaDe('infoDescriptionText', i).indexOf(CONSEJO[l][1]) < 0) sinFicha.push(l);
  });
  check('está en el tooltip de Steam en los ocho', sinTip.length === 0, 'faltan: ' + sinTip.join(','));
  check('está en la ficha «Saber más» en los ocho', sinFicha.length === 0, 'faltan: ' + sinFicha.join(','));
  check('y en el README, en los dos idiomas',
    readme.indexOf('the same hour count for both') > 0 && readme.indexOf('la misma hora cuente para las dos') > 0);

  const sinTipG = [];
  const sinFichaG = [];
  idiomas.forEach((l, i) => {
    if (lineaDe('tipSteam', i).indexOf(GRATIS[l][0]) < 0) sinTipG.push(l);
    if (lineaDe('infoDescriptionText', i).indexOf(GRATIS[l][1]) < 0) sinFichaG.push(l);
  });
  check('el juego gratis está en el tooltip en los ocho', sinTipG.length === 0, 'faltan: ' + sinTipG.join(','));
  check('el juego gratis está en la ficha en los ocho', sinFichaG.length === 0, 'faltan: ' + sinFichaG.join(','));
  check('y en el README, en los dos idiomas',
    readme.indexOf('adding it to your Steam library may be enough') > 0 &&
    readme.indexOf('añadirlo a tu biblioteca de Steam puede bastar') > 0);

  // Control negativo del propio lector: si `lineaDe` no estuviera leyendo la línea de
  // la clave, las comprobaciones de arriba pasarían por casualidad al buscar en cadena
  // vacía... no, fallarían; lo que sí pasaría desapercibido es que leyera SIEMPRE la
  // misma línea. Por eso se comprueba que las ocho líneas de tipSteam son distintas.
  const ocho = idiomas.map((l, i) => lineaDe('tipSteam', i));
  check('el lector coge ocho líneas distintas, no ocho veces la misma',
    new Set(ocho).size === 8 && ocho.every((x) => x.length > 0), String(new Set(ocho).size));
}

console.log('\n=== 47. El @icon va incrustado, no apuntando a un favicon ajeno ===');
{
  // El 2026-08-31 OpenUserJS respondió 500 al sincronizar 1.1.1:
  //   «`@icon` unsupported file type: undefined (file: undefined)»
  // con `@icon https://www.alienwarearena.com/favicon.ico`. La causa exacta nunca se
  // determinó —hay scripts publicados allí con un `.ico` remoto que sí funcionan, y el
  // fichero de AWA es casi idéntico al de Amazon: mismo magic, 3 iconos, 32 bpp, ~15 KB—.
  // Así que se eligió la opción que no depende de conocer la causa: un data: URI, que no
  // se descarga, no se olfatea y declara su tipo. Precedente vivo: openuserjs.org/scripts/
  // Juampi_Mix/EmuParadise_1up. Esta comprobación existe para que nadie lo revierta a una
  // URL remota sin saber que eso ya rompió una publicación.
  // Misma parametrización que §46, para poder hacer el control negativo sobre una copia.
  const fuenteIcono = fs.readFileSync(process.env.AWA_FUENTE
    || __dirname + '/../alienware-arena-arp-tracker.user.js', 'utf8');
  const cab = fuenteIcono.slice(0, fuenteIcono.indexOf('==/UserScript=='));
  const icon = (cab.match(/@icon\s+(\S+)/) || [])[1] || '';
  check('hay @icon', !!icon);
  check('es un data: URI de PNG, no una URL remota',
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon),
    icon.slice(0, 60));
  const crudo = Buffer.from(icon.replace(/^data:image\/png;base64,/, ''), 'base64');
  check('y decodifica a un PNG de verdad',
    crudo.length > 500 && crudo[0] === 0x89 && crudo[1] === 0x50 && crudo[2] === 0x4e && crudo[3] === 0x47,
    crudo.length + ' bytes, magic ' + [...crudo.slice(0, 4)].map((b) => b.toString(16)).join(' '));
}

console.log('\n=== 48. Una subasta que AUN NO ABRE no se rotula como terminada ===');
{
  // El caso que hasta 1.1.2 salia mal. El volcado tiene el Game Vault cerrado hasta
  // el 18/09 con dos subastas en `active="false"` + `ended="false"`, que es el tercer
  // estado que el codigo viejo no distinguia: leia solo `active` y las daba por
  // terminadas. La fecha del volcado esta congelada, asi que la cuenta atras se mide
  // contra un "ahora" fijo ANTERIOR a la apertura; sin eso, la prueba empezaria a
  // fallar sola el 18 de septiembre y por el motivo equivocado.
  const ANTES = Date.parse('2026-09-01T22:00:00Z');
  const w = mount('dom-marketplace-auction-unstarted-2026-09-01.html', '/marketplace/game-vault',
    (win) => { const D = win.Date; win.Date = class extends D {
      constructor(...a) { return a.length ? new D(...a) : new D(ANTES); }
      static now() { return ANTES; } }; });
  await tick();
  // Solo las tarjetas de SUBASTA. Filtrar por clase de etiqueta no sirve: las 16
  // tarjetas normales de la boveda estan agotadas y salen `--out` con toda la razon,
  // asi que se colaban en el recuento y hacian fallar la prueba con el codigo bueno.
  const SUB = '.gamevault-marketplace-product[data-is-blind-auction="true"] .awa-tag';
  const subastas = Array.from(w.document.querySelectorAll(SUB)).map((x) => x.className + '::' + x.textContent);

  check('las dos subastas se etiquetan', subastas.length === 2, subastas.join(' , '));
  check('NINGUNA sale como terminada', !subastas.some((x) => /--out/.test(x)), subastas.join(' , '));
  check('salen con el tono de "aun no abre"', subastas.every((x) => /--soon/.test(x)), subastas.join(' , '));
  // La cuenta atras NO se repite en la tarjeta: la dice el aviso general de arriba,
  // porque la fecha es una para toda la seccion. Repetirla aqui la ponia tres veces
  // en la misma pantalla.
  check('la tarjeta NO repite la cuenta atras', !subastas.some((x) => /16d 20h/.test(x)), subastas.join(' , '));
  check('ni la repite el aviso general: eso ya lo pinta el sitio',
    !/16d 20h/.test((w.document.querySelector('.awa-vault__when') || {}).textContent || ''),
    (w.document.querySelector('.awa-vault__when') || {}).textContent);
  check('y el contador del propio sitio sigue intacto',
    /16 days 19 hours/.test(w.document.querySelector('#game-vault-timer').textContent));
  // Lo que si es de la tarjeta: la puja minima, que ya se conoce antes de abrir.
  check('la tarjeta lleva su puja minima', subastas.some((x) => /300/.test(x)) && subastas.some((x) => /100/.test(x)),
    subastas.join(' , '));

  const tip = (w.document.querySelector('.awa-tag--soon') || {}).getAttribute
    ? w.document.querySelector('.awa-tag--soon').getAttribute('title') : '';
  check('el tooltip lleva la fecha en hora local', /2026/.test(tip) && /18/.test(tip), tip.slice(0, 90));

  // Control negativo: el MISMO codigo, sobre el volcado de agosto, tiene que seguir
  // diciendo «terminada». Si esta pasara igual que la de arriba, la rama nueva se
  // habria comido la vieja y la prueba no mediria nada.
  const v = mount('dom-game-vault-auction-2026-08.html', '/marketplace/game-vault'); await tick();
  const viejas = Array.from(v.document.querySelectorAll(SUB)).map((x) => x.className + '::' + x.textContent);
  check('control negativo: la subasta de agosto SIGUE saliendo terminada',
    viejas.some((x) => /--out/.test(x)) && !viejas.some((x) => /--soon/.test(x)), viejas.join(' , '));
}

console.log('\n=== 49. La Boveda cerrada: cuenta atras general y campana que alterna ===');
{
  const ANTES = Date.parse('2026-09-01T22:00:00Z');
  const congelar = (win) => { const D = win.Date; win.Date = class extends D {
    constructor(...a) { return a.length ? new D(...a) : new D(ANTES); }
    static now() { return ANTES; } }; };
  const w = mount('dom-marketplace-auction-unstarted-2026-09-01.html', '/marketplace/game-vault', congelar);
  await tick();

  const aviso = w.document.querySelector('.awa-vault');
  check('sale UN aviso general, no uno por tarjeta',
    !!aviso && w.document.querySelectorAll('.awa-vault').length === 1,
    'salieron ' + w.document.querySelectorAll('.awa-vault').length);
  // DETRAS del banner y no dentro: dentro quedaba invisible (es la caja de la
  // imagen, con overlay encima). Se vio en el navegador, no en la prueba.
  check('cuelga DETRAS del banner, como hermano',
    !!(aviso && aviso.previousElementSibling
       && /gv-section-banner/.test(aviso.previousElementSibling.className)),
    aviso && aviso.previousElementSibling && aviso.previousElementSibling.className);
  check('NO va dentro del banner (ahi no se veia)', !(aviso && aviso.closest('.gv-section-banner')));
  const cuando = aviso && aviso.querySelector('.awa-vault__when').textContent;
  check('dice la fecha en el reloj del usuario', /2026/.test(cuando || '') && /18/.test(cuando || ''), cuando);
  check('y NO repite la cuenta atras del sitio', !/16d/.test(cuando || ''), cuando);

  // La campana: arma, alterna y desarma. Es lo unico del script que ARMA algo.
  const bell = aviso && aviso.querySelector('.awa-vault__bell');
  check('la campana empieza SIN armar', !!bell && !/awa-vault__bell--on/.test(bell.className), bell && bell.className);
  bell.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('al pulsarla queda armada', /awa-vault__bell--on/.test(bell.className), bell.className);
  check('y guarda la hora de apertura, no un booleano',
    w.localStorage.getItem('awa-arp-vault-aviso') === String(Date.parse('2026-09-18T18:00:00Z')),
    w.localStorage.getItem('awa-arp-vault-aviso'));
  const armado = bell.textContent;
  bell.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('el MISMO boton la desarma', !/awa-vault__bell--on/.test(bell.className)
    && bell.textContent !== armado && !w.localStorage.getItem('awa-arp-vault-aviso'),
    bell.className + ' | ' + bell.textContent);
}

console.log('\n=== 50. Con la boveda ya abierta, el aviso salta en CUALQUIER pagina ===');
{
  // El punto de la campana: el aviso no vive en la Boveda, vive en el reloj del
  // panel, que corre en todas las paginas. Se arma y se comprueba desde OTRA.
  const DESPUES = Date.parse('2026-09-18T18:00:30Z');
  const w = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.setItem('awa-arp-vault-aviso', String(Date.parse('2026-09-18T18:00:00Z')));
    // La casilla general APAGADA a proposito: la campana es su propio permiso.
    win.localStorage.removeItem('awa-arp-alert');
    const D = win.Date; win.Date = class extends D {
      constructor(...a) { return a.length ? new D(...a) : new D(DESPUES); }
      static now() { return DESPUES; } };
  });
  await tick();
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  check('la banda del aviso sale fuera de la Boveda', !!banda, banda && banda.textContent);
  check('y con la casilla general apagada', !w.localStorage.getItem('awa-arp-alert'));
  check('marca la pestana con el 👽', /👽/.test(w.document.title), w.document.title);

  // La fila del aviso LLEVA a la boveda, que es el sitio donde se puja. Es el
  // unico de los cuatro avisos con un destino, y por eso el unico con flecha.
  const filaGo = w.document.querySelector('#awa-arp-widget .awa-w__alert-go');
  check('el aviso de la boveda lleva a la boveda', !!filaGo, banda.textContent);
  check('y lo dice con la flecha del resto del panel',
    !!(filaGo && /↗/.test(filaGo.textContent)), filaGo && filaGo.textContent);
  // Un <a href> DE VERDAD, no un div con listener: es lo que hace que funcionen el
  // clic central, «abrir en pestaña nueva» y «copiar dirección».
  check('es un <a> y no un div', !!filaGo && filaGo.tagName === 'A', filaGo && filaGo.tagName);
  check('con el href de la boveda',
    !!filaGo && filaGo.getAttribute('href') === '/marketplace/game-vault',
    filaGo && filaGo.getAttribute('href'));

  // Pulsar LA FILA hace las dos cosas: la descarta y ademas navega. Lo que se
  // comprueba aqui es el descarte —que la campana queda desarmada y la banda se
  // va—; la navegacion en si no la puede asegurar el arnes, porque jsdom no navega.
  filaGo.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('pulsar la fila descarta el aviso', !w.localStorage.getItem('awa-arp-vault-aviso'),
    w.localStorage.getItem('awa-arp-vault-aviso'));
  check('y quita el 👽 al descartarlo desde la fila', !/👽/.test(w.document.title), w.document.title);

  // Darlo por visto DESARMA la campana: el instante ya pasó, no hay nada que vigilar.
  banda.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('darlo por visto desarma la campana',
    !w.localStorage.getItem('awa-arp-vault-aviso'), w.localStorage.getItem('awa-arp-vault-aviso'));
  check('y quita el 👽 del titulo', !/👽/.test(w.document.title), w.document.title);

  // Y ESTANDO YA en la boveda la flecha no sale: `irA` devuelve null cuando ya
  // estas ahi, y prometer un salto que no mueve nada es justo lo que ese helper
  // existe para evitar. La banda si sigue saliendo — el aviso no deja de ser cierto.
  const enBoveda = mount('dom-marketplace-auction-unstarted-2026-09-01.html', '/marketplace/game-vault',
    (win) => {
      win.localStorage.setItem('awa-arp-vault-aviso', String(Date.parse('2026-09-18T18:00:00Z')));
      const D = win.Date; win.Date = class extends D {
        constructor(...a) { return a.length ? new D(...a) : new D(DESPUES); }
        static now() { return DESPUES; } };
    });
  await tick();
  check('en la propia boveda sigue saliendo la banda',
    !!enBoveda.document.querySelector('#awa-arp-widget .awa-w__alert'));
  check('pero SIN flecha: ya estas ahi',
    !enBoveda.document.querySelector('#awa-arp-widget .awa-w__alert-go'));

  // Control negativo: sin armar, esa misma pagina y esa misma hora NO avisan.
  const v = mount('dom-control-center-2026-08.html', '/control-center', (win) => {
    win.localStorage.removeItem('awa-arp-vault-aviso');
    win.localStorage.removeItem('awa-arp-alert');
    const D = win.Date; win.Date = class extends D {
      constructor(...a) { return a.length ? new D(...a) : new D(DESPUES); }
      static now() { return DESPUES; } };
  });
  await tick();
  check('control negativo: sin armar no hay aviso',
    !v.document.querySelector('#awa-arp-widget .awa-w__alert'));
}

console.log('\n=== 51. El aviso se retira cuando la boveda abre ===');
{
  const enTiempo = (iso) => (win) => { const D = win.Date; const T = Date.parse(iso);
    win.Date = class extends D {
      constructor(...a) { return a.length ? new D(...a) : new D(T); }
      static now() { return T; } }; };
  const c = mount('dom-marketplace-auction-unstarted-2026-09-01.html', '/marketplace/game-vault',
    enTiempo('2026-09-18T18:00:30Z')); await tick();
  check('pasada la hora de apertura no se pinta', !c.document.querySelector('.awa-vault'));
  check('y el contador del propio sitio no se toca',
    /16 days 19 hours/.test(c.document.querySelector('#game-vault-timer').textContent));
  // La fecha se calcula del dato, no se copia del texto: el volcado dice «16 days
  // 19 hours» y el aviso dice el 18 de septiembre.
  const a = mount('dom-marketplace-auction-unstarted-2026-09-01.html', '/marketplace/game-vault',
    enTiempo('2026-09-01T22:00:00Z')); await tick();
  const txt = (a.document.querySelector('.awa-vault__when') || {}).textContent || '';
  check('la fecha sale de data-unlock-date, no del texto del sitio',
    /18/.test(txt) && /2026/.test(txt) && !/19 hours/.test(txt), txt);
}


// El mismo reloj congelable de §51, aqui arriba porque estas pruebas lo necesitan
// en varios bloques. Congelar la fecha NO es un adorno: el evento del volcado va
// del 10 al 18 de septiembre de 2026, asi que sin congelarla estas pruebas
// pasarian hoy y empezarian a fallar solas el dia 19 —y el fallo se leeria como un
// bug del script—.
const enFecha = (iso) => (win) => {
  const D = win.Date; const T = Date.parse(iso);
  win.Date = class extends D {
    constructor(...a) { return a.length ? new D(...a) : new D(T); }
    static now() { return T; } };
};
const leerDoc = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

console.log('\n=== 52. La pagina del evento: los tres estados ===');
// Estando en la pagina del evento el estado sale del documento, pero el INDICE
// se pide igual: es lo unico que sabe si ese evento sigue vivo (ver el bloque del
// evento terminado, al final). Lo que no se pide es la pagina del evento, que es
// justo en la que estas.
const RUTA_EVENTO = '/steam/community-event/idle-champions-of-the-forgotten-realms-community-event';
const enElEvento = (dump, iso) => mount(dump,
  RUTA_EVENTO,
  (win) => {
    enFecha(iso || '2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html') };
  });
const titulos = (w) => Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__line'))
  .map((l) => l.getAttribute('title') || '').join(' ');
{
  // Sin poseer el juego. El sitio pinta el sincronizador y NO el boton de unirse.
  const w = enElEvento('dom-steam-community-event-live-unowned-2026-09-09.html');
  await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('sale la linea del evento', !!e, lines(w).map((x) => x[0]).join(' / '));
  check('dice que falta el juego', e && /falta el juego|game missing/.test(e[1]), e && e.join(' | '));
  check('en ambar, que hay algo que hacer', e && /--todo/.test(e[2]), e && e[2]);
  // El hallazgo del 2026-09-10 entregado donde hace falta: si el juego es F2P, el
  // sitio no lo ve hasta que lo abres.
  check('el aviso explica lo del Free to Play', /Free to Play/.test(titulos(w)), '');
  // La pagina del evento NO se pide: es la que estas viendo.
  check('no se vuelve a pedir la pagina del evento',
    !w.fetched.some((u) => /community-event/.test(u)), JSON.stringify(w.fetched));
}
{
  // Con el juego y SIN unirse. Es el caso que costo el tiempo de la primera noche.
  const w = enElEvento('dom-steam-community-event-live-owned-unjoined-2026-09-10.html');
  await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('avisa de que no te has unido', e && /sin unirte|not joined/.test(e[1]), e && e.join(' | '));
  check('y va en ambar', e && /--todo/.test(e[2]), e && e[2]);
  check('el aviso dice que el tiempo de antes NO cuenta',
    /antes de unirte se tira|thrown away/.test(titulos(w)), '');
}
{
  // Ya dentro. El panel pasa a contar minutos hacia el siguiente hito.
  const w = enElEvento('dom-steam-community-event-live-joined-2026-09-10.html');
  await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('unido: cuenta minutos hacia el primer hito', e && /^0\/60 min$/.test(e[1]), e && e.join(' | '));
  // En MINUTOS y no en horas a proposito: el sitio pinta floor(min/60), asi que
  // por debajo de una hora enseña 0 y no se distingue de no haber jugado.
  check('y NO en horas, que es lo que oculta el progreso', e && !/\bh\b/.test(e[1]), e && e[1]);
  check('sin ambar: el evento no vence hoy', e && !/--todo/.test(e[2]), e && e[2]);
}
{
  // El mismo estado con el primer hito ya desbloqueado POR LA COMUNIDAD. Lo que
  // el panel enseña no cambia —la meta personal sigue sin cumplirse— y eso es
  // justo lo que hay que comprobar: que no lee el candado de la comunidad como si
  // fuera el tuyo.
  const w = enElEvento('dom-steam-community-event-live-joined-milestone-1-2026-09-10.html');
  await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('el hito de la comunidad no se confunde con el tuyo',
    e && /^0\/60 min$/.test(e[1]), e && e.join(' | '));
}
{
  // Y el caso que obliga a pedir el indice aunque estes en la pagina: un evento ya TERMINADO.
  //
  // La FORMA de esa pagina sale de un volcado real de uno cerrado —«Old School Runescape»,
  // 7-21 de agosto—, que no se commitea porque pesa 1,5 MB y lleva 838 reseñas de otras
  // personas. Lo que enseño: **no hay ninguna marca de «terminado»**. Ni `event-ended` ni nada
  // equivalente. Lo que pasa es que DESAPARECE TODO: los tres botones del discriminador y el
  // <span class="event-live">. Aqui se reproduce esa forma sobre un volcado vivo, que si esta
  // en el repo.
  //
  // Ojo con el /g de los dos replace: la cabecera que escribe `sanear-volcado.js` CITA el
  // marcado en su nota, asi que la primera coincidencia de cualquier selector suele estar en el
  // comentario y no en el elemento. Sin el /g, esto cambiaba el comentario y dejaba la pagina
  // intacta — y la prueba habria medido el volcado sin tocar. Van con /g y con un control que
  // comprueba que el recorte de verdad ocurrio.
  const cerrado = leerDoc('dom-steam-community-event-live-owned-unjoined-2026-09-10.html')
    .replace(/<a href="#" class="btn btn-lg enter-event-btn[\s\S]*?<\/a>/g, '')
    .replace(/<span class="event-live">[\s\S]*?<\/span>/g, '');
  check('el fixture reproduce la forma de uno cerrado: sin boton y sin «EN VIVO»',
    !/class="btn btn-lg enter-event-btn/.test(cerrado) && !/class="event-live"/.test(cerrado), '');
  const w = mount('dom-homepage-src-2026-08.html', RUTA_EVENTO, (win) => {
    enFecha('2026-09-19T00:30:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': cerrado };
  });
  await tick(); await tick();
  check('en la pagina de un evento terminado no se pinta nada',
    !lines(w).find((l) => /Evento|Event/.test(l[0])), lines(w).map((x) => x[0]).join(' / '));
  check('y el indice si se pidio, o sea que la prueba mide la comprobacion',
    w.fetched.some((u) => /\/steam\/events$/.test(u)), JSON.stringify(w.fetched));
}

{
  // El acumulado NO se reinicia al pasar de hito: los umbrales son totales
  // (60/120/180/240/300 min) y el sitio los mide todos contra el MISMO
  // `personalPlaytime`. Con 90 minutos, el siguiente hito es el de 120 y la fila
  // dice 90/120 —no 30/60—, que es la pregunta que esto contesta.
  // Ojo al fabricar el caso: `personalPlaytime = 0` aparece DOS veces en el
  // volcado, y la primera esta en la nota de la cabecera que escribio el
  // saneador. Sin el `let` delante, el replace cambia el comentario y deja el
  // codigo intacto — y la prueba mide entonces el volcado sin tocar.
  const conNoventa = leerDoc('dom-steam-community-event-live-joined-milestone-1-2026-09-10.html')
    .replace(/let personalPlaytime = 0/, 'let personalPlaytime = 90')
    .replace(/<i class="fas fa-lock"\s+id="milestone-554-personal-status"/,
             '<i class="fas fa-square-check text-success" id="milestone-554-personal-status"');
  fs.writeFileSync(path.join(DOCS, '.tmp-90min.html'), conNoventa);
  const w = mount('.tmp-90min.html', RUTA_EVENTO, (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html') };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('con el primer hito hecho, apunta al SIGUIENTE umbral acumulado',
    e && /^90\/120 min$/.test(e[1]), e && e.join(' | '));
  fs.unlinkSync(path.join(DOCS, '.tmp-90min.html'));
}
{
  // Los iconos de estado personal son IRRELEVANTES para el panel desde el arreglo
  // del 2026-09-11: se derivan de los minutos, como hace el propio sitio. Taparlos
  // no debe cambiar nada. Antes esta prueba comprobaba el caso contrario —que sin
  // iconos no se diera el evento por terminado—, y se quedo sin sentido con el
  // arreglo, asi que ahora comprueba la propiedad que lo sustituye.
  const sinIconos = leerDoc('dom-steam-community-event-live-joined-2026-09-10.html')
    .replace(/id="milestone-\d+-personal-status"/g, 'id="tapado"');
  fs.writeFileSync(path.join(DOCS, '.tmp-sin-iconos.html'), sinIconos);
  const w = mount('.tmp-sin-iconos.html', RUTA_EVENTO, (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html') };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('sin iconos de estado NO se da por terminado',
    e && !/todos los hitos|all milestones/.test(e[1]), e && e.join(' | '));
  // Y sigue diciendo exactamente lo mismo que con ellos: 0 minutos, primer hito de
  // 60. El icono ya no participa en la cuenta.
  check('taparlos no cambia nada, porque ya no se leen',
    e && /^0\/60 min$/.test(e[1]), e && e.join(' | '));
  fs.unlinkSync(path.join(DOCS, '.tmp-sin-iconos.html'));
}

console.log('\n=== 53. El indice decide por FECHAS, no por el encabezado ===');
{
  const respuestas = (win) => {
    win.__respuestas = {
      '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': leerDoc('dom-steam-community-event-live-owned-unjoined-2026-09-10.html'),
    };
  };
  // Dentro de la ventana del evento (10-18 de septiembre).
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win); respuestas(win);
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('con el evento vivo, sale la linea', !!e, lines(w).map((x) => x[0]).join(' / '));
  check('leyendo el estado de la pagina del evento',
    e && /sin unirte|not joined/.test(e[1]), e && e.join(' | '));
  check('pide el indice y luego el evento, uno de cada',
    w.fetched.filter((u) => /\/steam\/events$/.test(u)).length === 1
      && w.fetched.filter((u) => /community-event/.test(u)).length === 1, JSON.stringify(w.fetched));
  const relojes = Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__clock'))
    .map((n) => n.textContent);
  check('y un tercer reloj con lo que queda de evento',
    relojes.some((r) => /Evento|Event/.test(r)), relojes.join(' / '));
}
{
  // Pasado el evento. El ultimo dia va incluido entero, asi que el 18 sigue vivo y
  // el 19 ya no: se comprueban los dos lados del limite, que es donde un
  // «off by one» se esconde.
  const dia18 = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-18T23:30:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': leerDoc('dom-steam-community-event-live-joined-2026-09-10.html') };
  }); await tick(); await tick();
  check('el ultimo dia del evento sigue contando',
    !!lines(dia18).find((l) => /Evento|Event/.test(l[0])), lines(dia18).map((x) => x[0]).join(' / '));

  const dia19 = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-19T00:30:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': leerDoc('dom-steam-community-event-live-joined-2026-09-10.html') };
  }); await tick(); await tick();
  check('terminado el evento, no hay linea',
    !lines(dia19).find((l) => /Evento|Event/.test(l[0])), lines(dia19).map((x) => x[0]).join(' / '));
  check('y no se pide la pagina del evento para nada',
    !dia19.fetched.some((u) => /community-event/.test(u)), JSON.stringify(dia19.fetched));
}
{
  // Control negativo del parseo: el indice SIN <noscript> no debe dar ningun
  // evento vivo. Sin esto, «no sale la linea» podria estar pasando por el motivo
  // equivocado —que el fetch fallara— y las dos pruebas de arriba se leerian igual.
  const sinNoscript = leerDoc('dom-steam-events-index-2026-09-10.html')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': sinNoscript };
  }); await tick(); await tick();
  check('sin <noscript> no se inventa ningun evento',
    !lines(w).find((l) => /Evento|Event/.test(l[0])), lines(w).map((x) => x[0]).join(' / '));
  check('y el indice si se llego a pedir, o sea que la prueba mide el parseo',
    w.fetched.some((u) => /\/steam\/events$/.test(u)), JSON.stringify(w.fetched));
}

console.log('\n=== 55. El icono personal lo pinta el JS del sitio, no el servidor ===');
// El fallo real del 2026-09-11: con una hora jugada el panel decia «60/120 min» en la pagina del
// evento y «60/60 min» en el Centro de control. La causa es que el servidor manda los cinco
// iconos personales con `fa-lock` SIEMPRE y los pone en verde el JS de la propia pagina, que en
// una copia de DOMParser no corre nunca.
//
// Ojo al fabricar el caso, porque aqui esta la leccion de fondo: un volcado es el DOM YA
// RENDERIZADO, con el JS del sitio ejecutado, pero `pedir()` recibe el HTML DEL SERVIDOR. Para
// probar el camino del fetch hay que DESHACER lo que el JS hizo —devolver los iconos personales a
// `fa-lock`—, o el fixture esconde justo el fallo que se busca.
const comoLoMandaElServidor = (f) => leerDoc(f)
  .replace(/class="fas fa-square-check text-success"(\s+id="milestone-\d+-personal-status")/g,
           'class="fas fa-lock"$1');
{
  const servidor = comoLoMandaElServidor('dom-steam-community-event-live-joined-awarded-2026-09-11.html');
  // Control del propio fixture: si el replace no hubiera hecho nada, la prueba pasaria por el
  // motivo equivocado y no mediria nada.
  check('el fixture simula de verdad el HTML del servidor',
    !/fa-square-check[^>]*id="milestone-\d+-personal-status"/.test(servidor)
      && /let personalPlaytime = 60/.test(servidor), '');

  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = {
      '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': servidor,
    };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('fuera del evento, con 60 min, apunta al hito de 120',
    e && /^60\/120 min$/.test(e[1]), e && e.join(' | '));
  check('y NO a 60/60, que es lo que salia leyendo el icono',
    e && !/^60\/60 min$/.test(e[1]), e && e.join(' | '));
}
{
  // Y en la propia pagina del evento, donde el JS del sitio SI corrio, el resultado tiene que
  // ser el mismo. Antes coincidia por casualidad; ahora coincide porque no se lee el icono.
  const w = enElEvento('dom-steam-community-event-live-joined-awarded-2026-09-11.html');
  await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('en la pagina del evento sale lo mismo', e && /^60\/120 min$/.test(e[1]), e && e.join(' | '));
}
{
  // `aria-valuenow` vale 0 SIEMPRE, incluso con 60 minutos acreditados: era la antigua reserva
  // de lectura y devolvia una cifra falsa. Sin el literal del script, ahora no se inventa nada.
  const sinLiteral = leerDoc('dom-steam-community-event-live-joined-awarded-2026-09-11.html')
    .replace(/let personalPlaytime = 60/, 'let otraCosa = 60');
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': sinLiteral };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('sin los minutos no se inventa un 0 con el aria',
    e && !/^0\//.test(e[1]) && /en marcha|under way/.test(e[1]), e && e.join(' | '));
}

{
  // Un hito se cobra con las DOS condiciones. Si cumples tus cinco horas pero la
  // comunidad no ha llegado a las suyas, el evento NO esta terminado y el panel no
  // puede decir que si: serian premios que aun no has ganado.
  const cincoHoras = leerDoc('dom-steam-community-event-live-joined-awarded-2026-09-11.html')
    .replace(/let personalPlaytime = 60/, 'let personalPlaytime = 300');
  check('el fixture pone las cinco horas', /let personalPlaytime = 300/.test(cincoHoras), '');
  // En ese volcado la comunidad solo ha desbloqueado los hitos 1 y 2: del 3 al 5
  // siguen con fa-lock, que es justo el caso.
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': cincoHoras };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('con tus horas hechas pero la comunidad corta, NO se da por terminado',
    e && !/todos los hitos|all milestones/.test(e[1]), e && e.join(' | '));
  check('lo dice como «en marcha»', e && /en marcha|under way/.test(e[1]), e && e.join(' | '));
}

console.log('\n=== 54. El evento NO entra en el aviso de fin de dia ===');
{
  // Sale en ambar porque hay algo que hacer, pero dura ocho dias: meterlo en el
  // aviso nocturno seria repetirlo cada noche por algo que no vence hoy. Es el
  // mismo trato que ya tenia `qSteam`.
  const w = mount('dom-steam-community-event-live-owned-unjoined-2026-09-10.html',
    '/steam/community-event/idle-champions-of-the-forgotten-realms-community-event',
    (win) => {
      enFecha('2026-09-12T23:45:00Z')(win);
      win.localStorage.setItem('awa-arp-alert', '1');
      win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html') };
    });
  await tick(); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('la fila sigue en ambar', e && /--todo/.test(e[2]), e && e[2]);
  const banda = w.document.querySelector('#awa-arp-widget .awa-w__alert');
  check('pero el aviso de fin de dia no lo nombra',
    !banda || !/Evento comunitario|Community event/.test(banda.textContent),
    banda && banda.textContent);
}

console.log('\n=== 56. Lo del evento, en las tres superficies y en los ocho idiomas ===');
{
  // Norma acordada el 2026-09-11: si algo no cabe en la @description —499 de 500 antes de esto—
  // NO se recorta lo que ya hay. Lo nuevo se cuenta en los comentarios del script, en la ficha
  // «Saber más» y en el README. Esta prueba es lo que hace que esa norma no sea una intencion:
  // el dato que se quedo fuera de la descripcion tiene que estar de verdad en las otras
  // superficies, y en los ocho idiomas, no solo en ingles.
  const RUTA56 = process.env.AWA_FUENTE || __dirname + '/../alienware-arena-arp-tracker.user.js';
  const fuente = fs.readFileSync(RUTA56, 'utf8');
  const readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');
  const lineas = fuente.split('\n');
  // Ojo: el buscador de §46 exige que la clave ABRA la linea, y funciona alli porque esas claves
  // van solas. Las del evento van agrupadas varias por linea, como el resto del bloque, asi que
  // aqui se ancla con regex al principio de linea o tras una coma. Sin eso, `lineaDe` devolvia
  // cadena vacia para todos los idiomas y las comprobaciones fallaban sin que faltara nada — por
  // eso hay abajo un control de que la linea no esta vacia.
  const lineaDe = (clave, n) => {
    const re = new RegExp('(^|[,{]\\s*)' + clave + ':\\s');
    return lineas.filter((l) => re.test(l.trim()))[n] || '';
  };
  // El hecho que mas caro sale ignorar: sin unirse, lo jugado no cuenta.
  const TIRA = {
    en: ['thrown away', 'thrown away'],
    es: ['antes de unirte se tira', 'antes de unirte se tira'],
    de: ['von vor dem Beitritt wird verworfen', 'von vorher wird verworfen'],
    fr: ['avant de rejoindre est perdu', 'avant est perdu'],
    pt: ['antes de participares é deitado fora', 'antes é deitado fora'],
    br: ['antes de entrar é descartado', 'antes é descartado'],
    zh: ['加入之前的游戏时长会被丢弃', '加入之前的游戏时长会被丢弃'],
    hi: ['बेकार चला जाता है', 'बेकार चला जाता है'],
  };
  const idiomas = Object.keys(TIRA);
  const sinTip = [], sinFicha = [];
  idiomas.forEach((l, i) => {
    if (lineaDe('tipEvJoin', i).indexOf(TIRA[l][0]) < 0) sinTip.push(l);
    if (lineaDe('mEvento', i).indexOf(TIRA[l][1]) < 0) sinFicha.push(l);
  });
  check('está en el tooltip del evento en los ocho', sinTip.length === 0, 'faltan: ' + sinTip.join(','));
  check('está en la ficha «Saber más» en los ocho', sinFicha.length === 0, 'faltan: ' + sinFicha.join(','));
  check('y en el README, en los dos idiomas',
    readme.indexOf('thrown away') > 0 && readme.indexOf('antes de unirte se tira') > 0);
  // Y lo del Free to Play, que es el otro hallazgo que no cabia en la descripcion.
  const F2P = { en: 'Free to Play', es: 'Free to Play', de: 'Free-to-Play', fr: 'Free to Play',
    pt: 'Free to Play', br: 'Free to Play', zh: '免费游戏', hi: 'Free to Play' };
  const sinF2P = [];
  idiomas.forEach((l, i) => { if (lineaDe('tipEvOwn', i).indexOf(F2P[l]) < 0) sinF2P.push(l); });
  check('lo del Free to Play está en el tooltip en los ocho', sinF2P.length === 0, 'faltan: ' + sinF2P.join(','));
  check('y en el README', readme.indexOf('Free to Play') > 0);
  // Control del propio metodo: si se busca una frase que NO esta, esto tiene que fallar.
  // Sin esto, un `lineaDe` que devolviera siempre '' daria todo por bueno al reves.
  check('control: una frase inventada NO se encuentra',
    lineaDe('tipEvJoin', 1).indexOf('esta frase no existe en ningun idioma') < 0
      && lineaDe('tipEvJoin', 1).length > 0, 'la linea de tipEvJoin[es] esta vacia');
}

console.log('\n=== 57. Las dos caches del evento tienen relojes distintos ===');
{
  // El fallo de 1.3.0: una sola cache diaria para las dos cosas. En la pagina del evento el dato
  // salia del documento y era fresco, pero en cualquier OTRA la fila se quedaba congelada hasta
  // el ⟳ o hasta las 00:00 UTC, aunque AWA ya hubiera acreditado la hora.
  const AHORA = '2026-09-12T10:00:00Z';
  const T0 = Date.parse(AHORA);
  const SLUG = '/steam/community-event/idle-champions-of-the-forgotten-realms-community-event';
  const sembrar = (cache) => (win) => {
    enFecha(AHORA)(win);
    win.localStorage.setItem('awa-arp-evento', JSON.stringify(cache));
    win.__respuestas = {
      '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': leerDoc('dom-steam-community-event-live-joined-awarded-2026-09-11.html'),
    };
  };
  const base = { hay: true, url: SLUG, desde: Date.parse('2026-09-10T00:00:00Z'),
    hasta: Date.parse('2026-09-19T00:00:00Z'), estado: 'joined', minutos: 0,
    hitos: [{ meta: 60, personal: false, comunidad: true }] };
  // Desde que la cache lleva una lista (§61), una con la forma de 1.3.x obliga a releer el
  // indice. Estas pruebas miden los DOS relojes, no la migracion, asi que siembran la forma
  // nueva: el indice de `idxAt` y el estado del `at` de cada evento.
  const nueva = (at, idxAt) => {
    const ev = Object.assign({}, base, { at: at });
    delete ev.hay;
    return { hay: true, at: at, idxAt: idxAt, eventos: [ev] };
  };
  const pedidas = (w) => w.fetched.filter((u) => /\/steam\//.test(u));

  {
    // Estado fresco (hace 5 min) e indice de hoy: no se pide nada.
    const w = mount('dom-homepage-src-2026-08.html', '/',
      sembrar(nueva(T0 - 5 * 60000, T0 - 5 * 60000)));
    await tick(); await tick();
    check('con el estado fresco no se pide nada del evento', pedidas(w).length === 0,
      JSON.stringify(pedidas(w)));
  }
  {
    // Estado caducado (hace 45 min) pero indice del mismo dia: SOLO la pagina del evento.
    const w = mount('dom-homepage-src-2026-08.html', '/',
      sembrar(nueva(T0 - 45 * 60000, T0 - 45 * 60000)));
    await tick(); await tick();
    check('con el estado caducado se pide SOLO la pagina del evento',
      pedidas(w).length === 1 && /community-event/.test(pedidas(w)[0]), JSON.stringify(pedidas(w)));
    // Y el dato se renueva: el volcado trae 60 min, la cache sembrada tenia 0.
    const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
    check('y la fila se actualiza con lo leido', e && /^60\/120 min$/.test(e[1]), e && e.join(' | '));
  }
  {
    // Indice de ayer: hay que volver a preguntar QUE evento esta vivo, o sea las dos.
    const ayer = Date.parse('2026-09-11T10:00:00Z');
    const w = mount('dom-homepage-src-2026-08.html', '/',
      sembrar(nueva(ayer, ayer)));
    await tick(); await tick();
    check('con el indice de ayer se piden las dos', pedidas(w).length === 2
      && pedidas(w).some((u) => /\/steam\/events$/.test(u)), JSON.stringify(pedidas(w)));
  }
  {
    // Sin evento vivo hoy: ni una peticion. Es el caso normal la mayor parte del mes.
    const w = mount('dom-homepage-src-2026-08.html', '/',
      sembrar({ hay: false, at: T0 - 8 * 3600000, idxAt: T0 - 8 * 3600000 }));
    await tick(); await tick();
    check('sin evento vivo no se gasta ni una peticion', pedidas(w).length === 0,
      JSON.stringify(pedidas(w)));
    check('y no sale la fila', !lines(w).find((l) => /Evento|Event/.test(l[0])), '');
  }
  {
    // Compatibilidad: una cache escrita por 1.3.0 no tiene `idxAt`, y como la de 1.3.x lleva UN
    // solo evento en la raiz. No debe romperse, y si debe volver a preguntar al indice: quien la
    // escribio paraba en el primer vivo (ver §61).
    const vieja = Object.assign({}, base, { at: T0 - 5 * 60000 });
    delete vieja.idxAt;
    const w = mount('dom-homepage-src-2026-08.html', '/', sembrar(vieja));
    await tick(); await tick();
    check('una cache de 1.3.0 sin idxAt no rompe y relee el indice',
      pedidas(w).some((u) => /\/steam\/events$/.test(u))
        && !!lines(w).find((l) => /Evento|Event/.test(l[0])), JSON.stringify(pedidas(w)));
  }
}

console.log('\n=== 58. El boton de acceso anticipado cuenta como «sin unirte» ===');
{
  // Nunca se ha visto renderizado, pero su manejador existe en el JS del sitio y llama a
  // `/start-early/`. Antes, una pagina que solo lo ofreciera caia a «en marcha»: no se rompia,
  // pero tampoco decia que hubiera un boton que pulsar.
  const soloAnticipado = leerDoc('dom-steam-community-event-live-joined-awarded-2026-09-11.html')
    .replace(/<a href="steam:\/\/run\/\d+" class="btn btn-steam-community-event">/,
             '<a href="#" class="btn enter-event-early-btn btn-steam-community-event">');
  check('el fixture ya no tiene el boton de jugar', !/steam:\/\/run/.test(soloAnticipado)
    && /enter-event-early-btn/.test(soloAnticipado), '');
  const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
    enFecha('2026-09-12T10:00:00Z')(win);
    win.__respuestas = { '/steam/events': leerDoc('dom-steam-events-index-2026-09-10.html'),
      '/steam/community-event/': soloAnticipado };
  }); await tick(); await tick();
  const e = lines(w).find((l) => /Evento|Event/.test(l[0]));
  check('lo lee como que no te has unido', e && /sin unirte|not joined/.test(e[1]), e && e.join(' | '));
  check('y en ambar, que hay algo que hacer', e && /--todo/.test(e[2]), e && e[2]);
}

console.log('\n=== 59. La campaña SEMANAL sin cobrar, que es el calendario de siempre con UN día ===');
{
  // Volcado del 2026-09-17, el primero con la recompensa semanal SIN cobrar y con el
  // overlay ya abierto: trae el calendario DOS VECES —la copia de `.overlay-content` y el
  // original de `#promotional-calendar-container`— y los dos ejemplares del día 1 con su
  // botón puesto. El de 2026-09-10 (`dom-promotional-calendar-weekly-claimed-…`) es el
  // mismo calendario ya cobrado, así que entre los dos queda el ciclo entero.
  //
  // Lo que enseña, y no se veía con uno solo: cada semana es una CAMPAÑA DISTINTA, no una
  // recompensa que se queda puesta. La del 10 de septiembre cobraba en
  // `/promotional-calendar/claim/116/1243` y esta en `/claim/119/1246`. O sea que «semanal»
  // no es una cadencia nueva del calendario: es el de siempre, con un solo día, publicado
  // otra vez. Por eso `readCalendar` no ha tenido que cambiar nada.
  //
  // Lo que sigue SIN saberse es cuánto dura abierta cada una. El marcado no publica su
  // ventana —ni fecha límite ni contador—, así que no se puede decidir desde aquí si el
  // ámbar de esta línea debería entrar en el aviso de fin de día. Hace falta ver un día sin
  // cobrar sobrevivir a las 00:00 UTC.
  const w = mount('dom-promotional-calendar-weekly-unclaimed-2026-09-17.html', '/control-center',
    capturarTics); await tick();
  const d = w.document;
  check('el volcado trae el overlay abierto, o sea los dos ejemplares',
    !!d.querySelector('.overlay-content .promotional-calendar')
      && d.querySelectorAll('.promotional-calendar__day').length === 2,
    'nodos de día: ' + d.querySelectorAll('.promotional-calendar__day').length);
  const cal = () => lines(w).find((l) => /Calendario|Calendar/.test(l[0]));
  check('un solo día y sin cobrar: 0/1', cal() && cal()[1] === '0/1', cal() && cal().join(' | '));
  check('y en ámbar, que hay algo que cobrar', cal() && /--todo/.test(cal()[2]), cal() && cal()[2]);

  // Cobrar como cobra el sitio: `$btn.remove(); $('#claimed-N').show();` SOLO en la copia.
  const copia = d.querySelector('.overlay-content .promotional-calendar__day[data-day="1"]');
  copia.querySelector('button.promotional-calendar__day-claim').remove();
  copia.querySelector('.promotional-calendar__day-claimed').style.display = '';
  check('el original se queda con su botón, como en el sitio',
    !!d.querySelector('#promotional-calendar-container .promotional-calendar__day-claim'));
  tic(w); await tick();
  check('el panel se entera: 1/1 con marca', cal() && cal()[1] === '1/1 ✅', cal() && cal().join(' | '));
  check('y deja de pedir acción', cal() && /--done/.test(cal()[2]), cal() && cal()[2]);

  // Y el overlay se vacía al cerrarlo, que es donde estaba la única prueba de que cobraste.
  d.querySelector('.overlay-content').textContent = '';
  tic(w); await tick();
  check('cerrar el overlay no lo devuelve a «por cobrar»', cal() && cal()[1] === '1/1 ✅',
    cal() && cal().join(' | '));
}

console.log('\n=== 60. La pagina de una quest de Steam: el porcentaje, en minutos ===');
{
  // La barra del sitio no lleva NI UNA CIFRA: solo un ancho y su `aria-valuenow`.
  // Estas comprobaciones son las de deshacer esa cuenta, y los cuatro volcados de
  // la serie dan los cuatro estados sin tocar la cuenta.
  //
  // El 71 % es el caso que fija el metodo: 71 % de 60 min son 42,6, pero el sitio
  // TRUNCA minutos ÷ exigidos × 100, asi que el unico entero que produce un 71 es
  // el 43 —el 42 daria 70 y el 44 daria 73—. O sea que la cifra no es un redondeo
  // nuestro, es el minuto que AWA tiene apuntado, y eso es lo que se comprueba
  // aqui: que dice 43 y no 42 ni 43,2.
  const w = mount('dom-steam-quest-fixed-progress-71-2026-08.html', '/steam/quests/marvel-rivals-6');
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('pinta la linea debajo de la barra', !!caja);
  check('43 de 60 minutos, no 42 ni 42,6', caja && /\b43 de 60 min\b/.test(caja.textContent),
    caja && caja.textContent);
  check('y dice lo que falta: 17', caja && /faltan 17\b/.test(caja.textContent),
    caja && caja.textContent);
  check('sin «≈»: con una hora exigida el minuto es unico',
    caja && caja.textContent.indexOf('≈') < 0, caja && caja.textContent);
  check('va justo DESPUES de la barra del sitio, no en otro sitio de la pagina',
    caja && caja.previousElementSibling
      && caja.previousElementSibling.classList.contains('progress-steam-quest'),
    caja && caja.previousElementSibling && caja.previousElementSibling.className);
  check('lleva su explicacion en el title', caja && (caja.getAttribute('title') || '').length > 100);
  check('y marcada como no traducible, para que Weglot no se coma las cifras',
    caja && caja.getAttribute('translate') === 'no' && caja.classList.contains('notranslate'));
  check('el panel sigue estando: la linea no lo sustituye', !!w.document.getElementById('awa-arp-widget'));
}

{
  // Tipo A, «elige tu propio juego», al 50 %. Es el volcado de OTRA quest y de otro
  // tipo, y aqui se comprueba lo que dice el analisis: que una vez arrancadas las dos
  // convergen en el mismo marcado, asi que el mismo codigo las lee sin distinguir.
  const w = mount('dom-steam-quest-progress-2026-08.html', '/steam/quests/choose-your-own-game-167');
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('el tipo A se lee con el mismo codigo', !!caja);
  check('50 % de 60 min son 30, y faltan 30',
    caja && /\b30 de 60 min\b/.test(caja.textContent) && /faltan 30\b/.test(caja.textContent),
    caja && caja.textContent);
}

{
  // Cero con la barra PUESTA no es «sin empezar»: la quest esta en marcha y lo que
  // pasa es que AWA aun no ha visto nada, que con su hora de retraso es lo normal
  // justo despues de arrancar. La linea tiene que decir eso y no «te faltan 60 de 60»,
  // que sonaria a que no has jugado.
  const w = mount('dom-steam-quest-fixed-progress-2026-08.html', '/steam/quests/marvel-rivals-6');
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('con la barra al 0 tambien pinta', !!caja);
  check('y no dice «0 de 60»', caja && caja.textContent.indexOf('0 de 60') < 0, caja && caja.textContent);
  check('dice que AWA no ve tiempo y cuanto pide', caja && /aún no te ve tiempo/.test(caja.textContent)
    && /60 min/.test(caja.textContent), caja && caja.textContent);
}

{
  // Completada: el sitio ya lo dice con su propio `.alert-steam` justo debajo de la
  // barra, asi que no hay nada que añadir. Y ademas ahi el porcentaje se pasa de 100
  // (171 %), o sea que la cuenta seria exacta y a la vez inutil.
  const w = mount('dom-steam-quest-fixed-done-2026-08.html', '/steam/quests/marvel-rivals-6');
  await tick();
  check('con la quest hecha no pinta nada', !w.document.querySelector('.awa-quest'));
  check('y el aviso del sitio sigue ahi, intacto', !!w.document.querySelector('.alert.alert-steam'));
}

{
  // Antes de arrancarla no hay barra, y sin barra no hay progreso que traducir. Se
  // comprueba en los DOS tipos, porque es el unico estado en el que no convergen:
  // el fijo espera a que compruebes la propiedad y el otro, a que elijas juego.
  const fijo = mount('dom-steam-quest-fixed-unstarted-2026-08.html', '/steam/quests/marvel-rivals-7');
  await tick();
  check('en la quest de juego fijo sin arrancar no se pinta', !fijo.document.querySelector('.awa-quest'));
  const elige = mount('dom-steam-quest-choose-unstarted-2026-08.html', '/steam/quests/choose-your-own-game-168');
  await tick();
  check('ni en la de «elige tu propio juego» sin arrancar', !elige.document.querySelector('.awa-quest'));
}

{
  // Control negativo de alcance: el gancho es la barra y no la ruta, asi que hay que
  // comprobar que ninguna OTRA pagina la tiene. Si `.progress-steam-quest` saliera
  // tambien en el Centro de control, la linea aparecería donde no toca.
  const w = mount('dom-control-center-2026-08-24.html', '/control-center');
  await tick();
  check('en el Centro de control no hay linea de quest', !w.document.querySelector('.awa-quest'));
  const ev = mount('dom-steam-community-event-live-joined-2026-09-10.html',
    '/steam/community-event/1');
  await tick();
  check('ni en la pagina de un evento comunitario, que tiene sus propias barras',
    !ev.document.querySelector('.awa-quest'));
}

{
  // La trampa del titulo con numero. El tiempo exigido solo esta en la prosa, y en el
  // tipo B esa prosa lleva el nombre del juego dentro: coger «el primer numero» habria
  // leido el 2 de «Dota 2» y anunciado una quest de dos minutos.
  const w = mount('dom-steam-quest-fixed-progress-71-2026-08.html', '/steam/quests/marvel-rivals-6',
    (win) => {
      win.document.querySelector('.quest-desc').textContent =
        '¡Juega a Dota 2 durante 1 hora para recibir tu recompensa!';
    });
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('un numero en el titulo del juego no se confunde con el tiempo exigido',
    caja && /\b43 de 60 min\b/.test(caja.textContent), caja && caja.textContent);
}

{
  // Una exigencia mas larga: el intervalo del truncado puede admitir DOS minutos —a
  // tres horas, el 71 % vale por el 128 y por el 129—, y entonces la cifra se marca
  // como aproximada en vez de fingir una precision que no esta.
  const w = mount('dom-steam-quest-fixed-progress-71-2026-08.html', '/steam/quests/marvel-rivals-6',
    (win) => {
      win.document.querySelector('.quest-desc').textContent =
        '¡Juega a Marvel Rivals durante 3 horas para recibir tu recompensa!';
    });
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('con 3 horas exigidas la cifra sale aproximada',
    caja && /≈128 de 180 min/.test(caja.textContent), caja && caja.textContent);
  check('y lo que falta se cuenta igual: 52', caja && /faltan 52\b/.test(caja.textContent),
    caja && caja.textContent);
}

{
  // Y si la unidad no se reconoce —un idioma cuya traduccion no esta en la tabla, o
  // una frase escrita de otra manera— no se inventan minutos: se pinta el porcentaje,
  // que es el unico dato que la pagina publica de verdad.
  const w = mount('dom-steam-quest-fixed-progress-71-2026-08.html', '/steam/quests/marvel-rivals-6',
    (win) => {
      win.document.querySelector('.quest-desc').textContent =
        '¡Juega a Marvel Rivals durante un rato para recibir tu recompensa!';
    });
  await tick();
  const caja = w.document.querySelector('.awa-quest');
  check('sin tiempo exigido legible cae al porcentaje', caja && /71 %/.test(caja.textContent),
    caja && caja.textContent);
  check('y no dice minutos que no puede saber', caja && !/min/.test(caja.textContent),
    caja && caja.textContent);
}

{
  // El idioma. La linea se pinta UNA VEZ al arrancar, y al arrancar Weglot puede no
  // haber llegado: `siteLang()` devuelve entonces el idioma de ENTRADA y no el que se
  // va a ver. El panel ya se rehacia por eso; esto comprueba que la linea de la quest
  // se rehace con el, porque si no quedaba en un idioma y el panel de al lado en otro.
  //
  // Se conduce por la API de Weglot, que es la fuente que manda en `siteLang()`, y no
  // por el `lang` del <html>: este volcado trae la marca `.wgcurrent[data-l="es"]` del
  // selector, que va ANTES del <html> en ese orden, asi que cambiar el atributo no
  // cambia el idioma vigente —y una prueba que lo hiciera estaria midiendo el volcado,
  // no el script—.
  let disparar = null;
  const w = mount('dom-steam-quest-fixed-progress-71-2026-08.html', '/steam/quests/marvel-rivals-6',
    (win) => {
      win.Weglot = {
        _lang: 'es',
        getCurrentLang() { return this._lang; },
        on(evt, cb) { if (evt === 'languageChanged') disparar = cb; },
      };
    });
  await tick();
  const antes = w.document.querySelector('.awa-quest');
  check('arranca en el idioma que dice Weglot (es)', antes && /te ve 43 de 60 min/.test(antes.textContent),
    antes && antes.textContent);
  check('y el script esta suscrito al cambio', typeof disparar === 'function');
  if (disparar) { w.Weglot._lang = 'en'; disparar('en'); }
  await tick();
  const despues = w.document.querySelector('.awa-quest');
  check('la linea sigue al idioma cuando el sitio cambia',
    despues && /sees 43 of 60 min/.test(despues.textContent), despues && despues.textContent);
  check('sin duplicarse: sigue habiendo UNA linea',
    w.document.querySelectorAll('.awa-quest').length === 1,
    'lineas: ' + w.document.querySelectorAll('.awa-quest').length);
  check('y con su title tambien en el idioma nuevo',
    despues && /The page publishes only/.test(despues.getAttribute('title') || ''),
    despues && (despues.getAttribute('title') || '').slice(0, 40));
}

{
  // Los ocho idiomas, como en §56: una clave que se quede en ingles no rompe nada y
  // por eso no se ve, asi que se comprueba que las cuatro cadenas de la linea y el
  // parrafo de «Saber mas» existen en todos y NO son la inglesa copiada.
  const src = SCRIPT;   // y no el fichero: SCRIPT honra AWA_FUENTE, que es lo que mide el control negativo
  for (const clave of ['qtSeen', 'qtZero', 'qtFull', 'qtPct', 'tipQuest', 'mQuestTime']) {
    const halladas = src.split('\n').filter((l) => l.indexOf(clave + ':') >= 0);
    // Las claves van de dos en dos por linea, asi que se cuentan por apariciones.
    const veces = (src.match(new RegExp('\\b' + clave + ':', 'g')) || []).length;
    check(clave + ' esta en los ocho idiomas', veces === 8, 'apariciones: ' + veces + ' / lineas: ' + halladas.length);
  }
}

console.log('\n=== 61. Dos eventos vivos a la vez: una linea por cada uno ===');
{
  // El 2026-09-23 hubo dos a la vez —Warframe del 23-sep al 10-oct y Aniimo del 21 al 30-sep, los
  // dos sin el juego— y el panel enseño solo Warframe, que es el primero del indice: un `return`
  // dentro del bucle. Aniimo, el que acababa antes, no salia en ninguna parte. Los cuatro volcados
  // son de ese dia y la fecha se congela dentro de la ventana de los dos.
  const AHORA = '2026-09-24T01:30:00Z';
  const WF = '/steam/community-event/warframe-community-event-7';
  const AN = '/steam/community-event/aniimo-community-event';
  const INDICE = 'dom-steam-events-index-two-live-2026-09-23.html';
  const P_WF = 'dom-steam-community-event-live-unowned-9-milestones-2026-09-23.html';
  const P_AN = 'dom-steam-community-event-live-unowned-6-milestones-2026-09-23.html';
  const respuestas = (win) => {
    win.__respuestas = { '/steam/events': leerDoc(INDICE), [WF]: leerDoc(P_WF), [AN]: leerDoc(P_AN) };
  };
  const deEvento = (w) => lines(w).filter((l) => /Evento|Event/.test(l[0]));
  const relojesDe = (w) => Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__clock'))
    .map((n) => n.textContent).filter((r) => /Evento|Event/.test(r));

  // Control del fixture: el indice de verdad trae los dos bajo «Current Events», Warframe primero.
  const idx = leerDoc(INDICE);
  check('el indice del volcado trae los dos, Warframe antes que Aniimo',
    idx.indexOf('href="' + WF) > 0 && idx.indexOf('href="' + AN) > idx.indexOf('href="' + WF), '');

  {
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => { enFecha(AHORA)(win); respuestas(win); });
    await tick(); await tick();
    const ev = deEvento(w);
    check('salen DOS lineas de evento', ev.length === 2, ev.map((x) => x.join(' | ')).join(' / '));
    // Primero el que termina antes (Aniimo, 30-sep), aunque el indice lo ponga segundo.
    check('la primera es la que acaba antes: Aniimo', ev[0] && /Aniimo/.test(ev[0][0]), ev[0] && ev[0][0]);
    check('y la segunda, Warframe', ev[1] && /Warframe/.test(ev[1][0]), ev[1] && ev[1][0]);
    check('el nombre va sin el «Community Event» del indice',
      ev.every((x) => !/Community/.test(x[0])), ev.map((x) => x[0]).join(' / '));
    check('las dos dicen que falta el juego',
      ev.length === 2 && ev.every((x) => /falta el juego|game missing/.test(x[1])), ev.map((x) => x[1]).join(' / '));
    check('y las dos en ambar', ev.length === 2 && ev.every((x) => /--todo/.test(x[2])), '');
    check('cada una lleva su flecha', ev.length === 2 && ev.every((x) => /--go/.test(x[2])), '');
    // Una peticion por cosa: el indice y las dos paginas, ninguna repetida.
    const f = w.fetched;
    check('pide el indice una vez y cada evento una vez',
      f.filter((u) => /\/steam\/events$/.test(u)).length === 1
        && f.filter((u) => u.indexOf(WF) >= 0).length === 1
        && f.filter((u) => u.indexOf(AN) >= 0).length === 1, JSON.stringify(f));
    const r = relojesDe(w);
    check('dos relojes de evento, cada uno con su nombre',
      r.length === 2 && /Aniimo/.test(r[0]) && /Warframe/.test(r[1]), r.join(' / '));
    // 30-sep incluido entero: del 24 a las 01:30 al 1-oct a las 00:00 son 6d 22h.
    check('el de Aniimo cuenta hasta el final del 30-sep', r[0] && /6d\s*22h/.test(r[0]), r[0]);
    // Y la cache nueva lleva la lista, no un evento suelto en la raiz.
    let cache = null;
    try { cache = JSON.parse(w.localStorage.getItem('awa-arp-evento')); } catch (e) { /* */ }
    check('la cache guarda los dos en una lista',
      !!(cache && Array.isArray(cache.eventos) && cache.eventos.length === 2), JSON.stringify(cache).slice(0, 120));
  }
  {
    // En la pagina de uno de los dos: ese sale del documento y NO se pide; el otro, si.
    const w = mount(P_WF, WF, (win) => { enFecha(AHORA)(win); respuestas(win); });
    await tick(); await tick();
    check('en la pagina de Warframe siguen saliendo las dos', deEvento(w).length === 2,
      deEvento(w).map((x) => x[0]).join(' / '));
    check('no se pide la pagina en la que estas', !w.fetched.some((u) => u.indexOf(WF) >= 0), JSON.stringify(w.fetched));
    check('y la del otro si', w.fetched.some((u) => u.indexOf(AN) >= 0), JSON.stringify(w.fetched));
    // La de la pagina en la que estas no lleva flecha: no te moveria (ver irA).
    const wf = deEvento(w).find((x) => /Warframe/.test(x[0]));
    check('la del evento en el que estas va sin flecha', wf && !/--go/.test(wf[2]), wf && wf[2]);
  }
  {
    // Terminado Aniimo, queda uno: vuelve la etiqueta de siempre y un reloj sin nombre.
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      enFecha('2026-10-01T00:30:00Z')(win); respuestas(win); });
    await tick(); await tick();
    const ev = deEvento(w);
    check('con uno solo, una linea', ev.length === 1, ev.map((x) => x[0]).join(' / '));
    check('con la etiqueta de siempre, sin nombre',
      ev[0] && /^(Evento comunitario|Community event)/.test(ev[0][0]), ev[0] && ev[0][0]);
    check('y no se pide la pagina del que ya termino', !w.fetched.some((u) => u.indexOf(AN) >= 0),
      JSON.stringify(w.fetched));
  }
  {
    // Las caches por evento: la de Warframe fresca y la de Aniimo caducada. Con el indice de hoy
    // se pide SOLO la caducada.
    const T0 = Date.parse(AHORA);
    const cache = { hay: true, at: T0 - 5 * 60000, idxAt: T0 - 60 * 60000, eventos: [
      { url: AN, nombre: 'Aniimo Community Event', hasta: Date.parse('2026-10-01T00:00:00Z'),
        estado: 'unowned', hitos: [], at: T0 - 45 * 60000 },
      { url: WF, nombre: 'Warframe Community Event', hasta: Date.parse('2026-10-11T00:00:00Z'),
        estado: 'unowned', hitos: [], at: T0 - 5 * 60000 },
    ] };
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      enFecha(AHORA)(win); respuestas(win);
      win.localStorage.setItem('awa-arp-evento', JSON.stringify(cache));
    });
    await tick(); await tick();
    const pedidas = w.fetched.filter((u) => /\/steam\//.test(u));
    check('con una caducada y otra fresca, se pide solo la caducada',
      pedidas.length === 1 && pedidas[0].indexOf(AN) >= 0, JSON.stringify(pedidas));
    check('y siguen las dos lineas', deEvento(w).length === 2, deEvento(w).map((x) => x[0]).join(' / '));
  }
  {
    // Si la pagina de uno falla, el otro no se pierde: antes un solo `.catch` tiraba todo.
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      enFecha(AHORA)(win);
      win.__respuestas = { '/steam/events': leerDoc(INDICE), [WF]: leerDoc(P_WF) };
    });
    await tick(); await tick();
    const ev = deEvento(w);
    check('con la pagina de Aniimo sin red, Warframe sigue diciendo lo suyo',
      ev.some((x) => /Warframe/.test(x[0]) && /falta el juego|game missing/.test(x[1])),
      ev.map((x) => x.join(' | ')).join(' / '));
  }
  {
    // El fallo que se vio al estrenarlo: la cache que dejo 1.3.4 ese mismo dia, con Warframe solo
    // en la raiz, el indice leido HOY y el estado fresco. La primera version la daba por buena
    // —sin pedir nada— y el panel siguio con una sola linea hasta pulsar ⟳.
    const T0 = Date.parse(AHORA);
    const de134 = { hay: true, url: WF, nombre: 'Warframe Community Event',
      desde: Date.parse('2026-09-23T00:00:00Z'), hasta: Date.parse('2026-10-11T00:00:00Z'),
      estado: 'unowned', minutos: 0, hitos: [], at: T0 - 5 * 60000, idxAt: T0 - 60 * 60000 };
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      enFecha(AHORA)(win); respuestas(win);
      win.localStorage.setItem('awa-arp-evento', JSON.stringify(de134));
    });
    await tick(); await tick();
    check('con la cache de 1.3.4 (un solo evento) se relee el indice',
      w.fetched.some((u) => /\/steam\/events$/.test(u)), JSON.stringify(w.fetched));
    check('y salen las dos lineas sin pulsar ⟳', deEvento(w).length === 2,
      deEvento(w).map((x) => x[0]).join(' / '));
    // Y solo esa vez: la cache que queda ya es la nueva, y con ella no se vuelve a pedir.
    let cache = null;
    try { cache = JSON.parse(w.localStorage.getItem('awa-arp-evento')); } catch (e) { /* */ }
    check('la cache queda con la forma nueva y el indice de hoy',
      !!(cache && Array.isArray(cache.eventos) && cache.eventos.length === 2 && cache.idxAt === T0),
      JSON.stringify(cache).slice(0, 120));
  }
  {
    // Lo nuevo, en las otras dos superficies: la ficha «Saber más» (en los ocho) y el README.
    const src = SCRIPT;
    const veces = (src.match(/\bevNamed:/g) || []).length;
    check('evNamed esta en los ocho idiomas', veces === 8, 'apariciones: ' + veces);
    const readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');
    check('el README cuenta lo de varios eventos, en los dos idiomas',
      /more than one event/.test(readme) && /más de un evento/.test(readme), '');
  }
}

console.log('\n=== 62. Un artefacto sube el tope de Twitch ===');
// Scion of the Light suma +1 al tope diario de Twitch, y el sitio lo paga APARTE: `totalPoints`
// sigue topado en 15 y el extra llega en `bonusPoints` cuando esos 15 ya estan. Hasta 1.3.5 el
// panel comparaba contra un 15 fijo, asi que con 15 cobrados y el bonus pendiente pintaba
// «15/15 ✅» mientras el sitio decia «Incomplete», y con el bonus cobrado, «16/15».
{
  const twLinea = (w) => Array.from(w.document.querySelectorAll('#awa-arp-widget .awa-w__line'))
    .find((l) => /Twitch/.test(l.querySelector('.awa-w__k').textContent));
  const deLinea = (l) => l ? [l.querySelector('.awa-w__v').textContent, l.className, l.getAttribute('title') || ''] : null;
  const BONUS = 'dom-control-center-twitch-scion-bonus-2026-09-25.html';
  {
    // El volcado de verdad: 15 + 1, underCap false.
    const w = mount(BONUS, '/control-center'); await tick();
    const [v, cls, tipo] = deLinea(twLinea(w)) || [];
    check('con el bonus cobrado: 16/16 con marca', v === '16/16 ✅' && /--done/.test(cls), v + ' | ' + cls);
    check('y el tooltip dice que el tope es 16 por un artefacto, sin nombrarlo',
      /16/.test(tipo) && /artefactos equipados|equipped artifacts/.test(tipo) && !/Scion|Vástago/.test(tipo), tipo);
  }
  {
    // El estado intermedio no se llego a volcar: se deriva del mismo volcado con los dos valores
    // que cambian, anclados al JSON del script —la cabecera del saneado los cita SIN comillas—.
    const orig = leer(BONUS);
    const de = '"bonusPoints": 1, "pointsToAward": 0, "underCap": false';
    const a = '"bonusPoints": 0, "pointsToAward": 0, "underCap": true';
    const html = orig.split(de).join(a);
    check('control: el recorte de verdad ocurrio (una vez, en el script)',
      orig.split(de).length === 2 && html.indexOf(a) > 0 && html.indexOf(de) < 0, '');
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      win.__respuestas = { 'control-center': html };
    }); await tick(); await tick();
    const [v, cls, tipo] = deLinea(twLinea(w)) || [];
    check('con 15 y el bonus pendiente: 15/15+ y SIN marca', v === '15/15+' && /--todo/.test(cls), v + ' | ' + cls);
    check('y el tooltip explica el «+»', /«\+»/.test(tipo) && /artefactos equipados|equipped artifacts/.test(tipo), tipo);
  }
  {
    // Lo de siempre, sin artefacto, no cambia: ni la cifra ni el tooltip.
    const w = mount('dom-control-center-twitch-completed-2026-08.html', '/control-center'); await tick();
    const [v, , tipo] = deLinea(twLinea(w)) || [];
    check('sin bonus sigue siendo 15/15 con marca', v === '15/15 ✅', v);
    check('y su tooltip no habla de artefactos', !/artefacto|artifact/i.test(tipo), tipo);
  }
  {
    // El camino de respaldo, sin `dailyArpData`: solo quedan los spans, y el estado lo traduce
    // Weglot. La primera version de este arreglo daba ese texto por fiable, y con «Completo» —que
    // no casa con /complete/— pintaba «15/15+» con el dia hecho. Sin el booleano manda lo de 1.3.5.
    const orig = leer('dom-control-center-twitch-completed-2026-08.html');
    const html = orig.split('dailyArpData').join('dailyArpDatoX')
      .split('<span id="control-center__twitch-arp-status">Complete</span>')
      .join('<span id="control-center__twitch-arp-status">Completo</span>');
    check('control: sin dailyArpData y con el estado traducido',
      html.indexOf('dailyArpData') < 0 && html.indexOf('>Completo</span>') > 0, '');
    const w = mount('dom-homepage-src-2026-08.html', '/', (win) => {
      win.__respuestas = { 'control-center': html };
    }); await tick(); await tick();
    const [v, cls] = deLinea(twLinea(w)) || [];
    check('sin el booleano y con «Completo»: 15/15 con marca, no 15/15+', v === '15/15 ✅' && /--done/.test(cls),
      v + ' | ' + cls);
  }
  {
    // Y en las otras superficies: los dos textos del tooltip y la ficha en los ocho, y el README.
    const n = (re) => (SCRIPT.match(re) || []).length;
    check('tipTwitchBonus y tipTwitchPend estan en los ocho idiomas',
      n(/\btipTwitchBonus:/g) === 8 && n(/\btipTwitchPend:/g) === 8,
      n(/\btipTwitchBonus:/g) + ' / ' + n(/\btipTwitchPend:/g));
    const mT = SCRIPT.split('\n').filter((l) => /^\s*mTwitch:/.test(l));
    check('la ficha «Saber más» lo cuenta en los ocho', mT.length === 8 && mT.every((l) => /15/.test(l.split('Nexus')[1] || '')),
      mT.length + '');
    const readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');
    check('el README lo cuenta en los dos idiomas',
      /raise the daily cap above 15/.test(readme) && /suben el tope diario por encima de 15/.test(readme), '');
  }
}

console.log('\n=== 63. El descuento de un artefacto en el Marketplace ===');
// Con Mysterious Text equipado el sitio publica `artifactLangDiscount = 0.99` y pinta al lado de
// cada precio el rebajado (`.arp-discount-new`), pero `data-product-price` sigue siendo el de
// lista. Hasta 1.3.5 el panel comparaba el saldo con ese, asi que en el borde decia «te faltan»
// de algo que ya alcanzaba. La prueba usa como verdad lo que pinta el propio sitio.
{
  const F = 'dom-marketplace-artifact-discount-2026-09-25.html';
  const orig = leer(F);
  // Precio de lista y precio que pinta el sitio, por id de producto, sacados del HTML.
  const pares = {};
  orig.replace(/id="marketplace-product-id-(\d+)"[\s\S]*?class="arp-discount-old">\s*(\d+)\s*<\/span>\s*<span\s+class="arp-discount-new">\s*(\d+)/g,
    (m, id, l, n) => { pares[id] = { lista: +l, real: +n }; return m; });
  const ids = Object.keys(pares);
  check('control: el volcado trae los dos precios de 38 tarjetas', ids.length === 38, 'pares: ' + ids.length);
  const reales = Array.from(new Set(ids.map((id) => pares[id].real))).sort((a, b) => a - b);
  // Con el saldo justo en cada precio rebajado, y uno por debajo: toda tarjeta con stock tiene que
  // decir «alcanza» exactamente cuando el saldo llega a lo que pinta el sitio.
  let malas = [], vistas = 0;
  for (const saldo of reales.flatMap((r) => [r - 1, r])) {
    const w = mount(F, '/marketplace/', (win) => { win.arp_balance = saldo; }); await tick();
    ids.forEach((id) => {
      const card = w.document.getElementById('marketplace-product-id-' + id);
      if (!card || card.getAttribute('data-product-in-stock') !== 'true') return;
      const tag = card.querySelector('.awa-tag');
      vistas++;
      const alcanza = !!(tag && /--ok/.test(tag.className));
      if (alcanza !== (saldo >= pares[id].real)) malas.push(id + '@' + saldo + ' (' + (tag && tag.textContent) + ')');
    });
  }
  check('«te alcanza» justo cuando el saldo llega al precio rebajado, en todas las tarjetas',
    vistas > 100 && !malas.length, malas.slice(0, 4).join(', ') + ' · vistas ' + vistas);
  {
    // El caso del borde, dicho con la tarjeta de los fragmentos: 150 de lista, 148 de verdad.
    const w = mount(F, '/marketplace/', (win) => { win.arp_balance = 147; }); await tick();
    const frag = Array.from(w.document.querySelectorAll('.product-card'))
      .find((c) => c.getAttribute('data-product-price') === '150' && /Fragment/i.test(c.getAttribute('data-product-name') || ''));
    const tag = frag && frag.querySelector('.awa-tag');
    check('con 147 de saldo, los fragmentos piden 1 ARP mas, no 3', !!tag && /\b1\b/.test(tag.textContent) && !/\b3\b/.test(tag.textContent),
      tag && tag.textContent);
    const tipo = tag ? (tag.getAttribute('title') || '') : '';
    check('y el tooltip dice el precio rebajado y el de lista', /148/.test(tipo) && /150/.test(tipo), tipo);
  }
  {
    // Sin la carta (el mismo volcado con el factor en 1) todo sigue como antes: precio de lista.
    const sin = orig.replace(/var artifactLangDiscount = 0\.99;/, 'var artifactLangDiscount = 1;');
    check('control: el factor se cambio de verdad', sin !== orig && sin.indexOf('artifactLangDiscount = 1;') > 0, '');
    // `mount` lee de fichero, asi que la copia sin descuento se escribe en un temporal —fuera de
    // docs/, para no dejar nada en el repo— y se lee con 148 de saldo en los fragmentos.
    const tmp = require('path').join(require('os').tmpdir(), 'awa-sin-descuento.html');
    require('fs').writeFileSync(tmp, sin);
    const w2 = mount(require('path').relative(DOCS, tmp), '/marketplace/', (win) => { win.arp_balance = 148; }); await tick();
    const frag = Array.from(w2.document.querySelectorAll('.product-card'))
      .find((c) => c.getAttribute('data-product-price') === '150' && /Fragment/i.test(c.getAttribute('data-product-name') || ''));
    const tag = frag && frag.querySelector('.awa-tag');
    check('sin descuento, 148 no alcanzan para 150: faltan 2', !!tag && /--short/.test(tag.className) && /\b2\b/.test(tag.textContent),
      tag && tag.textContent);
    // Ojo: «Cuesta 150 ARP y tienes 148» lleva los dos numeros, asi que se mira el texto del
    // descuento y no las cifras (la primera version de esta prueba casaba con el saldo).
    const tt = tag ? (tag.getAttribute('title') || '') : '';
    check('y el tooltip es el de siempre', !!tag && /150/.test(tt) && !/descuento|discount/i.test(tt), tt);
    require('fs').unlinkSync(tmp);
  }
  {
    const n = (SCRIPT.match(/\btipTagDisc:/g) || []).length;
    check('tipTagDisc esta en los ocho idiomas', n === 8, 'apariciones: ' + n);
    const info = SCRIPT.split('\n').filter((l) => /^\s*infoDescriptionText:/.test(l));
    check('la ficha lo cuenta en los ocho', info.length === 8 && info.every((l) => /Marketplace/.test(l) && /(descuento|discount|Rabatt|remise|desconto|折扣|छूट)/.test(l)),
      info.length + '');
    const readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');
    check('el README lo cuenta en los dos idiomas',
      /discount artifact equipped/.test(readme) && /artefacto de descuento del Marketplace/.test(readme), '');
  }
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + ok + ' comprobaciones pasadas, ' + fail + ' fallidas\n');
process.exit(fail ? 1 : 0);
}
main();
