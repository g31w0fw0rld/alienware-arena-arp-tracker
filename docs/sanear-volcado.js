#!/usr/bin/env node
// Sanea un volcado de alienwarearena.com antes de que se quede en docs/.
//
// Uso:  node sanear-volcado.js <entrada.html> [salida.html] ["nota para la cabecera"]
//       Si se omite <salida>, o si coincide con <entrada>, reescribe el fichero en su sitio.
//
// Por que existe: AWA publica el JWT de sesion en `var user_token` de CADA pagina, y con el
// viajan uuid, user_id, login_id, la api_key de Weglot, el SteamID y el nombre de usuario.
// Un volcado crudo en el repo es una credencial en el repo.
//
// Fallo real del 2026-08-24, y el motivo de que las reglas usen \s*=\s* y patrones por forma:
// un volcado del DOM renderizado alinea los '=' con relleno (`var user_id           = 12345678;`),
// asi que TODAS las reglas escritas con un solo espacio fallaron en silencio... y la verificacion,
// escrita igual, dijo que estaba limpio. Solo se salvo la del JWT, que iba por forma. Moraleja:
// las reglas van por forma siempre que se pueda, y la verificacion NUNCA se escribe como la regla.
//
// Dos avisos de uso, comprobados con fixtures:
//   - Sale con codigo 1 si la verificacion final encuentra restos. Comprobado con un control
//     negativo (una clave de Weglot metida en un atributo, fuera de la forma que redacta la regla):
//     la redaccion no la coge, la verificacion si, y el proceso falla. Si eso pasa, no dejes el
//     fichero en docs/: anade el patron aqui primero.
//   - NO es idempotente: cada pasada anade su cabecera. Se ejecuta una sola vez por volcado.
//
// Regla de diseno: NINGUN valor real va escrito aqui. Todo se deriva del propio fichero con
// patrones, para que este script no sea un segundo sitio donde vivan los identificadores.
// (Un intento anterior los llevaba como literales en los regex; por eso se borro.)

const fs = require('fs');

const [entrada, salidaArg, nota] = process.argv.slice(2);
if (!entrada) {
  console.error('uso: node sanear-volcado.js <entrada.html> [salida.html] ["nota"]');
  process.exit(2);
}
const salida = salidaArg || entrada;

let s = fs.readFileSync(entrada, 'utf8');
const bytesAntes = s.length;

// El nombre de usuario se saca del propio volcado, no de una constante.
const mUser = s.match(/var user_username\s*=\s*"([^"]+)"/);
const usuario = mUser && mUser[1];
const mUuid = s.match(/var user_uuid\s*=\s*"([0-9a-f-]{36})"/);
const uuid = mUuid && mUuid[1];
// El id numerico viaja tambien DENTRO de URLs (/ajax/user/avatar/save/<id>, /ucf/user/<id>/...),
// asi que, como el usuario y el uuid, se redacta por valor y no por el contexto de la variable.
// Se busca en varias formas a proposito: si una pasada anterior ya puso la variable a 0, la
// declaracion deja de servir para derivarlo y el id seguiria vivo en las URLs.
const mId = s.match(/var user_id\s*=\s*(\d{4,})/)
         || s.match(/\/ucf\/user\/(\d{4,})\//)
         || s.match(/\/ajax\/user\/[a-z/-]*\/(\d{4,})\b/)
         || s.match(/\/esi\/member\/[a-z-]+\/(\d{4,})\b/);
const userId = mId && mId[1];

const reglas = [
  // --- recortes de volumen (mismas marcas que el resto de los volcados)
  ['<style> recortado',    /([ \t]*)<style[^>]*>[\s\S]*?<\/style>/g,        '$1<!-- <style> inline recortado -->'],
  ['<noscript> recortado', /([ \t]*)<noscript[^>]*>[\s\S]*?<\/noscript>/g,  '$1<!-- <noscript> recortado -->'],

  // --- credenciales y identificadores
  // El JWT aparece en DOS formas: `var user_token = "ey..."` y, en las paginas de sorteo,
  // `var token = { "token": "ey..." }`. Se redacta por la FORMA del token, no por el nombre de la
  // variable, que es lo que dejo escapar una copia el 2026-08-24.
  ['JWT de sesion',   /"eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"/g, '"REDACTADO-JWT"'],
  ['user_id',         /var user_id\s*=\s*\d+/g,                 'var user_id = 0'],
  ['login_id',        /var login_id\s*=\s*\d+/g,                'var login_id = 0'],
  // El uuid NO se redacta por forma: la pagina lleva uuids publicos a proposito (la sitekey de
  // hCaptcha, el giveaway_uuid de cada sorteo) que hay que conservar. Se redacta el del usuario,
  // derivado abajo del propio volcado, alla donde aparezca.
  // steamId se ENMASCARA conservando los 17 digitos: a 0 se borraria el hallazgo, porque 0 es
  // justo el estado contrario (cuenta de Steam sin vincular).
  ['steamId (enmascarado)', /\b7656119\d{10}\b/g,               '76561190000000000'],
  ['member_since',    /var user_member_since\s*=\s*"[^"]*"/g,   'var user_member_since = "AAAA"'],
  ['api_key Weglot',  /'wg_[0-9a-f]{20,}'/g,                    "'REDACTADO-WEGLOT'"],
  ['_csrf_token',     /(name="_csrf_token"[^>]*?value=")[^"]+"/g, '$1REDACTADO-CSRF"'],
  ['token de anuncio', /token:\s*'[A-Za-z0-9]{2,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'/g, "token: 'REDACTADO-TRACKING'"],
  ['api_key de sorteo', /api_key=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'api_key=REDACTADO'],
  ['id de reclamo del Pase', /\/battle-pass\/claim\/\d+/g,      '/battle-pass/claim/REDACTADO-ID'],
  // Claves de juego. En /account/my-rewards la lista la pinta el JS, asi que un view-source no las
  // trae; pero un volcado del DOM ya renderizado SI llevaria las claves reales del usuario.
  ['clave de juego', /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}(?:-[A-Z0-9]{5})?\b/g, 'REDACTADO-CLAVE'],
];

const cuentas = [];
for (const [nombre, re, rep] of reglas) {
  const n = (s.match(re) || []).length;
  s = s.replace(re, rep);
  cuentas.push([nombre, n]);
}

// El usuario, al final y por separado: se sustituye en todo el documento (perfil, menu, avisos).
// Si no se puede derivar, se PARA: seguir seria anonimizar a medias sin decirlo.
if (!usuario) {
  console.error('FALLO: no se encontro `var user_username` en el volcado, asi que no se puede');
  console.error('anonimizar el nombre de usuario. Revisa que el fichero sea una pagina de AWA.');
  process.exit(1);
}
let nUser = 0;
if (usuario) {
  const re = new RegExp(usuario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  nUser = (s.match(re) || []).length;
  s = s.replace(re, 'usuario');
}
cuentas.push(['nombre de usuario', nUser]);

// El uuid del usuario, tambien por valor: aparece en la variable, en URLs y dentro del JWT.
let nUuid = 0;
if (uuid) {
  const re = new RegExp(uuid, 'gi');
  nUuid = (s.match(re) || []).length;
  s = s.replace(re, 'REDACTADO-UUID');
}
cuentas.push(['uuid del usuario', nUuid]);

let nId = 0;
if (userId) {
  const re = new RegExp('\\b' + userId + '\\b', 'g');
  nId = (s.match(re) || []).length;
  s = s.replace(re, '0');
}
cuentas.push(['user_id (en variable y URLs)', nId]);

const cabecera =
  `<!-- Volcado de alienwarearena.com (view-source / outerHTML), sesion iniciada.\n` +
  (nota ? `     ${nota.split('\n').join('\n     ')}\n` : '') +
  `     Saneado: JWT, uuid, user_id, login_id, _csrf_token, api_key de Weglot, tokens de anuncio\n` +
  `     y nombre de usuario. steamId enmascarado conservando los 17 digitos (lo que importa es\n` +
  `     que no sea 0, ver dom-steam-quest-2026-08.html, sin vincular).\n` +
  `     Recortado: bloques <style> inline y <noscript>. -->\n`;

s = cabecera + s;
fs.writeFileSync(salida, s);

// --- Verificacion: si algo conocido sobrevive, esto falla en vez de callar.
//
// Cada patron apunta a UN dato que no debe sobrevivir, no a su forma generica. La primera version
// buscaba "cualquier uuid" y "cualquier SteamID", y con un fixture de control salto en falso dos
// veces: marcaba el `giveaway_uuid` y la sitekey de hCaptcha —constantes publicas de la pagina que
// se conservan a proposito— y marcaba tambien el propio 76561190000000000 de la mascara. Un
// verificador que grita siempre es un verificador que se acaba ignorando.
const MASCARA_STEAM = '76561190000000000';
const sospechas = [
  // La verificacion va por forma y no por contexto, a proposito: es la red de seguridad, y su
  // trabajo es cazar justo las variantes que a la redaccion se le escapan.
  ['JWT de sesion',  /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['user_uuid',      uuid ? new RegExp(uuid, 'i') : /$^/],
  ['user_id',        userId ? new RegExp('\\b' + userId + '\\b') : /var user_id\s*=\s*[1-9]/],
  // Red de seguridad por si el id se cuela en una URL con una forma no prevista.
  ['id en URL',      /\/(?:ucf\/user|esi\/member\/[a-z-]+)\/\d{4,}/],
  ['login_id',       /var login_id\s*=\s*[1-9]/],
  ['SteamID real',   new RegExp('(?!' + MASCARA_STEAM + ')\\b7656119(?!0000000000\\b)\\d{10}\\b')],
  ['api_key Weglot', /wg_[0-9a-f]{20,}/],
  ['_csrf_token',    /name="_csrf_token"[^>]*?value="(?!REDACTADO)[^"]+"/],
  ['token de anuncio', /token:\s*'[A-Za-z0-9]{2,}\.[A-Za-z0-9_-]{20,}\./],
  ['clave de juego',  /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/],
];
const restos = sospechas.filter(([, re]) => re.test(s));

for (const [n, c] of cuentas) console.log(`  ${String(c).padStart(3)}  ${n}`);
console.log(`  bytes ${bytesAntes} -> ${s.length}  =>  ${salida}`);

if (restos.length) {
  console.error('\nFALLO: quedan restos sin sanear: ' + restos.map(([n]) => n).join(', '));
  console.error('No dejes el fichero en docs/ hasta arreglar el patron que se ha escapado.');
  process.exit(1);
}
console.log('\nVerificado: no queda ningun identificador conocido.');
if (salida !== entrada) console.log(`Recuerda borrar el crudo:  rm "${entrada}"`);
