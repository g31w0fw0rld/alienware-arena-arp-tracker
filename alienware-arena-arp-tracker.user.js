// ==UserScript==
// @name         Alienware Arena ARP Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Panel de ARP para Alienware Arena. En cualquier página muestra lo que caduca y cuándo: tiempo en el sitio y Twitch a las 00:00 UTC, quests diarias de un solo uso, las de Steam de lunes a lunes, Discord solo en laborables, el calendario de campaña y las fichas del pase, que se borran al cerrar la temporada. En un sorteo dice si hay claves para tu país y nivel antes de pulsar nada; en el Marketplace y la Bóveda marca cada tarjeta. Avisa antes del reinicio. Ocho idiomas. Solo lee: no reclama nada.
// @match        https://www.alienwarearena.com/*
// @match        https://na.alienwarearena.com/*
// @author       g31w0fw0rld
// @license      MIT
// @downloadURL  https://github.com/g31w0fw0rld/alienware-arena-arp-tracker/raw/main/alienware-arena-arp-tracker.user.js
// @updateURL    https://github.com/g31w0fw0rld/alienware-arena-arp-tracker/raw/main/alienware-arena-arp-tracker.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.0.0';

    // ------------------------------------------------------------------
    // Idiomas
    // ------------------------------------------------------------------
    // Alienware Arena se traduce a ocho idiomas con Weglot, así que el script
    // habla los mismos ocho. El orden para decidir cuál usar es:
    //
    //   1. lo que el usuario haya elegido en el panel,
    //   2. el idioma que el usuario ya eligió EN EL SITIO,
    //   3. navigator.languages.
    //
    // El paso 2 parece contradecir la regla de «no leer el lang del documento»,
    // y no lo hace: esa regla vale para ADIVINAR la preferencia, porque ese lang
    // refleja la interfaz del sitio. Pero si el usuario ha tocado el selector de
    // AWA, ese lang ES su elección explícita, y seguirla es lo correcto.
    const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'br', 'zh', 'hi'];
    const LANG_PREF_KEY = 'awa-arp-lang';

    function readLangPref() {
        try { const v = localStorage.getItem(LANG_PREF_KEY); return LANGS.indexOf(v) >= 0 ? v : ''; }
        catch (e) { return ''; }
    }

    function saveLangPref(v) {
        try {
            if (LANGS.indexOf(v) >= 0) localStorage.setItem(LANG_PREF_KEY, v);
            else localStorage.removeItem(LANG_PREF_KEY);
        } catch (e) { /* almacenamiento no disponible */ }
    }

    // Tres fuentes, en este orden, y el orden importa:
    //
    //   1. La API del propio Weglot, que es la única que SIEMPRE dice la verdad.
    //   2. Su selector, que marca la elección vigente con `.wgcurrent[data-l]`.
    //   3. El `lang` del <html>, que es el último recurso y el que engaña.
    //
    // El paso 3 engaña porque **el idioma del documento lo decide Weglot en tiempo
    // de ejecución**: el servidor puede servir la página en el idioma ORIGEN
    // —inglés— y dejar que Weglot aplique después la preferencia del usuario. Se
    // ve comparando volcados: los de `view-source` traen `lang="es"`, y el del DOM
    // ya renderizado trae `lang="en"` con el switcher de Weglot inyectado dentro
    // de `#weglot-switcher-1`. Leyendo al arrancar se lee el estado de ENTRADA, no
    // la elección del usuario, y el panel salía en inglés con el sitio en español.
    // Por eso el idioma no se decide una sola vez: se vigila (ver boot).
    function siteLang() {
        let fromApi = '';
        try {
            const wg = pageWindow().Weglot;
            if (wg && typeof wg.getCurrentLang === 'function') fromApi = wg.getCurrentLang() || '';
        } catch (e) { /* Weglot aún no está */ }
        const cur = document.querySelector('#weglot-switcher-1 .wg-li.wgcurrent[data-l], .weglot_switcher .wgcurrent[data-l], .wgcurrent[data-l]');
        const fromSwitcher = cur && cur.getAttribute('data-l');
        const fromHtml = document.documentElement.getAttribute('lang');
        const code = (fromApi || fromSwitcher || fromHtml || '').toLowerCase().split('-')[0];
        return LANGS.indexOf(code) >= 0 ? code : '';
    }

    function idiomaVigente() {
        return readLangPref() || siteLang() || detectLang();
    }

    function detectLang() {
        const langs = navigator.languages && navigator.languages.length
            ? navigator.languages
            : [navigator.language || 'en'];
        for (const l of langs) {
            const code = String(l).toLowerCase().split('-')[0];
            if (LANGS.indexOf(code) >= 0) return code;
        }
        return 'en';
    }

    let LANG = idiomaVigente();

    // Los ocho idiomas llevan TODAS las claves. Una clave ausente cae al inglés
    // por el operador de abajo, pero eso es una red de seguridad, no un plan:
    // dejar huecos a propósito es lo que hace que un script «multiidioma» esté
    // medio en inglés sin que se note.
    const I18N = {
        en: {
            goCC: 'Click this line to go to the Control Center.', goPass: 'Click this line to go to the Battle Pass.', goStore: 'Click this line to go to the Battle Store.',
            goDiscord: 'Click this line to open Alienware’s Discord server in a NEW TAB. It goes straight to the server, so you need to be a member of it already.',
            aviMudo: 'You can turn these warnings off with the box at the bottom of the panel, or mark this one as seen by clicking its band there.', aviday: 'The day is ending', aviweek: 'The Steam week is ending', avidawn: 'A new day has started', aviSeen: 'Mark as seen',
            title: 'ARP today', balance: '{v} ARP', tier: 'Tier {n}', streak: 'Day {n} streak', streakOf: 'Streak {v}/{c}', monthOf: 'Days {v}/{c}',
            tos: 'Time on site', twitch: 'Twitch', qDaily: 'Daily quests', qSteam: 'Steam quests',
            calendar: 'Campaign calendar', done: 'done',
            ofCap: '{v}/{c}', dailyReset: 'Day resets in {v}', weekReset: 'Steam week: {v}',
            noData: 'Could not read the Control Center', more: 'Learn more', close: 'Close',
            langLabel: 'Language', auto: 'Automatic (site)', move: 'Move panel',
            refresh: 'Refresh now', tipRefresh: 'Reads everything again, ignoring the cache. On its own it refreshes every 15 minutes, but only while this tab is in view, and only once for the whole browser.',
            alertOn: 'Warn me before the reset', tipTos: 'Simply being on the site pays ARP up to a daily cap. It resets at 00:00 UTC.',
            tipTwitch: 'The site does state this cap, in its FAQ: up to 15 ARP a day. It is paid 1 at a time.',
            tipTwitchZero: 'Watching alone earns nothing: the AWA widget must be active on a Hive or Nexus channel, with your Twitch account linked.',
            tipDaily: 'Single use: a daily quest never comes back. When its window ends it disappears, done or not.',
            tipSteam: 'These run Monday to Monday, not daily, and the site takes up to an hour to see your playtime — and to see a game you just added.',
            tipCalendar: 'This is the CAMPAIGN calendar, the one with an «Get item» button per day. It is claimed from the CAMPAIGN ICON UP IN THE TOP BAR, just left of the notifications bell —its picture changes with every campaign, so it is not always the same logo— and clicking this line opens it. It is not the daily login one: the 7-day streak and the 28-day calendar pay themselves when you come in, and you can see both next to your tier. Claiming goes through a captcha, so the script never does it for you.',
            tipReset: 'Alienware Arena starts its day at 00:00 UTC. Everything above is lost at that moment.',
            keysFor: '{n} keys for your country at tier {t}', keysNone: 'No keys for your country ({c})',
            keysTier: 'Keys only from tier {t} — you are tier {u}',
            tipKeys: 'Read from the giveaway’s own per-country, per-tier stock, before pressing anything.',
            afford: 'You can afford this', short: '{v} ARP short', tierShort: 'Needs tier {t}', soldOut: 'Sold out', bidFrom: 'Bid from {v} ARP', bidOpen: 'Auction open', bidOver: 'Auction over', tipAuction: 'A blind auction is not a purchase: you place ONE bid and only the highest ones win, so the panel shows the entry price and not what it will end up costing. In the Dinoblade auction the entry was 100 ARP and the ten winning bids ran from 7,000 to 8,500. The site marks these cards as out of stock even while they are open, which is why they are read apart from the rest.',
            mTitle: 'What this panel reads', mIntro: 'Everything here is read from the page. The script never claims, bids or enters anything: those all go through a captcha, and doing them by script is what gets accounts banned.',
            mDaily: 'Resets at 00:00 UTC: time on site, Twitch, the calendar day and the login streak. That hour comes from the site’s own code, not from a guess.',
            mQuests: 'Quests do not reset. Each one is single use with its own window: the daily ones vanish when it ends, and the Steam ones run Monday to Monday.',
            mTwitch: 'Twitch ARP needs the AWA widget active on a Hive or Nexus channel. A zero here does not prove the widget is off — it also reads zero before you watch anything.',
            mLate: 'Steam is slow on purpose: playtime and game ownership can take up to an hour to register, so a red state may just be out of date.',
            mVersion: 'Version {v}',
            discord: 'Discord', tipDiscord: 'The site says Discord pays for two things — the polls and the «Arena Adventures» — and states no amount for either. The 5 here is what a day has been seen to pay; if a day pays more, this line shows it. There is no counter for it anywhere on the site, so it is read from your own ARP log, filtered to today. It only pays MONDAY TO FRIDAY: at the weekend the line goes quiet instead of asking you for something you cannot do.',
            store: 'Battle Store', storePack: '{a} ARP for {f}', storeShort: '{n} tokens short', qPass: 'Battle Pass', passNone: 'not started', passClosed: 'season over', passClaim: '{n} to claim',
            tipPass: 'The pass advances with ARP from any source, milestone by milestone, and it has to be STARTED by hand when a season opens. Unclaimed milestones are handed out at the end of the season, but the battle tokens are wiped: those are the ones with a deadline.',
            tipStore: 'The Battle Store swaps Battle Tokens for ARP at a fixed rate — 25 tokens for 100 ARP, 45 for 200, 90 for 500 — and this line shows the best pack your tokens already reach. It matters because the tokens are WIPED when the season closes, so they are ARP with an expiry date. It is deliberately not amber: it does not run out today, so it never feeds the end-of-day warning.',
            fold: 'Fold the panel', tipAcct: 'Your balance, tier and the two login counts. The streak of 7 and the calendar of 28 are NOT the same number, and neither one is the day of the month: the streak breaks if you miss a day, while the calendar counts the days you have logged in, whenever they fall. The site says so itself — its rewards go by total login days, not by the date. So you can be on streak day 1 with 8 days logged in. Both only exist in the Control Center, so on other pages they arrive a moment later.',
            tipAlert: 'Three warnings: thirty minutes before the day ends if anything of the day is still pending; SIX hours before the Steam week ends if any of those is unfinished —those take playing, not clicking—; and when the new day starts, to get going — that one greets you WHENEVER you come in, not only at midnight, and stays quiet only in the last half hour, when it would contradict the other. Each one marks the tab —a 👽 on the title and on the favicon— and leaves a band in the panel; those stay until you mark them as seen. There is also a DIALOG you have to close, but never in a background tab: the browser swallows those without showing them, so it waits until you come back. There is no sound: the browser refuses to play one on this site, see the script information. Switching this box off and on again FORGETS everything already marked, so the warnings come back.',
            tipLang: 'Automatic follows the language you picked on Alienware Arena.',
            tipNoData: 'The daily counters live in the Control Center. If the request fails, the panel says so instead of showing zeros that would look like «nothing pending».',
            tipTag: 'It costs {p} ARP and you have {b}.',
            infoTitle: 'Script information', infoName: 'Name:', infoVersion: 'Version:',
            infoAuthor: 'Author:', infoGitHub: 'GitHub:', infoDescription: 'Description:',
            infoPrivacy: 'Privacy:', accept: 'Accept', info: 'Information',
            infoDescriptionText: 'Shows what expires and when: time on site and Twitch reset at 00:00 UTC, daily quests are single use and never come back, Steam quests run Monday to Monday, and the campaign calendar has a day waiting. Discord only pays Monday to Friday, so at the weekend that line goes quiet instead of asking. And the Battle Pass tokens are wiped when the season closes, so the panel says what yours are worth in ARP right now. Each line says in its tooltip which clock it answers to, and two countdowns —the day and the Steam week— are redrawn on their own. On a giveaway page it reads the giveaway’s own per-country, per-tier stock and says whether there are keys for you before you press anything. In the Marketplace and the Vault it marks every card with what you can afford, what needs a higher tier and what is sold out. It can also warn you three times —before the day ends, six hours before the Steam week ends, and when the new day starts— with a dialog you have to close. There is no sound: it was tried three ways on this site and the browser blocks it every time, while the very same code does play on other sites; from inside the page there is nothing left to fix. A dialog, the 👽 mark on the tab and a band in the panel do reach you, and none of them needs a permission we do not have. It re-reads on its own every 15 minutes, and the ⟳ button re-reads everything right away. It only reads: it never claims, bids or enters anything, because all of that goes through a captcha.',
            infoPrivacyText: 'Your settings —language, panel corner, the warning— stay in your browser only. The script reads the page you are on and, at most, asks the site once for your own Control Center, reusing your session. No third parties, and nothing is sent to the script author.',
        },
        es: {
            goCC: 'Pulsa esta línea para ir al Centro de control.', goPass: 'Pulsa esta línea para ir al pase de batalla.', goStore: 'Pulsa esta línea para ir a la tienda de batalla.',
            goDiscord: 'Pulsa esta línea para abrir el servidor de Discord de Alienware en una PESTAÑA NUEVA. Va directo al servidor, así que hay que ser miembro ya.',
            aviMudo: 'Puedes desactivar estos avisos con la casilla del pie del panel, o marcar este como visto pulsando su banda ahí mismo.', aviday: 'Se acaba el día', aviweek: 'Se acaba la semana de Steam', avidawn: 'Empieza un día nuevo', aviSeen: 'Marcar como visto',
            title: 'ARP de hoy', balance: '{v} ARP', tier: 'Nivel {n}', streak: 'Racha día {n}', streakOf: 'Racha {v}/{c}', monthOf: 'Días {v}/{c}',
            tos: 'Tiempo en el sitio', twitch: 'Twitch', qDaily: 'Quests diarias', qSteam: 'Quests de Steam',
            calendar: 'Calendario de campaña', done: 'hecho',
            ofCap: '{v}/{c}', dailyReset: 'El día reinicia en {v}', weekReset: 'Semana de Steam: {v}',
            noData: 'No se pudo leer el Centro de control', more: 'Saber más', close: 'Cerrar',
            langLabel: 'Idioma', auto: 'Automático (el del sitio)', move: 'Mover el panel',
            refresh: 'Actualizar ahora', tipRefresh: 'Vuelve a leerlo todo, saltándose la caché. Solo se refresca cada 15 minutos mientras miras esta pestaña, y una vez para todo el navegador.',
            alertOn: 'Avisarme antes del reinicio', tipTos: 'Estar en el sitio ya paga ARP, hasta un tope diario. Se reinicia a las 00:00 UTC.',
            tipTwitch: 'El tope lo dice el propio sitio en su FAQ: hasta 15 ARP al día. Se paga de uno en uno.',
            tipTwitchZero: 'Verlo no basta: el widget de AWA tiene que estar activo en un canal de Hive o Nexus, y con tu cuenta de Twitch vinculada.',
            tipDaily: 'De un solo uso: una quest diaria no vuelve. Al acabar su ventana desaparece, hecha o sin hacer.',
            tipSteam: 'Estas van de lunes a lunes, no por días, y el sitio tarda hasta una hora en ver lo que jugaste —y en ver un juego que acabas de añadir—.',
            tipCalendar: 'Este es el calendario de CAMPAÑA, el que tiene un botón «Obtener artículo» por día. Se cobra en el ICONO DE LA CAMPAÑA DE LA BARRA DE ARRIBA, justo a la izquierda de la campana de avisos —su dibujo cambia con cada campaña, así que no siempre es el mismo logo— y pulsando esta línea se abre. No es el de entrar cada día: la racha de 7 y el calendario de 28 se pagan solos al entrar, y los dos se ven al lado de tu nivel. Reclamar pasa por un captcha, así que el script no lo hace por ti.',
            tipReset: 'Alienware Arena empieza su día a las 00:00 UTC. Todo lo de arriba se pierde en ese momento.',
            keysFor: '{n} claves para tu país en el nivel {t}', keysNone: 'Sin claves para tu país ({c})',
            keysTier: 'Claves solo desde el nivel {t} — tú eres nivel {u}',
            tipKeys: 'Leído del inventario por país y por nivel del propio sorteo, antes de pulsar nada.',
            afford: 'Te alcanza', short: 'te faltan {v} ARP', tierShort: 'Pide nivel {t}', soldOut: 'Agotado', bidFrom: 'Puja desde {v} ARP', bidOpen: 'Subasta abierta', bidOver: 'Subasta terminada', tipAuction: 'Una subasta a ciegas no es una compra: pones UNA puja y solo ganan las más altas, así que el panel enseña la entrada y no lo que va a acabar costando. En la de Dinoblade la entrada eran 100 ARP y las diez ganadoras fueron de 7.000 a 8.500. El sitio marca estas tarjetas como agotadas incluso con la subasta abierta, y por eso se leen aparte de las demás.',
            mTitle: 'Qué lee este panel', mIntro: 'Todo lo de aquí se lee de la página. El script no reclama, no puja y no participa en nada: todo eso pasa por un captcha, y hacerlo por script es lo que hace que baneen cuentas.',
            mDaily: 'Se reinician a las 00:00 UTC: el tiempo en el sitio, Twitch, el día del calendario y la racha de login. Esa hora sale del código del propio sitio, no de una suposición.',
            mQuests: 'Las quests no se reinician. Cada una es de un solo uso con su ventana: las diarias desaparecen al acabarla, y las de Steam van de lunes a lunes.',
            mTwitch: 'El ARP de Twitch necesita el widget de AWA activo en un canal de Hive o Nexus. Un cero aquí no demuestra que esté apagado: también marca cero antes de que veas nada.',
            mLate: 'Steam va con retraso por diseño: el tiempo jugado y la propiedad de un juego tardan hasta una hora en registrarse, así que un estado en rojo puede ser solo un dato viejo.',
            mVersion: 'Versión {v}',
            discord: 'Discord', tipDiscord: 'El sitio dice que Discord paga por dos cosas —las encuestas y las «Arena Adventures»— y no publica el importe de ninguna. Los 5 de aquí son lo que se ha visto pagar en un día; si un día paga más, la línea lo enseña. No hay contador para esto en ninguna parte del sitio, así que se lee de tu propio registro de ARP, filtrado a hoy. Solo paga de LUNES A VIERNES: el fin de semana la línea se calla en vez de pedirte algo que no se puede hacer.',
            store: 'Tienda de batalla', storePack: '{a} ARP por {f}', storeShort: 'faltan {n} fichas', qPass: 'Pase de batalla', passNone: 'sin empezar', passClosed: 'temporada cerrada', passClaim: '{n} por reclamar',
            tipPass: 'El pase avanza con ARP de cualquier fuente, hito a hito, y hay que EMPEZARLO a mano cuando abre una temporada. Los hitos sin reclamar se entregan al cerrar, pero las fichas de batalla se borran: esas son las que tienen prisa.',
            tipStore: 'La Tienda de Batalla cambia fichas por ARP a precio fijo —25 fichas por 100 ARP, 45 por 200, 90 por 500— y esta línea enseña el mejor paquete que ya alcanzan tus fichas. Importa porque las fichas SE BORRAN al cerrar la temporada, así que son ARP con fecha de caducidad. No sale en amarillo a propósito: no vence hoy, así que nunca alimenta el aviso de fin de día.',
            fold: 'Plegar el panel', tipAcct: 'Tu saldo, tu nivel y las dos cuentas de inicio de sesión. La racha de 7 y el calendario de 28 NO son el mismo número, y ninguno es el día del mes: la racha se rompe si fallas un día, mientras que el calendario cuenta los días que has entrado, caigan cuando caigan. Lo dice el propio sitio: sus recompensas van por días de conexión acumulados, no por la fecha. Así que puedes ir por el día 1 de racha con 8 días entrados. Los dos solo están en el Centro de control, así que en otras páginas llegan un momento después.',
            tipAlert: 'Tres avisos: media hora antes de que acabe el día si queda algo del día por hacer; SEIS horas antes de que acabe la semana de Steam si queda alguna sin hacer —esas se cumplen jugando, no pulsando—; y al empezar el día nuevo, para arrancar —ese te saluda ENTRES CUANDO ENTRES, no solo a medianoche, y solo se calla la última media hora, cuando diría lo contrario que el otro—. Cada uno marca la pestaña —un 👽 en el título y en el favicon— y deja una banda en el panel; esas se quedan hasta que las marcas como vistas. Hay además un DIÁLOGO que hay que cerrar, pero nunca en una pestaña de fondo: esos el navegador se los queda sin enseñarlos, así que espera a que vuelvas. No hay sonido: el navegador se niega a reproducirlo en este sitio, lo cuenta la información del script. Apagar y encender esta casilla OLVIDA todo lo ya marcado, así que los avisos vuelven.',
            tipLang: 'El automático sigue al idioma que elegiste en Alienware Arena.',
            tipNoData: 'Los contadores del día viven en el Centro de control. Si la petición falla, el panel lo dice en vez de enseñar ceros, que se leerían como «no queda nada».',
            tipTag: 'Cuesta {p} ARP y tienes {b}.',
            infoTitle: 'Información del script', infoName: 'Nombre:', infoVersion: 'Versión:',
            infoAuthor: 'Autor:', infoGitHub: 'GitHub:', infoDescription: 'Descripción:',
            infoPrivacy: 'Privacidad:', accept: 'Aceptar', info: 'Información',
            infoDescriptionText: 'Enseña qué caduca y cuándo: el tiempo en el sitio y Twitch se reinician a las 00:00 UTC, las quests diarias son de un solo uso y no vuelven, las de Steam van de lunes a lunes, y el calendario de campaña puede tener un día esperando. Discord solo paga de lunes a viernes, así que el fin de semana esa línea se calla en vez de pedirlo. Y las fichas del pase se borran al cerrar la temporada, así que el panel dice cuánto ARP valen las tuyas ahora mismo. Cada línea dice en su tooltip a qué reloj responde, y dos cuentas atrás —el día y la semana de Steam— se repintan solas. En la ficha de un sorteo lee el inventario por país y por nivel del propio sorteo y dice si hay claves para ti antes de pulsar nada. En el Marketplace y la Bóveda marca cada tarjeta con lo que te alcanza, lo que pide más nivel y lo que está agotado. También puede avisarte tres veces —antes de que acabe el día, seis horas antes de que acabe la semana de Steam, y al empezar el día nuevo— con un diálogo que hay que cerrar. No hay sonido: se intentó de tres maneras en este sitio y el navegador lo bloquea siempre, mientras que ese mismo código sí suena en otros; desde dentro de la página no queda nada que arreglar. Un diálogo, la marca 👽 en la pestaña y una banda en el panel sí te alcanzan, y ninguno depende de un permiso que no tenemos. Se relee solo cada 15 minutos, y el botón ⟳ vuelve a leerlo todo al instante. Solo lee: no reclama, no puja y no participa en nada, porque todo eso pasa por un captcha.',
            infoPrivacyText: 'Tus ajustes —idioma, esquina del panel, el aviso— se guardan solo en tu navegador. El script lee la página en la que estás y, como mucho, le pide al sitio una vez tu propio Centro de control, reusando tu sesión. No hay terceros y no se envía nada al autor del script.',
        },
        de: {
            goCC: 'Klicke auf diese Zeile, um zum Control Center zu gehen.', goPass: 'Klicke auf diese Zeile, um zum Battle Pass zu gehen.', goStore: 'Klicke auf diese Zeile, um zum Battle Store zu gehen.',
            goDiscord: 'Klicke auf diese Zeile, um Alienwares Discord-Server in einem NEUEN TAB zu öffnen. Er führt direkt auf den Server, du musst also schon Mitglied sein.',
            aviMudo: 'Du kannst diese Warnungen mit dem Kästchen unten im Panel abschalten oder diese hier als gesehen markieren, indem du dort auf ihr Band klickst.', aviday: 'Der Tag geht zu Ende', aviweek: 'Die Steam-Woche geht zu Ende', avidawn: 'Ein neuer Tag hat begonnen', aviSeen: 'Als gesehen markieren',
            title: 'ARP heute', balance: '{v} ARP', tier: 'Stufe {n}', streak: 'Tag {n} in Folge', streakOf: 'Serie {v}/{c}', monthOf: 'Tage {v}/{c}',
            tos: 'Zeit auf der Seite', twitch: 'Twitch', qDaily: 'Tagesquests', qSteam: 'Steam-Quests',
            calendar: 'Kampagnen-Kalender', done: 'erledigt',
            ofCap: '{v}/{c}', dailyReset: 'Tag endet in {v}', weekReset: 'Steam-Woche: {v}',
            noData: 'Control Center konnte nicht gelesen werden', more: 'Mehr erfahren', close: 'Schließen',
            langLabel: 'Sprache', auto: 'Automatisch (Seite)', move: 'Panel verschieben',
            refresh: 'Jetzt aktualisieren', tipRefresh: 'Liest alles neu ein, am Cache vorbei. Von selbst nur alle 15 Minuten, nur solange dieser Tab sichtbar ist, und einmal für den ganzen Browser.',
            alertOn: 'Vor dem Reset warnen', tipTos: 'Schon das Verweilen auf der Seite bringt ARP, bis zu einem Tageslimit. Reset um 00:00 UTC.',
            tipTwitch: 'Die Seite nennt dieses Limit selbst, in ihren FAQ: bis zu 15 ARP pro Tag. Ausgezahlt wird in 1er-Schritten.',
            tipTwitchZero: 'Zuschauen allein bringt nichts: das AWA-Widget muss auf einem Hive- oder Nexus-Kanal aktiv sein, mit verknüpftem Twitch-Konto.',
            tipDaily: 'Einmalig: eine Tagesquest kommt nicht zurück. Endet ihr Zeitfenster, verschwindet sie — erledigt oder nicht.',
            tipSteam: 'Diese laufen von Montag zu Montag, nicht täglich, und die Seite braucht bis zu einer Stunde, um Spielzeit — oder ein neu gekauftes Spiel — zu sehen.',
            tipCalendar: 'Das ist der KAMPAGNEN-Kalender, der mit einer «Gegenstand holen»-Schaltfläche pro Tag. Abgeholt wird er über das KAMPAGNEN-SYMBOL OBEN IN DER LEISTE, direkt links von der Benachrichtigungsglocke —sein Bild wechselt mit jeder Kampagne, es ist also nicht immer dasselbe Logo— und ein Klick auf diese Zeile öffnet ihn. Nicht der fürs tägliche Einloggen: die 7-Tage-Serie und der 28-Tage-Kalender zahlen sich beim Hereinkommen von selbst, und beide stehen neben deiner Stufe. Das Abholen läuft über ein Captcha, das Skript macht es also nie für dich.',
            tipReset: 'Alienware Arena beginnt seinen Tag um 00:00 UTC. Alles oben verfällt in diesem Moment.',
            keysFor: '{n} Keys für dein Land auf Stufe {t}', keysNone: 'Keine Keys für dein Land ({c})',
            keysTier: 'Keys erst ab Stufe {t} — du hast Stufe {u}',
            tipKeys: 'Aus dem Bestand des Gewinnspiels nach Land und Stufe gelesen, ohne etwas anzuklicken.',
            afford: 'Kannst du dir leisten', short: '{v} ARP fehlen', tierShort: 'Braucht Stufe {t}', soldOut: 'Ausverkauft', bidFrom: 'Gebot ab {v} ARP', bidOpen: 'Auktion offen', bidOver: 'Auktion beendet', tipAuction: 'Eine Blindauktion ist kein Kauf: du gibst EIN Gebot ab und nur die höchsten gewinnen, also zeigt das Panel den Einstieg und nicht den Endpreis. Bei Dinoblade lag der Einstieg bei 100 ARP und die zehn Gewinngebote zwischen 7.000 und 8.500. Die Seite markiert diese Karten als ausverkauft, auch solange sie offen sind — deshalb werden sie getrennt gelesen.',
            mTitle: 'Was dieses Panel liest', mIntro: 'Alles hier wird von der Seite gelesen. Das Skript holt nichts ab, bietet nicht und nimmt an nichts teil: das läuft alles über ein Captcha, und per Skript ist es der Grund, warum Konten gesperrt werden.',
            mDaily: 'Reset um 00:00 UTC: Zeit auf der Seite, Twitch, der Kalendertag und die Login-Serie. Diese Uhrzeit stammt aus dem Code der Seite, nicht aus einer Vermutung.',
            mQuests: 'Quests werden nicht zurückgesetzt. Jede ist einmalig mit eigenem Zeitfenster: Tagesquests verschwinden am Ende, Steam-Quests laufen von Montag zu Montag.',
            mTwitch: 'Twitch-ARP braucht das aktive AWA-Widget auf einem Hive- oder Nexus-Kanal. Eine Null beweist nicht, dass es aus ist — sie steht auch da, bevor du etwas ansiehst.',
            mLate: 'Steam ist absichtlich langsam: Spielzeit und Spielbesitz brauchen bis zu einer Stunde, ein roter Status kann also nur veraltet sein.',
            mVersion: 'Version {v}',
            discord: 'Discord', tipDiscord: 'Laut Seite zahlt Discord für zwei Dinge — die Umfragen und die «Arena Adventures» — und nennt für keines einen Betrag. Die 5 hier sind das, was ein Tag bisher gebracht hat; bringt ein Tag mehr, zeigt die Zeile es. Einen Zähler dafür gibt es auf der Seite nirgends, also wird aus deinem eigenen ARP-Log gelesen, auf heute gefiltert. Es zahlt nur von MONTAG BIS FREITAG: am Wochenende schweigt die Zeile, statt dich um etwas Unmögliches zu bitten.',
            store: 'Battle Store', storePack: '{a} ARP für {f}', storeShort: '{n} Marken fehlen', qPass: 'Battle Pass', passNone: 'nicht gestartet', passClosed: 'Saison beendet', passClaim: '{n} abzuholen',
            tipPass: 'Der Pass läuft mit ARP aus jeder Quelle, Meilenstein für Meilenstein, und muss bei Saisonstart von Hand GESTARTET werden. Nicht abgeholte Meilensteine gibt es am Saisonende, die Battle-Token werden aber gelöscht: die haben es eilig.',
            tipStore: 'Der Battle Store tauscht Marken gegen ARP zu festen Preisen — 25 Marken für 100 ARP, 45 für 200, 90 für 500 — und diese Zeile zeigt das beste Paket, das deine Marken schon erreichen. Wichtig ist es, weil die Marken beim Saisonende GELÖSCHT werden: es sind ARP mit Verfallsdatum. Bewusst nicht gelb: es läuft nicht heute ab und speist deshalb nie die Tageswarnung.',
            fold: 'Panel einklappen', tipAcct: 'Dein Guthaben, deine Stufe und die zwei Login-Zähler. Die 7-Tage-Serie und der 28-Tage-Kalender sind NICHT dieselbe Zahl, und keine davon ist der Tag des Monats: die Serie reißt, wenn du einen Tag auslässt, während der Kalender die Tage zählt, an denen du dich angemeldet hast, wann immer sie liegen. Die Seite sagt es selbst — ihre Belohnungen richten sich nach den gesamten Login-Tagen, nicht nach dem Datum. Du kannst also bei Serientag 1 und 8 Login-Tagen stehen. Beide gibt es nur im Control Center, auf anderen Seiten kommen sie einen Moment später.',
            tipAlert: 'Drei Warnungen: dreißig Minuten vor Tagesende, wenn vom Tag noch etwas offen ist; SECHS Stunden vor Ende der Steam-Woche, wenn dort etwas offen ist —die erledigt man durch Spielen, nicht durch Klicken—; und wenn der neue Tag beginnt, zum Loslegen — die begrüßt dich, WANN IMMER du hereinschaust, nicht nur um Mitternacht, und schweigt nur in der letzten halben Stunde, wo sie der anderen widersprechen würde. Jede markiert den Tab —ein 👽 im Titel und im Favicon— und hinterlässt ein Band im Panel; beide bleiben, bis du sie als gesehen markierst. Dazu kommt ein DIALOG, den du schließen musst, aber nie in einem Hintergrund-Tab: die schluckt der Browser, ohne sie zu zeigen, also wartet er, bis du zurückkommst. Ton gibt es keinen: der Browser spielt auf dieser Seite keinen ab, siehe Skript-Informationen. Dieses Kästchen aus- und wieder einzuschalten VERGISST alles bereits Markierte, die Warnungen kommen also zurück.',
            tipLang: 'Automatisch folgt der Sprache, die du auf Alienware Arena gewählt hast.',
            tipNoData: 'Die Tageszähler stehen im Control Center. Scheitert die Abfrage, sagt das Panel es — statt Nullen zu zeigen, die wie «nichts offen» aussehen.',
            tipTag: 'Kostet {p} ARP, du hast {b}.',
            infoTitle: 'Skript-Informationen', infoName: 'Name:', infoVersion: 'Version:',
            infoAuthor: 'Autor:', infoGitHub: 'GitHub:', infoDescription: 'Beschreibung:',
            infoPrivacy: 'Datenschutz:', accept: 'Akzeptieren', info: 'Informationen',
            infoDescriptionText: 'Zeigt, was verfällt und wann: Zeit auf der Seite und Twitch werden um 00:00 UTC zurückgesetzt, Tagesquests sind einmalig und kommen nicht zurück, Steam-Quests laufen von Montag zu Montag, und im Kampagnenkalender wartet vielleicht ein Tag. Discord zahlt nur von Montag bis Freitag, am Wochenende schweigt diese Zeile also. Und die Marken des Battle Pass werden beim Saisonende gelöscht, deshalb sagt das Panel, wie viel ARP deine gerade wert sind. Jede Zeile nennt in ihrem Tooltip die zuständige Uhr, und zwei Countdowns —der Tag und die Steam-Woche— aktualisieren sich selbst. Auf einer Gewinnspielseite liest es den Bestand nach Land und Stufe und sagt, ob es Keys für dich gibt, bevor du etwas anklickst. Im Marketplace und im Vault markiert es jede Karte: leistbar, höhere Stufe nötig oder ausverkauft. Es kann dich außerdem dreimal warnen —vor Tagesende, sechs Stunden vor Ende der Steam-Woche und wenn der neue Tag beginnt— mit einem Dialog, den du schließen musst. Ton gibt es keinen: auf dieser Seite wurde es dreimal versucht und der Browser blockiert ihn jedes Mal, während derselbe Code auf anderen Seiten sehr wohl klingt; von der Seite aus lässt sich nichts mehr richten. Ein Dialog, die 👽-Markierung im Tab und ein Band im Panel erreichen dich, und keines davon braucht eine Erlaubnis, die wir nicht haben. Es liest sich alle 15 Minuten von selbst neu ein, und die Schaltfläche ⟳ liest sofort alles neu. Es liest nur: es holt nichts ab, bietet nicht und nimmt an nichts teil, denn das läuft alles über ein Captcha.',
            infoPrivacyText: 'Deine Einstellungen —Sprache, Panel-Ecke, die Warnung— bleiben nur in deinem Browser. Das Skript liest die Seite, auf der du bist, und fragt höchstens einmal dein eigenes Control Center ab, mit deiner bestehenden Sitzung. Keine Dritten, und an den Autor des Skripts wird nichts gesendet.',
        },
        fr: {
            goCC: 'Clique sur cette ligne pour aller au Centre de contrôle.', goPass: 'Clique sur cette ligne pour aller au pass de combat.', goStore: 'Clique sur cette ligne pour aller à la boutique de combat.',
            goDiscord: 'Clique sur cette ligne pour ouvrir le serveur Discord d’Alienware dans un NOUVEL ONGLET. Il mène droit au serveur : il faut donc déjà en être membre.',
            aviMudo: 'Tu peux désactiver ces alertes avec la case en bas du panneau, ou marquer celle-ci comme vue en cliquant sur son bandeau.', aviday: 'La journée se termine', aviweek: 'La semaine Steam se termine', avidawn: 'Un nouveau jour commence', aviSeen: 'Marquer comme vu',
            title: 'ARP du jour', balance: '{v} ARP', tier: 'Niveau {n}', streak: 'Série jour {n}', streakOf: 'Série {v}/{c}', monthOf: 'Jours {v}/{c}',
            tos: 'Temps sur le site', twitch: 'Twitch', qDaily: 'Quêtes du jour', qSteam: 'Quêtes Steam',
            calendar: 'Calendrier de campagne', done: 'fait',
            ofCap: '{v}/{c}', dailyReset: 'Le jour se réinitialise dans {v}', weekReset: 'Semaine Steam : {v}',
            noData: 'Impossible de lire le Centre de contrôle', more: 'En savoir plus', close: 'Fermer',
            langLabel: 'Langue', auto: 'Automatique (site)', move: 'Déplacer le panneau',
            refresh: 'Actualiser maintenant', tipRefresh: 'Relit tout, sans passer par le cache. Tout seul, il ne se rafraîchit que toutes les 15 minutes, uniquement si cet onglet est visible, et une seule fois pour tout le navigateur.',
            alertOn: 'M’avertir avant la réinitialisation', tipTos: 'Rester sur le site rapporte déjà de l’ARP, jusqu’à un plafond quotidien. Remise à zéro à 00:00 UTC.',
            tipTwitch: 'Le site annonce lui-même ce plafond, dans sa FAQ : jusqu’à 15 ARP par jour. Versés 1 par 1.',
            tipTwitchZero: 'Regarder ne suffit pas : le widget AWA doit être actif sur une chaîne Hive ou Nexus, avec ton compte Twitch lié.',
            tipDaily: 'Usage unique : une quête du jour ne revient pas. Sa fenêtre terminée, elle disparaît, faite ou non.',
            tipSteam: 'Celles-ci vont de lundi à lundi, pas au jour, et le site met jusqu’à une heure à voir ton temps de jeu — ou un jeu ajouté à l’instant.',
            tipCalendar: 'C’est le calendrier de CAMPAGNE, celui avec un bouton «Obtenir l’objet» par jour. Il se récupère depuis l’ICÔNE DE LA CAMPAGNE EN HAUT DANS LA BARRE, juste à gauche de la cloche de notifications —son image change à chaque campagne, ce n’est donc pas toujours le même logo— et un clic sur cette ligne l’ouvre. Ce n’est pas celui de la connexion quotidienne : la série de 7 jours et le calendrier de 28 jours se paient tout seuls à l’arrivée, et les deux s’affichent à côté de ton niveau. La récupération passe par un captcha : le script ne la fait jamais à ta place.',
            tipReset: 'Alienware Arena commence sa journée à 00:00 UTC. Tout ce qui est au-dessus est perdu à ce moment-là.',
            keysFor: '{n} clés pour ton pays au niveau {t}', keysNone: 'Aucune clé pour ton pays ({c})',
            keysTier: 'Clés seulement à partir du niveau {t} — tu es niveau {u}',
            tipKeys: 'Lu dans le stock par pays et par niveau du tirage lui-même, sans rien cliquer.',
            afford: 'Tu peux te le permettre', short: 'il manque {v} ARP', tierShort: 'Demande le niveau {t}', soldOut: 'Épuisé', bidFrom: 'Enchère dès {v} ARP', bidOpen: 'Enchère ouverte', bidOver: 'Enchère terminée', tipAuction: 'Une enchère à l’aveugle n’est pas un achat : tu poses UNE enchère et seules les plus hautes gagnent, donc le panneau affiche l’entrée et non le prix final. Pour Dinoblade l’entrée était à 100 ARP et les dix enchères gagnantes allaient de 7 000 à 8 500. Le site marque ces cartes comme épuisées même quand elles sont ouvertes ; c’est pourquoi elles sont lues à part.',
            mTitle: 'Ce que lit ce panneau', mIntro: 'Tout ici est lu depuis la page. Le script ne récupère rien, n’enchérit pas et ne participe à rien : tout cela passe par un captcha, et le faire par script est ce qui fait bannir des comptes.',
            mDaily: 'Réinitialisation à 00:00 UTC : temps sur le site, Twitch, le jour du calendrier et la série de connexions. Cette heure vient du code du site, pas d’une supposition.',
            mQuests: 'Les quêtes ne se réinitialisent pas. Chacune est à usage unique avec sa fenêtre : celles du jour disparaissent à la fin, celles de Steam vont de lundi à lundi.',
            mTwitch: 'L’ARP Twitch exige le widget AWA actif sur une chaîne Hive ou Nexus. Un zéro ne prouve pas qu’il est éteint : il affiche zéro aussi avant que tu ne regardes quoi que ce soit.',
            mLate: 'Steam est lent par conception : le temps de jeu et la possession d’un jeu mettent jusqu’à une heure à être pris en compte, un état rouge peut n’être qu’une donnée périmée.',
            mVersion: 'Version {v}',
            discord: 'Discord', tipDiscord: 'Le site dit que Discord paie pour deux choses — les sondages et les «Arena Adventures» — et n’annonce le montant d’aucune. Le 5 ici est ce qu’une journée a rapporté jusqu’ici ; si une journée rapporte plus, la ligne l’affiche. Il n’y a de compteur pour ça nulle part sur le site, donc c’est lu depuis ton propre journal d’ARP, filtré sur aujourd’hui. Ça ne paie que du LUNDI AU VENDREDI : le week-end, la ligne se tait au lieu de te demander l’impossible.',
            store: 'Boutique de combat', storePack: '{a} ARP pour {f}', storeShort: 'il manque {n} jetons', qPass: 'Pass de combat', passNone: 'pas démarré', passClosed: 'saison terminée', passClaim: '{n} à récupérer',
            tipPass: 'Le pass avance avec l’ARP de n’importe quelle source, palier par palier, et il faut le DÉMARRER à la main quand une saison ouvre. Les paliers non récupérés sont remis à la fin, mais les jetons de combat sont effacés : ce sont eux qui pressent.',
            tipStore: 'La Boutique de combat échange des jetons contre des ARP à prix fixe — 25 jetons pour 100 ARP, 45 pour 200, 90 pour 500 — et cette ligne montre le meilleur lot que tes jetons atteignent déjà. C’est important parce que les jetons sont EFFACÉS à la fin de la saison : ce sont des ARP avec une date de péremption. Volontairement pas en jaune : ça n’expire pas aujourd’hui, donc ça n’alimente jamais l’alerte de fin de journée.',
            fold: 'Replier le panneau', tipAcct: 'Ton solde, ton niveau et les deux compteurs de connexion. La série de 7 et le calendrier de 28 ne sont PAS le même nombre, et aucun des deux n’est le jour du mois : la série se casse si tu sautes un jour, tandis que le calendrier compte les jours où tu t’es connecté, quels qu’ils soient. Le site le dit lui-même : ses récompenses suivent le total de jours de connexion, pas la date. Tu peux donc être au jour 1 de série avec 8 jours connectés. Les deux n’existent que dans le Centre de contrôle ; ailleurs ils arrivent un instant plus tard.',
            tipAlert: 'Trois alertes : trente minutes avant la fin du jour s’il reste quelque chose du jour ; SIX heures avant la fin de la semaine Steam s’il en reste une —celles-là se font en jouant, pas en cliquant— ; et au début du nouveau jour, pour s’y mettre — celle-là te salue QUAND QUE TU ARRIVES, pas seulement à minuit, et ne se tait que la dernière demi-heure, où elle dirait le contraire de l’autre. Chacune marque l’onglet —un 👽 dans le titre et dans le favicon— et laisse un bandeau dans le panneau ; ceux-là restent jusqu’à ce que tu les marques comme vus. Il y a aussi une BOÎTE DE DIALOGUE à fermer, mais jamais dans un onglet en arrière-plan : celles-là, le navigateur les avale sans les montrer, donc elle attend ton retour. Il n’y a pas de son : le navigateur refuse d’en jouer sur ce site, voir les informations du script. Décocher puis recocher cette case OUBLIE tout ce qui est déjà marqué, donc les alertes reviennent.',
            tipLang: 'Automatique suit la langue choisie sur Alienware Arena.',
            tipNoData: 'Les compteurs du jour vivent dans le Centre de contrôle. Si la requête échoue, le panneau le dit au lieu d’afficher des zéros qui se liraient «rien à faire».',
            tipTag: 'Coûte {p} ARP et tu en as {b}.',
            infoTitle: 'Informations du script', infoName: 'Nom :', infoVersion: 'Version :',
            infoAuthor: 'Auteur :', infoGitHub: 'GitHub :', infoDescription: 'Description :',
            infoPrivacy: 'Confidentialité :', accept: 'Accepter', info: 'Informations',
            infoDescriptionText: 'Montre ce qui expire et quand : le temps sur le site et Twitch se réinitialisent à 00:00 UTC, les quêtes du jour sont à usage unique et ne reviennent pas, celles de Steam vont de lundi à lundi, et le calendrier de campagne peut avoir un jour en attente. Discord ne paie que du lundi au vendredi : le week-end, cette ligne se tait au lieu de réclamer. Et les jetons du Pass de combat sont effacés à la fin de la saison, donc le panneau dit ce que les tiens valent en ARP maintenant. Chaque ligne indique dans son infobulle l’horloge dont elle dépend, et deux comptes à rebours —le jour et la semaine Steam— se rafraîchissent seuls. Sur la page d’un tirage, il lit le stock par pays et par niveau du tirage lui-même et dit s’il y a des clés pour toi avant de cliquer. Dans le Marketplace et le Vault, il marque chaque carte : à ta portée, niveau insuffisant ou épuisé. Il peut aussi t’avertir trois fois —avant la fin du jour, six heures avant la fin de la semaine Steam, et au début du nouveau jour— avec une boîte de dialogue à fermer. Il n’y a pas de son : trois approches ont été essayées sur ce site et le navigateur le bloque à chaque fois, alors que le même code fonctionne sur d’autres sites ; depuis la page, il n’y a plus rien à corriger. Une boîte de dialogue, la marque 👽 sur l’onglet et un bandeau dans le panneau, eux, te parviennent, et aucun ne dépend d’une permission que nous n’avons pas. Il se relit tout seul toutes les 15 minutes, et le bouton ⟳ relit tout immédiatement. Il ne fait que lire : il ne récupère rien, n’enchérit pas et ne participe à rien, car tout cela passe par un captcha.',
            infoPrivacyText: 'Tes réglages —langue, coin du panneau, l’alerte— restent uniquement dans ton navigateur. Le script lit la page où tu es et, au plus, demande une fois ton propre Centre de contrôle au site, en réutilisant ta session. Aucun tiers, et rien n’est envoyé à l’auteur du script.',
        },
        pt: {
            goCC: 'Prime esta linha para ires ao Centro de controlo.', goPass: 'Prime esta linha para ires ao passe de batalha.', goStore: 'Prime esta linha para ires à loja de batalha.',
            goDiscord: 'Prime esta linha para abrir o servidor de Discord da Alienware num SEPARADOR NOVO. Vai direto ao servidor, por isso já tens de ser membro dele.',
            aviMudo: 'Podes desativar estes avisos na caixa ao fundo do painel, ou marcar este como visto premindo a sua faixa aí mesmo.', aviday: 'O dia está a acabar', aviweek: 'A semana de Steam está a acabar', avidawn: 'Começou um dia novo', aviSeen: 'Marcar como visto',
            title: 'ARP de hoje', balance: '{v} ARP', tier: 'Nível {n}', streak: 'Sequência dia {n}', streakOf: 'Sequência {v}/{c}', monthOf: 'Dias {v}/{c}',
            tos: 'Tempo no site', twitch: 'Twitch', qDaily: 'Missões diárias', qSteam: 'Missões de Steam',
            calendar: 'Calendário de campanha', done: 'feito',
            ofCap: '{v}/{c}', dailyReset: 'O dia reinicia em {v}', weekReset: 'Semana de Steam: {v}',
            noData: 'Não foi possível ler o Centro de controlo', more: 'Saber mais', close: 'Fechar',
            langLabel: 'Idioma', auto: 'Automático (do site)', move: 'Mover o painel',
            refresh: 'Atualizar agora', tipRefresh: 'Volta a ler tudo, ignorando a cache. Sozinho só se atualiza a cada 15 minutos, apenas enquanto olhas para este separador, e uma vez para todo o navegador.',
            alertOn: 'Avisar-me antes do reinício', tipTos: 'Estar no site já dá ARP, até um limite diário. Reinicia às 00:00 UTC.',
            tipTwitch: 'O limite está na FAQ do próprio site: até 15 ARP por dia. São pagos 1 a 1.',
            tipTwitchZero: 'Ver não basta: o widget da AWA tem de estar ativo num canal Hive ou Nexus, com a tua conta Twitch ligada.',
            tipDaily: 'Uso único: uma missão diária não volta. Terminada a sua janela desaparece, feita ou não.',
            tipSteam: 'Estas vão de segunda a segunda, não por dias, e o site leva até uma hora a ver o que jogaste — e a ver um jogo que acabaste de adicionar.',
            tipCalendar: 'Este é o calendário de CAMPANHA, o que tem um botão «Obter artigo» por dia. Reclama-se no ÍCONE DA CAMPANHA LÁ EM CIMA NA BARRA, mesmo à esquerda da campainha de avisos —o seu desenho muda com cada campanha, por isso nem sempre é o mesmo logótipo— e premir esta linha abre-o. Não é o de entrar todos os dias: a sequência de 7 e o calendário de 28 pagam-se sozinhos ao entrares, e ambos aparecem ao lado do teu nível. Reclamar passa por um captcha, portanto o script nunca o faz por ti.',
            tipReset: 'A Alienware Arena começa o seu dia às 00:00 UTC. Tudo o que está acima perde-se nesse momento.',
            keysFor: '{n} chaves para o teu país no nível {t}', keysNone: 'Sem chaves para o teu país ({c})',
            keysTier: 'Chaves só a partir do nível {t} — tu és nível {u}',
            tipKeys: 'Lido do stock por país e por nível do próprio sorteio, antes de premir nada.',
            afford: 'Dá-te para isto', short: 'faltam-te {v} ARP', tierShort: 'Pede nível {t}', soldOut: 'Esgotado', bidFrom: 'Licitação desde {v} ARP', bidOpen: 'Leilão aberto', bidOver: 'Leilão terminado', tipAuction: 'Um leilão às cegas não é uma compra: fazes UMA licitação e só as mais altas ganham, por isso o painel mostra a entrada e não o que vai acabar por custar. No de Dinoblade a entrada eram 100 ARP e as dez vencedoras foram de 7.000 a 8.500. O site marca estas cartas como esgotadas mesmo com o leilão aberto, e por isso são lidas à parte.',
            mTitle: 'O que este painel lê', mIntro: 'Tudo aqui é lido da página. O script não reclama, não licita e não participa em nada: isso passa todo por um captcha, e fazê-lo por script é o que faz banir contas.',
            mDaily: 'Reiniciam às 00:00 UTC: o tempo no site, o Twitch, o dia do calendário e a sequência de login. Essa hora vem do código do próprio site, não de um palpite.',
            mQuests: 'As missões não reiniciam. Cada uma é de uso único com a sua janela: as diárias desaparecem no fim, e as de Steam vão de segunda a segunda.',
            mTwitch: 'O ARP do Twitch precisa do widget da AWA ativo num canal Hive ou Nexus. Um zero aqui não prova que esteja desligado: também marca zero antes de veres algo.',
            mLate: 'O Steam é lento por desenho: o tempo jogado e a posse de um jogo levam até uma hora a registar, logo um estado vermelho pode ser só um dado velho.',
            mVersion: 'Versão {v}',
            discord: 'Discord', tipDiscord: 'O site diz que o Discord paga por duas coisas —os inquéritos e as «Arena Adventures»— e não publica o valor de nenhuma. Os 5 daqui são o que se viu um dia pagar; se um dia pagar mais, a linha mostra-o. Não há contador para isto em lado nenhum do site, por isso lê-se do teu próprio registo de ARP, filtrado a hoje. Só paga de SEGUNDA A SEXTA: ao fim de semana a linha cala-se em vez de te pedir algo que não dá para fazer.',
            store: 'Loja de batalha', storePack: '{a} ARP por {f}', storeShort: 'faltam {n} fichas', qPass: 'Passe de batalha', passNone: 'por começar', passClosed: 'temporada fechada', passClaim: '{n} a reclamar',
            tipPass: 'O passe avança com ARP de qualquer fonte, marco a marco, e tem de ser INICIADO à mão quando abre uma temporada. Os marcos por reclamar são entregues no fim, mas as fichas de batalha são apagadas: essas é que têm pressa.',
            tipStore: 'A Loja de Batalha troca fichas por ARP a preço fixo —25 fichas por 100 ARP, 45 por 200, 90 por 500— e esta linha mostra o melhor pacote que as tuas fichas já alcançam. Importa porque as fichas SÃO APAGADAS ao fechar a temporada, por isso são ARP com prazo. De propósito não fica amarela: não vence hoje, logo nunca alimenta o aviso de fim de dia.',
            fold: 'Recolher o painel', tipAcct: 'O teu saldo, o teu nível e as duas contagens de login. A sequência de 7 e o calendário de 28 NÃO são o mesmo número, e nenhum deles é o dia do mês: a sequência quebra se falhares um dia, enquanto o calendário conta os dias em que entraste, caiam quando caírem. O próprio site o diz: as suas recompensas seguem o total de dias de ligação, não a data. Por isso podes ir no dia 1 de sequência com 8 dias entrados. Ambos só existem no Centro de controlo; noutras páginas chegam um momento depois.',
            tipAlert: 'Três avisos: meia hora antes de acabar o dia se ficar algo do dia por fazer; SEIS horas antes de acabar a semana de Steam se ficar alguma —essas cumprem-se a jogar, não a premir—; e ao começar o dia novo, para arrancar —esse cumprimenta-te ENTRES QUANDO ENTRARES, não só à meia-noite, e só se cala na última meia hora, quando diria o contrário do outro—. Cada um marca o separador —um 👽 no título e no favicon— e deixa uma faixa no painel; essas ficam até as marcares como vistas. Há ainda uma CAIXA DE DIÁLOGO que tens de fechar, mas nunca num separador em segundo plano: essas o navegador engole-as sem as mostrar, por isso espera que voltes. Não há som: o navegador recusa-se a tocá-lo neste site, di-lo a informação do script. Desligar e voltar a ligar esta caixa ESQUECE tudo o que já marcaste, portanto os avisos voltam.',
            tipLang: 'O automático segue o idioma que escolheste na Alienware Arena.',
            tipNoData: 'Os contadores do dia vivem no Centro de controlo. Se o pedido falhar, o painel di-lo em vez de mostrar zeros, que se leriam como «não falta nada».',
            tipTag: 'Custa {p} ARP e tens {b}.',
            infoTitle: 'Informação do script', infoName: 'Nome:', infoVersion: 'Versão:',
            infoAuthor: 'Autor:', infoGitHub: 'GitHub:', infoDescription: 'Descrição:',
            infoPrivacy: 'Privacidade:', accept: 'Aceitar', info: 'Informação',
            infoDescriptionText: 'Mostra o que caduca e quando: o tempo no site e o Twitch reiniciam às 00:00 UTC, as missões diárias são de uso único e não voltam, as de Steam vão de segunda a segunda, e o calendário de campanha pode ter um dia à espera. O Discord só paga de segunda a sexta, por isso ao fim de semana essa linha cala-se em vez de pedir. E as fichas do passe são apagadas ao fechar a temporada, por isso o painel diz quanto ARP valem as tuas agora. Cada linha diz na sua dica a que relógio responde, e duas contagens decrescentes —o dia e a semana de Steam— atualizam-se sozinhas. Na página de um sorteio lê o stock por país e por nível do próprio sorteio e diz se há chaves para ti antes de premires nada. No Marketplace e no Cofre marca cada cartão: dá para ti, pede nível superior ou está esgotado. Também te pode avisar três vezes —antes de acabar o dia, seis horas antes de acabar a semana de Steam, e ao começar o dia novo— com uma caixa de diálogo que tens de fechar. Não há som: tentou-se de três maneiras neste site e o navegador bloqueia-o sempre, enquanto o mesmo código toca noutros sites; de dentro da página não resta nada por arranjar. Uma caixa de diálogo, a marca 👽 no separador e uma faixa no painel chegam até ti, e nenhuma depende de uma permissão que não temos. Relê-se sozinho a cada 15 minutos, e o botão ⟳ volta a ler tudo na hora. Só lê: não reclama, não licita e não participa em nada, porque isso passa todo por um captcha.',
            infoPrivacyText: 'As tuas preferências —idioma, canto do painel, o aviso— ficam só no teu navegador. O script lê a página onde estás e, no máximo, pede uma vez ao site o teu próprio Centro de controlo, reusando a tua sessão. Sem terceiros, e nada é enviado ao autor do script.',
        },
        br: {
            goCC: 'Clique nesta linha para ir ao Centro de controle.', goPass: 'Clique nesta linha para ir ao passe de batalha.', goStore: 'Clique nesta linha para ir à loja de batalha.',
            goDiscord: 'Clique nesta linha para abrir o servidor de Discord da Alienware em uma ABA NOVA. Vai direto ao servidor, então você já precisa ser membro dele.',
            aviMudo: 'Você pode desativar estes avisos na caixa no rodapé do painel, ou marcar este como visto clicando na faixa dele ali mesmo.', aviday: 'O dia está acabando', aviweek: 'A semana da Steam está acabando', avidawn: 'Começou um dia novo', aviSeen: 'Marcar como visto',
            title: 'ARP de hoje', balance: '{v} ARP', tier: 'Nível {n}', streak: 'Sequência dia {n}', streakOf: 'Sequência {v}/{c}', monthOf: 'Dias {v}/{c}',
            tos: 'Tempo no site', twitch: 'Twitch', qDaily: 'Missões diárias', qSteam: 'Missões da Steam',
            calendar: 'Calendário de campanha', done: 'feito',
            ofCap: '{v}/{c}', dailyReset: 'O dia reinicia em {v}', weekReset: 'Semana da Steam: {v}',
            noData: 'Não foi possível ler o Centro de controle', more: 'Saiba mais', close: 'Fechar',
            langLabel: 'Idioma', auto: 'Automático (do site)', move: 'Mover o painel',
            refresh: 'Atualizar agora', tipRefresh: 'Lê tudo de novo, ignorando o cache. Sozinho só se atualiza a cada 15 minutos, apenas enquanto você olha para esta aba, e uma vez para o navegador inteiro.',
            alertOn: 'Me avisar antes do reset', tipTos: 'Só ficar no site já rende ARP, até um limite diário. Reseta às 00:00 UTC.',
            tipTwitch: 'O limite está no FAQ do próprio site: até 15 ARP por dia. São pagos de 1 em 1.',
            tipTwitchZero: 'Assistir não basta: o widget da AWA precisa estar ativo num canal Hive ou Nexus, com sua conta da Twitch vinculada.',
            tipDaily: 'Uso único: uma missão diária não volta. Quando a janela dela acaba, ela desaparece, feita ou não.',
            tipSteam: 'Estas vão de segunda a segunda, não por dia, e o site leva até uma hora para ver o que você jogou — e para ver um jogo que você acabou de adicionar.',
            tipCalendar: 'Este é o calendário de CAMPANHA, o que tem um botão «Obter item» por dia. Ele é resgatado no ÍCONE DA CAMPANHA LÁ EM CIMA NA BARRA, logo à esquerda do sininho de avisos —o desenho dele muda a cada campanha, então nem sempre é a mesma logo— e clicar nesta linha abre ele. Não é o de entrar todo dia: a sequência de 7 e o calendário de 28 se pagam sozinhos quando você entra, e os dois aparecem ao lado do seu nível. O resgate passa por um captcha, então o script nunca faz isso por você.',
            tipReset: 'A Alienware Arena começa o dia às 00:00 UTC. Tudo o que está acima é perdido nesse momento.',
            keysFor: '{n} chaves para o seu país no nível {t}', keysNone: 'Sem chaves para o seu país ({c})',
            keysTier: 'Chaves só a partir do nível {t} — você é nível {u}',
            tipKeys: 'Lido do estoque por país e por nível do próprio sorteio, antes de clicar em nada.',
            afford: 'Dá para você', short: 'faltam {v} ARP', tierShort: 'Exige nível {t}', soldOut: 'Esgotado', bidFrom: 'Lance a partir de {v} ARP', bidOpen: 'Leilão aberto', bidOver: 'Leilão encerrado', tipAuction: 'Um leilão às cegas não é uma compra: você dá UM lance e só os mais altos ganham, então o painel mostra o lance de entrada e não o que vai custar no fim. No do Dinoblade a entrada era 100 ARP e os dez lances vencedores ficaram entre 7.000 e 8.500. O site marca esses cards como esgotados mesmo com o leilão aberto, e é por isso que eles são lidos separados dos outros.',
            mTitle: 'O que este painel lê', mIntro: 'Tudo aqui é lido da página. O script não resgata, não dá lances e não participa de nada: isso tudo passa por captcha, e fazer por script é o que faz banir contas.',
            mDaily: 'Resetam às 00:00 UTC: tempo no site, Twitch, o dia do calendário e a sequência de login. Esse horário vem do código do próprio site, não de um chute.',
            mQuests: 'As missões não resetam. Cada uma é de uso único com a sua janela: as diárias desaparecem no fim, e as da Steam vão de segunda a segunda.',
            mTwitch: 'O ARP da Twitch precisa do widget da AWA ativo num canal Hive ou Nexus. Um zero aqui não prova que ele está desligado: também marca zero antes de você assistir nada.',
            mLate: 'A Steam é lenta de propósito: tempo jogado e posse de um jogo levam até uma hora para registrar, então um estado vermelho pode ser só um dado velho.',
            mVersion: 'Versão {v}',
            discord: 'Discord', tipDiscord: 'O site diz que o Discord paga por duas coisas —as enquetes e as «Arena Adventures»— e não informa o valor de nenhuma. Os 5 daqui são o que já se viu um dia pagar; se um dia pagar mais, a linha mostra. Não existe contador para isso em lugar nenhum do site, então é lido do seu próprio registro de ARP, filtrado para hoje. Só paga de SEGUNDA A SEXTA: no fim de semana a linha se cala em vez de pedir algo que não dá para fazer.',
            store: 'Loja de batalha', storePack: '{a} ARP por {f}', storeShort: 'faltam {n} fichas', qPass: 'Passe de batalha', passNone: 'não iniciado', passClosed: 'temporada encerrada', passClaim: '{n} para resgatar',
            tipPass: 'O passe avança com ARP de qualquer fonte, marco a marco, e precisa ser INICIADO na mão quando abre uma temporada. Os marcos não resgatados são entregues no fim, mas as fichas de batalha são apagadas: essas é que têm prazo.',
            tipStore: 'A Loja de Batalha troca fichas por ARP a preço fixo —25 fichas por 100 ARP, 45 por 200, 90 por 500— e esta linha mostra o melhor pacote que suas fichas já alcançam. Importa porque as fichas SÃO APAGADAS quando a temporada fecha, então são ARP com prazo de validade. De propósito ela não fica amarela: não vence hoje, então nunca alimenta o aviso de fim de dia.',
            fold: 'Recolher o painel', tipAcct: 'Seu saldo, seu nível e as duas contagens de login. A sequência de 7 e o calendário de 28 NÃO são o mesmo número, e nenhum dos dois é o dia do mês: a sequência quebra se você falhar um dia, enquanto o calendário conta os dias em que você entrou, caiam quando caírem. O próprio site diz isso: as recompensas dele seguem o total de dias de login, não a data. Então você pode estar no dia 1 de sequência com 8 dias entrados. Os dois só existem no Centro de controle; em outras páginas chegam um instante depois.',
            tipAlert: 'Três avisos: meia hora antes de acabar o dia se ainda faltar algo do dia; SEIS horas antes de acabar a semana da Steam se faltar alguma —essas se cumprem jogando, não clicando—; e quando o dia novo começa, para você emendar —esse te cumprimenta SEMPRE QUE VOCÊ ENTRAR, não só à meia-noite, e só fica quieto na última meia hora, quando diria o contrário do outro—. Cada um marca a aba —um 👽 no título e no favicon— e deixa uma faixa no painel; essas ficam até você marcar como visto. Tem ainda uma CAIXA DE DIÁLOGO que você precisa fechar, mas nunca numa aba em segundo plano: essas o navegador engole sem mostrar, então ela espera você voltar. Não tem som: o navegador se recusa a tocar um neste site, as informações do script explicam. Desligar e ligar de novo esta caixa ESQUECE tudo o que já foi marcado, então os avisos voltam.',
            tipLang: 'O automático segue o idioma que você escolheu na Alienware Arena.',
            tipNoData: 'Os contadores do dia ficam no Centro de controle. Se a requisição falhar, o painel avisa em vez de mostrar zeros, que pareceriam «não falta nada».',
            tipTag: 'Custa {p} ARP e você tem {b}.',
            infoTitle: 'Informações do script', infoName: 'Nome:', infoVersion: 'Versão:',
            infoAuthor: 'Autor:', infoGitHub: 'GitHub:', infoDescription: 'Descrição:',
            infoPrivacy: 'Privacidade:', accept: 'Aceitar', info: 'Informações',
            infoDescriptionText: 'Mostra o que expira e quando: o tempo no site e a Twitch resetam às 00:00 UTC, as missões diárias são de uso único e não voltam, as da Steam vão de segunda a segunda, e o calendário de campanha pode ter um dia esperando. O Discord só paga de segunda a sexta, então no fim de semana essa linha se cala em vez de pedir. E as fichas do passe são apagadas quando a temporada fecha, então o painel diz quanto ARP as suas valem agora. Cada linha diz na dica a qual relógio responde, e duas contagens —o dia e a semana da Steam— se atualizam sozinhas. Na página de um sorteio ele lê o estoque por país e por nível do próprio sorteio e diz se tem chaves para você antes de clicar em nada. No Marketplace e no Cofre marca cada card: dá para você, exige nível maior ou está esgotado. Também pode te avisar três vezes —antes de acabar o dia, seis horas antes de acabar a semana da Steam, e quando o dia novo começa— com uma caixa de diálogo que você precisa fechar. Não tem som: foi tentado de três formas neste site e o navegador bloqueia sempre, enquanto o mesmo código toca em outros sites; de dentro da página não sobra nada para consertar. Uma caixa de diálogo, a marca 👽 na aba e uma faixa no painel chegam até você, e nenhuma depende de uma permissão que não temos. Ele se relê sozinho a cada 15 minutos, e o botão ⟳ lê tudo de novo na hora. Só lê: não resgata, não dá lances e não participa de nada, porque isso tudo passa por captcha.',
            infoPrivacyText: 'Suas configurações —idioma, canto do painel, o aviso— ficam só no seu navegador. O script lê a página em que você está e, no máximo, pede uma vez ao site o seu próprio Centro de controle, reusando sua sessão. Sem terceiros, e nada é enviado ao autor do script.',
        },
        zh: {
            goCC: '点击本行前往控制中心。', goPass: '点击本行前往战斗通行证。', goStore: '点击本行前往战斗商店。',
            goDiscord: '点击本行在新标签页中打开 Alienware 的 Discord 服务器。它直接进入该服务器，所以你需要已经是成员。',
            aviMudo: '你可以用面板底部的复选框关闭这些提醒，或者点击面板上这条提醒的横幅把它标记为已看。', aviday: '这一天要结束了', aviweek: 'Steam 周期要结束了', avidawn: '新的一天开始了', aviSeen: '标记为已看',
            title: '今日 ARP', balance: '{v} ARP', tier: '等级 {n}', streak: '连续第 {n} 天', streakOf: '连续 {v}/{c}', monthOf: '天数 {v}/{c}',
            tos: '在站时间', twitch: 'Twitch', qDaily: '每日任务', qSteam: 'Steam 任务',
            calendar: '活动日历', done: '已完成',
            ofCap: '{v}/{c}', dailyReset: '本日将在 {v} 后重置', weekReset: 'Steam 周期：{v}',
            noData: '无法读取控制中心', more: '了解更多', close: '关闭',
            langLabel: '语言', auto: '自动（跟随站点）', move: '移动面板',
            refresh: '立即刷新', tipRefresh: '忽略缓存，重新读取全部数据。它自己只在这个标签页可见时每 15 分钟刷新一次，且整个浏览器只刷新一次。',
            alertOn: '重置前提醒我', tipTos: '仅停留在站点就能获得 ARP，但有每日上限，于 UTC 00:00 重置。',
            tipTwitch: '站点在常见问题里写明了这个上限：每天最多 15 ARP。每次只给 1 点。',
            tipTwitchZero: '光看不算：必须在 Hive 或 Nexus 频道上启用 AWA 小组件，并且已绑定 Twitch 账号。',
            tipDaily: '一次性任务：每日任务不会回来。窗口结束就消失，无论是否完成。',
            tipSteam: '这些任务按周计算，从周一到周一，而且站点最多需要一小时才能看到你的游戏时长，或你刚入库的游戏。',
            tipCalendar: '这是活动日历，就是每天带一个「领取物品」按钮的那个。它要在顶部导航栏的活动图标上领取，就在通知铃铛的左边——图标的图案会随每期活动更换，所以并不总是同一个标志——点击本行就能打开它。它不是每日登录的那个：7 天连续奖励和 28 天日历都会在你进来时自动到账，两者都显示在你的等级旁边。领取要过验证码，所以脚本绝不会替你领。',
            tipReset: 'Alienware Arena 的一天从 UTC 00:00 开始，上面的内容会在那一刻清零。',
            keysFor: '你所在国家等级 {t} 有 {n} 个密钥', keysNone: '你所在国家（{c}）没有密钥',
            keysTier: '密钥仅限等级 {t} 起 — 你是等级 {u}',
            tipKeys: '直接读取该赠品按国家和等级的库存，无需点击任何按钮。',
            afford: '你买得起', short: '还差 {v} ARP', tierShort: '需要等级 {t}', soldOut: '已售完', bidFrom: '起拍 {v} ARP', bidOpen: '竞拍进行中', bidOver: '竞拍已结束', tipAuction: '盲拍不是购买：你只出一次价，只有最高的几个才中标，所以面板显示的是起拍价，而不是最终成交价。Dinoblade 那场起拍 100 ARP，十个中标价在 7,000 到 8,500 之间。即使竞拍还开着，站点也把这些卡片标成已售完，所以它们要跟其他卡片分开读。',
            mTitle: '这个面板读取什么', mIntro: '这里的一切都从页面读取。脚本不会领取、不会出价、也不会参与任何活动：这些都要过验证码，用脚本去做正是账号被封的原因。',
            mDaily: 'UTC 00:00 重置：在站时间、Twitch、日历当天和登录连续天数。这个时间点来自站点自己的代码，不是猜测。',
            mQuests: '任务不会重置。每个任务都是一次性的，各有窗口：每日任务结束即消失，Steam 任务从周一到周一。',
            mTwitch: 'Twitch 的 ARP 需要在 Hive 或 Nexus 频道启用 AWA 小组件。这里显示 0 并不证明小组件关闭 — 你还没看任何直播时也是 0。',
            mLate: 'Steam 的延迟是设计使然：游戏时长和游戏归属最多需要一小时才登记，所以红色状态可能只是数据过期。',
            mVersion: '版本 {v}',
            discord: 'Discord', tipDiscord: '站点说 Discord 有两件事给 ARP——投票和「Arena Adventures」——但两者都没公布金额。这里的 5 是目前见过的一天所得；若某天给得更多，这一行会照实显示。站点上任何地方都没有它的计数器，所以是从你自己的 ARP 记录里读的，按今天过滤。它只在周一至周五发放：周末这一行会安静下来，而不是要求你做不到的事。',
            store: '战斗商店', storePack: '{f} 换 {a} ARP', storeShort: '还差 {n} 代币', qPass: '战斗通行证', passNone: '尚未开始', passClosed: '赛季已结束', passClaim: '{n} 待领取',
            tipPass: '通行证靠任何来源的 ARP 逐个里程碑推进，赛季开始时必须手动「开始」。未领取的里程碑会在赛季结束时发放，但战斗代币会被清空——有时限的是代币。',
            tipStore: '战斗商店以固定价格把代币换成 ARP——25 代币换 100 ARP，45 换 200，90 换 500——这一行显示你的代币已经够得着的最划算的一档。它重要是因为赛季结束时代币会被清空：这是有保质期的 ARP。这里刻意不用黄色：它今天不会过期，所以永远不会触发当日提醒。',
            fold: '折叠面板', tipAcct: '你的余额、等级，以及两个登录计数。7 天连续和 28 天日历不是同一个数字，两者都不是当月的日期：漏一天连续就断，而日历统计的是你登录过的天数，无论它们落在哪一天。网站自己也这么说——奖励看的是累计登录天数，不是日期。所以你可能连续第 1 天，却已登录 8 天。两者只存在于控制中心，在别的页面上会晚一点才到。',
            tipAlert: '三种提醒：距当天结束还有三十分钟且当天还有未完成项时；距 Steam 周期结束还有六小时且还有未完成的 Steam 任务时——那些要靠玩，不是点一下就行；以及新的一天开始时，提醒你开工——这一条无论你什么时候进来都会打招呼，不只在午夜，只有当天最后半小时才不出声，因为那时它会和另一条自相矛盾。每一种都会标记标签页——标题和网站图标上各一个 👽——并在面板上留下一条横幅，这些会一直留到你标记为已看。另外还有一个必须关闭的对话框，但绝不会在后台标签页弹出：那种浏览器会直接吞掉、根本不显示，所以它会等你回来。没有声音：浏览器在这个站点上拒绝播放，脚本信息里有说明。把这个复选框关掉再打开会忘记所有已标记的内容，提醒因此会重新出现。',
            tipLang: '自动模式会跟随你在 Alienware Arena 上选择的语言。',
            tipNoData: '当天的计数器在控制中心里。如果请求失败，面板会直接说明，而不是显示 0——那看起来像「什么都不缺」。',
            tipTag: '需要 {p} ARP，你有 {b}。',
            infoTitle: '脚本信息', infoName: '名称：', infoVersion: '版本：',
            infoAuthor: '作者：', infoGitHub: 'GitHub：', infoDescription: '说明：',
            infoPrivacy: '隐私：', accept: '确定', info: '信息',
            infoDescriptionText: '显示什么会过期、什么时候过期：在站时间和 Twitch 于 UTC 00:00 重置，每日任务是一次性的、不会回来，Steam 任务从周一到周一，活动日历可能还有一天等你领取。Discord 只在周一至周五发放，周末那一行会安静下来而不是催你。战斗通行证的代币在赛季结束时会被清空，所以面板会告诉你它们现在值多少 ARP。每一行的提示都会说明它归哪个时钟管，另外两个倒计时——当天和 Steam 周期——会自动刷新。在赠品页面上，它会读取该赠品按国家和等级的库存，在你点击任何按钮之前就告诉你是否有属于你的密钥。在 Marketplace 和宝库中，它会标注每张卡片：买得起、需要更高等级，或者已售完。它还能提醒你三次——当天结束前、Steam 周期结束前六小时，以及新的一天开始时——用一个必须关闭的对话框。没有声音：在这个站点上试了三种办法，浏览器每次都拦截，而同样的代码在别的站点却能响；从页面里已经没有可修的了。对话框、标签页上的 👽 标记和面板上的横幅都能传到你这里，而且都不需要我们拿不到的许可。它每 15 分钟会自行重新读取一次，⟳ 按钮则立刻重读全部数据。它只读取：不领取、不出价、不参与任何活动，因为这些都要过验证码。',
            infoPrivacyText: '你的设置——语言、面板位置、提醒——只保存在你的浏览器里。脚本读取你当前所在的页面，最多复用你的会话向站点请求一次你自己的控制中心。不涉及任何第三方，也不会向脚本作者发送任何内容。',
        },
        hi: {
            goCC: 'कंट्रोल सेंटर पर जाने के लिए इस पंक्ति पर क्लिक करें।', goPass: 'बैटल पास पर जाने के लिए इस पंक्ति पर क्लिक करें।', goStore: 'बैटल स्टोर पर जाने के लिए इस पंक्ति पर क्लिक करें।',
            goDiscord: 'Alienware का Discord सर्वर नए टैब में खोलने के लिए इस पंक्ति पर क्लिक करें। यह सीधे सर्वर में ले जाता है, इसलिए आपका पहले से उसका सदस्य होना ज़रूरी है।',
            aviMudo: 'आप पैनल के नीचे वाले चेकबॉक्स से ये चेतावनियाँ बंद कर सकते हैं, या वहीं इसकी पट्टी पर क्लिक करके इसे देखा हुआ चिह्नित कर सकते हैं।', aviday: 'दिन खत्म हो रहा है', aviweek: 'Steam का हफ़्ता खत्म हो रहा है', avidawn: 'नया दिन शुरू हो गया', aviSeen: 'देखा हुआ चिह्नित करें',
            title: 'आज का ARP', balance: '{v} ARP', tier: 'स्तर {n}', streak: 'लगातार {n}वाँ दिन', streakOf: 'लगातार {v}/{c}', monthOf: 'दिन {v}/{c}',
            tos: 'साइट पर समय', twitch: 'Twitch', qDaily: 'दैनिक क्वेस्ट', qSteam: 'Steam क्वेस्ट',
            calendar: 'कैंपेन कैलेंडर', done: 'हो गया',
            ofCap: '{v}/{c}', dailyReset: 'दिन {v} में रीसेट होगा', weekReset: 'Steam सप्ताह: {v}',
            noData: 'कंट्रोल सेंटर पढ़ा नहीं जा सका', more: 'और जानें', close: 'बंद करें',
            langLabel: 'भाषा', auto: 'स्वचालित (साइट के अनुसार)', move: 'पैनल हटाएँ',
            refresh: 'अभी ताज़ा करें', tipRefresh: 'कैश को छोड़कर सब कुछ दोबारा पढ़ता है। अपने आप यह हर 15 मिनट में ही ताज़ा होता है, वह भी तभी जब यह टैब सामने हो, और पूरे ब्राउज़र के लिए एक ही बार।',
            alertOn: 'रीसेट से पहले सूचित करें', tipTos: 'साइट पर बने रहने से ही ARP मिलता है, एक दैनिक सीमा तक। यह 00:00 UTC पर रीसेट होता है।',
            tipTwitch: 'यह सीमा साइट अपने FAQ में खुद बताती है: रोज़ अधिकतम 15 ARP। यह एक-एक करके मिलता है।',
            tipTwitchZero: 'सिर्फ़ देखने से कुछ नहीं मिलता: Hive या Nexus चैनल पर AWA विजेट चालू होना चाहिए, और Twitch खाता जुड़ा होना चाहिए।',
            tipDaily: 'एक बार की चीज़: दैनिक क्वेस्ट वापस नहीं आती। समय-सीमा खत्म होने पर वह गायब हो जाती है, पूरी हो या न हो।',
            tipSteam: 'ये सोमवार से सोमवार चलती हैं, रोज़ाना नहीं, और साइट को आपका खेलने का समय — या अभी जोड़ा गया गेम — देखने में एक घंटा लग सकता है।',
            tipCalendar: 'यह कैंपेन कैलेंडर है, वही जिसमें हर दिन «आइटम लें» बटन होता है। इसे ऊपर बार में मौजूद कैंपेन आइकॉन से लिया जाता है, सूचना घंटी के ठीक बाईं ओर — उसकी तस्वीर हर कैंपेन के साथ बदलती है, इसलिए वह हमेशा एक ही लोगो नहीं होता — और इस पंक्ति पर क्लिक करने से वह खुल जाता है। यह रोज़ लॉगिन वाला नहीं है: 7 दिन की लगातार गिनती और 28 दिन का कैलेंडर आपके आते ही अपने आप मिल जाते हैं, और दोनों आपके स्तर के बगल में दिखते हैं। लेने के लिए कैप्चा पार करना पड़ता है, इसलिए स्क्रिप्ट यह कभी आपके लिए नहीं करती।',
            tipReset: 'Alienware Arena का दिन 00:00 UTC पर शुरू होता है। ऊपर की सब चीज़ें उसी क्षण खत्म हो जाती हैं।',
            keysFor: 'आपके देश में स्तर {t} पर {n} कुंजियाँ', keysNone: 'आपके देश ({c}) के लिए कोई कुंजी नहीं',
            keysTier: 'कुंजियाँ केवल स्तर {t} से — आप स्तर {u} हैं',
            tipKeys: 'कुछ भी दबाने से पहले, गिववे के अपने देश-और-स्तर वाले स्टॉक से पढ़ा गया।',
            afford: 'आप ले सकते हैं', short: '{v} ARP कम हैं', tierShort: 'स्तर {t} चाहिए', soldOut: 'खत्म', bidFrom: 'बोली {v} ARP से', bidOpen: 'नीलामी चालू', bidOver: 'नीलामी समाप्त', tipAuction: 'अंधी नीलामी ख़रीद नहीं है: आप एक ही बोली लगाते हैं और सिर्फ़ सबसे ऊँची बोलियाँ जीतती हैं, इसलिए पैनल शुरुआती रकम दिखाता है, आख़िरी क़ीमत नहीं। Dinoblade वाली में शुरुआत 100 ARP से थी और दस जीतने वाली बोलियाँ 7,000 से 8,500 के बीच रहीं। नीलामी खुली होने पर भी साइट इन कार्डों को «ख़त्म» दिखाती है, इसीलिए इन्हें बाक़ी से अलग पढ़ा जाता है।',
            mTitle: 'यह पैनल क्या पढ़ता है', mIntro: 'यहाँ सब कुछ पेज से पढ़ा जाता है। यह स्क्रिप्ट कुछ नहीं लेती, बोली नहीं लगाती और किसी चीज़ में भाग नहीं लेती: वह सब कैप्चा से होकर जाता है, और स्क्रिप्ट से करना ही खाते बैन होने की वजह है।',
            mDaily: '00:00 UTC पर रीसेट: साइट पर समय, Twitch, कैलेंडर का दिन और लॉगिन की लगातार गिनती। यह समय साइट के ही कोड से आता है, अनुमान से नहीं।',
            mQuests: 'क्वेस्ट रीसेट नहीं होतीं। हर एक अपनी समय-सीमा वाली, एक बार की चीज़ है: दैनिक वाली खत्म होते ही गायब, Steam वाली सोमवार से सोमवार।',
            mTwitch: 'Twitch का ARP पाने के लिए Hive या Nexus चैनल पर AWA विजेट चालू चाहिए। यहाँ शून्य होने से यह साबित नहीं होता कि विजेट बंद है — कुछ देखने से पहले भी शून्य ही रहता है।',
            mLate: 'Steam जान-बूझकर धीमा है: खेलने का समय और गेम का मालिक होना दर्ज होने में एक घंटा लग सकता है, इसलिए लाल स्थिति सिर्फ़ पुराना डेटा हो सकती है।',
            mVersion: 'संस्करण {v}',
            discord: 'Discord', tipDiscord: 'साइट कहती है कि Discord दो चीज़ों के लिए ARP देता है — पोल और «Arena Adventures» — और दोनों की रकम नहीं बताती। यहाँ का 5 वह है जो एक दिन में मिलते देखा गया है; किसी दिन ज़्यादा मिले तो यह पंक्ति वही दिखाएगी। साइट पर इसका काउंटर कहीं नहीं है, इसलिए यह आपके ही ARP रजिस्टर से पढ़ी जाती है, आज पर फ़िल्टर करके। यह सिर्फ़ सोमवार से शुक्रवार तक देता है: सप्ताहांत में यह पंक्ति चुप रहती है, बजाय ऐसा कुछ माँगने के जो किया ही नहीं जा सकता।',
            store: 'बैटल स्टोर', storePack: '{f} में {a} ARP', storeShort: '{n} टोकन कम हैं', qPass: 'बैटल पास', passNone: 'शुरू नहीं किया', passClosed: 'सीज़न खत्म', passClaim: '{n} लेना बाकी',
            tipPass: 'पास किसी भी स्रोत के ARP से, एक-एक पड़ाव करके आगे बढ़ता है, और सीज़न खुलने पर उसे हाथ से शुरू करना पड़ता है। बिना लिए पड़ाव सीज़न के अंत में मिल जाते हैं, पर बैटल टोकन मिट जाते हैं — जल्दी उन्हीं की है।',
            tipStore: 'बैटल स्टोर तय दाम पर टोकन को ARP में बदलता है — 25 टोकन के 100 ARP, 45 के 200, 90 के 500 — और यह पंक्ति वह सबसे अच्छा पैक दिखाती है जिस तक आपके टोकन पहले से पहुँचते हैं। यह मायने रखता है क्योंकि सीज़न बंद होते ही टोकन मिटा दिए जाते हैं: ये समय-सीमा वाले ARP हैं। इसे जानबूझकर पीला नहीं रखा गया: यह आज ख़त्म नहीं होता, इसलिए दिन-के-अंत की चेतावनी में कभी नहीं जुड़ता।',
            fold: 'पैनल समेटें', tipAcct: 'आपका बैलेंस, स्तर और लॉगिन की दो गिनतियाँ। 7 दिन की लगातार गिनती और 28 दिन का कैलेंडर एक ही संख्या नहीं हैं, और इनमें से कोई भी महीने की तारीख़ नहीं है: एक दिन चूकने पर लगातार गिनती टूट जाती है, जबकि कैलेंडर उन दिनों को गिनता है जिनमें आपने लॉगिन किया, चाहे वे कभी भी पड़ें। साइट ख़ुद यही कहती है — उसके इनाम कुल लॉगिन दिनों से चलते हैं, तारीख़ से नहीं। इसलिए आप लगातार दिन 1 पर हो सकते हैं और 8 दिन लॉगिन कर चुके हों। ये दोनों सिर्फ़ कंट्रोल सेंटर में हैं, बाकी पेजों पर थोड़ी देर बाद आते हैं।',
            tipAlert: 'तीन चेतावनियाँ: दिन खत्म होने से आधा घंटा पहले, अगर दिन का कुछ बाकी हो; Steam का हफ़्ता खत्म होने से छह घंटे पहले, अगर उनमें से कोई बाकी हो — वे खेलकर पूरी होती हैं, दबाकर नहीं; और नया दिन शुरू होने पर, शुरुआत के लिए — वह आपको जब भी आएँ तब स्वागत करती है, सिर्फ़ आधी रात को नहीं, और सिर्फ़ दिन के आखिरी आधे घंटे चुप रहती है, जब वह दूसरी के उलट बात कहती। हर एक टैब पर निशान लगाती है — शीर्षक पर और फ़ेविकॉन पर एक 👽 — और पैनल में एक पट्टी छोड़ जाती है; ये तब तक रहते हैं जब तक आप उन्हें देखा हुआ चिह्नित न करें। एक डायलॉग भी आता है जिसे बंद करना पड़ता है, पर पृष्ठभूमि वाले टैब में कभी नहीं: उन्हें ब्राउज़र बिना दिखाए निगल जाता है, इसलिए वह आपके लौटने का इंतज़ार करता है। आवाज़ नहीं है: ब्राउज़र इस साइट पर बजाने से मना करता है, स्क्रिप्ट की जानकारी में यह लिखा है। इस बॉक्स को बंद करके फिर चालू करने पर पहले से चिह्नित सब कुछ भूल जाता है, तो चेतावनियाँ लौट आती हैं।',
            tipLang: 'स्वचालित वही भाषा लेता है जो आपने Alienware Arena पर चुनी है।',
            tipNoData: 'दिन के काउंटर कंट्रोल सेंटर में रहते हैं। अनुरोध विफल हो तो पैनल यही कहता है, शून्य दिखाने के बजाय — वह «कुछ बाकी नहीं» जैसा पढ़ा जाता।',
            tipTag: 'इसकी कीमत {p} ARP है और आपके पास {b} हैं।',
            infoTitle: 'स्क्रिप्ट की जानकारी', infoName: 'नाम:', infoVersion: 'संस्करण:',
            infoAuthor: 'लेखक:', infoGitHub: 'GitHub:', infoDescription: 'विवरण:',
            infoPrivacy: 'निजता:', accept: 'ठीक है', info: 'जानकारी',
            infoDescriptionText: 'यह दिखाता है कि क्या खत्म हो रहा है और कब: साइट पर समय और Twitch 00:00 UTC पर रीसेट होते हैं, दैनिक क्वेस्ट एक बार की होती हैं और वापस नहीं आतीं, Steam वाली सोमवार से सोमवार चलती हैं, और कैंपेन कैलेंडर में कोई दिन बाकी हो सकता है। Discord सिर्फ़ सोमवार से शुक्रवार तक देता है, इसलिए सप्ताहांत में वह पंक्ति माँगने के बजाय चुप रहती है। और बैटल पास के टोकन सीज़न बंद होते ही मिटा दिए जाते हैं, इसलिए पैनल बताता है कि आपके टोकन अभी कितने ARP के बराबर हैं। हर पंक्ति अपनी टूलटिप में बताती है कि वह किस घड़ी से चलती है, और दो उलटी गिनती —दिन और Steam सप्ताह— अपने आप ताज़ा होती हैं। किसी गिववे के पेज पर यह उसी गिववे के देश-और-स्तर वाले स्टॉक को पढ़ता है और कुछ दबाने से पहले बता देता है कि आपके लिए कुंजियाँ हैं या नहीं। Marketplace और वॉल्ट में यह हर कार्ड पर निशान लगाता है: आप ले सकते हैं, ऊँचा स्तर चाहिए, या खत्म। यह तीन बार सूचित भी कर सकता है — दिन खत्म होने से पहले, Steam का हफ़्ता खत्म होने से छह घंटे पहले, और नया दिन शुरू होने पर — एक डायलॉग से, जिसे बंद करना पड़ता है। आवाज़ नहीं है: इस साइट पर तीन तरीके आज़माए गए और ब्राउज़र हर बार रोक देता है, जबकि वही कोड दूसरी साइटों पर बजता है; पेज के भीतर से अब कुछ ठीक करने को नहीं बचा। डायलॉग, टैब पर 👽 का निशान और पैनल की पट्टी आप तक पहुँचते हैं, और इनमें से किसी को भी ऐसी अनुमति नहीं चाहिए जो हमारे पास नहीं है। यह हर 15 मिनट में खुद दोबारा पढ़ता है, और ⟳ बटन तुरंत सब कुछ फिर से पढ़ लेता है। यह सिर्फ़ पढ़ता है: कुछ नहीं लेता, बोली नहीं लगाता, किसी चीज़ में भाग नहीं लेता — क्योंकि वह सब कैप्चा से होकर जाता है।',
            infoPrivacyText: 'आपकी सेटिंग्स —भाषा, पैनल का कोना, चेतावनी— सिर्फ़ आपके ब्राउज़र में रहती हैं। स्क्रिप्ट उस पेज को पढ़ती है जिस पर आप हैं और, ज़्यादा से ज़्यादा, आपके ही सत्र से साइट से एक बार आपका कंट्रोल सेंटर मांगती है। कोई तीसरा पक्ष नहीं, और स्क्रिप्ट के लेखक को कुछ नहीं भेजा जाता।',
        },
    };

    function t(key, vars) {
        let s = (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
        if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
        return s;
    }

    // ------------------------------------------------------------------
    // Selectores
    // ------------------------------------------------------------------
    // Todo sale de atributos, ids o estructura. Nada se compara con el texto que
    // pinta el sitio: Weglot lo traduce a ocho idiomas y de forma inconsistente
    // —en la misma tabla conviven «Complete» sin traducir e «Incompleto»
    // traducido—, así que casar por texto es apostar a su humor.
    const SEL = {
        tosArp: '#control-center__tos-arp',
        tosMax: '#control-center__tos-max-arp',
        totalArp: '#control-center__total-arp',
        twitchArp: '#control-center__twitch-arp',
        twitchStatus: '#control-center__twitch-arp-status',
        questRow: '.card-table-row',
        questLink: 'a.quest-title[data-quest-id]',
        steamStatus: '[id^="control-center__steam-quest-status-"]',
        steamReward: '#control-center__steam-quest-reward-',
        calClaim: 'button.promotional-calendar__day-claim[data-id]',
        calDay: '.promotional-calendar__day',
        calDone: '.promotional-calendar__day-claimed',
        // El icono de la barra que ABRE el calendario. Está en todas las páginas
        // y su `aria-label` no cambia; lo que cambia con cada campaña es su
        // DIBUJO —hoy el de Intel, en otro volcado otro—, así que el panel no
        // puede llamarlo «el de Intel»: lo sitúa por dónde está.
        calTrigger: '.nav-item-promo',
        // Las DOS rejillas de recompensa por inicio de sesión, que no son el
        // calendario de arriba y tampoco son la misma cosa entre sí (ver readRejilla).
        rachaDias: '#streak-days [data-day]',
        mesDias: '[id^="monthly-days-"] [data-day]',
        passTokens: '.bp-header__token-total',
        passStarted: '.bp-header__started',
        passStart: '.bp-header__start-btn, .bp-widget__start-form, .bp-widget__recap--start',
        passClaimable: '[data-state="unlockable"]',
        passCountdown: '.bp-header__countdown[data-countdown], .bp-widget__countdown[data-countdown]',
        logRow: '.card-table-row',
        logDiscord: '.card-table-row i.fa-discord',
        logArp: '.col-lg-3',
        logDate: '.col-lg-2',
        giveawayActions: '#giveaway-actions',
        marketCard: '.product-card',
        vaultCard: '.gamevault-marketplace-product',
    };

    const WIDGET_ID = 'awa-arp-widget';
    const CACHE_KEY = 'awa-arp-daily';
    const PASS_KEY = 'awa-arp-pass';
    const PASS_URL = '/control-center/battle-pass/1';
    const STORE_URL = '/battle-store';
    // La Tienda de Batalla cambia fichas por ARP a precio fijo, y las fichas se
    // BORRAN al cerrar la temporada: es la única fuente con fecha límite que el
    // panel no decía, y la mayor del historial (200 ARP, §14.5).
    //
    // Los tres paquetes salen del volcado de la tienda abierta, leídos de la
    // estructura y no del texto: `.bp-store__default-arp-amount` da el ARP y
    // `.product-price` las fichas. Van aquí y no se leen en vivo porque la línea
    // tiene que funcionar en CUALQUIER página, no solo en /battle-store, y
    // porque abrir la tienda sería una petición más (regla de §14.7).
    const STORE_PACKS = [{ fichas: 90, arp: 500 }, { fichas: 45, arp: 200 }, { fichas: 25, arp: 100 }];
    const CC_URL = '/control-center';
    // El servidor de Discord de Alienware, DIRECTO y no por su invitación.
    //
    // Los 47 enlaces de Discord que hay en los volcados son todos la invitación
    // (`discord.gg/Alienware`), y esa tiene la ventaja de servir para las dos
    // cosas —pantalla de invitación a quien no es miembro, servidor a quien sí—.
    // Se descartó igualmente: al servidor de Alienware se llega hasta buscándolo,
    // así que la invitación no aporta nada a quien ya usa este panel, y el
    // enlace directo abre la app de Discord en el servidor en vez de pasar por
    // una página intermedia.
    //
    // El id del gremio NO está en ninguna página de AWA. Se resolvió el
    // 2026-08-28 contra la propia API de Discord —`/api/v10/invites/Alienware`,
    // que devuelve `guild.id`, `guild.name: "Alienware"` y `vanity_url_code:
    // "alienware"`— y se deja escrito aquí para no volver a preguntarlo: es una
    // constante del servidor, no cambia.
    //
    // La contrapartida, y por eso el tooltip lo dice: un enlace directo NO deja
    // entrar a quien no sea miembro todavía.
    const DISCORD_URL = 'https://discord.com/channels/97149047281827840';
    const POS_KEY = 'awa-arp-pos';
    const FOLD_KEY = 'awa-arp-folded';
    const ALERT_KEY = 'awa-arp-alert';
    // Las tres marcas de «ya lo viste» llevan nombres NUEVOS a propósito. Antes
    // se llamaban `awa-arp-alert-done` / `-dawn` / `-week` y significaban «ya
    // sonó»: se escribían al sonar. Ahora significan lo contrario —solo las pone
    // marcar la banda— y tienen exactamente la misma forma, así que una marca
    // vieja del mismo día se leería como «ya la viste» y el aviso se quedaría
    // callado el resto de la jornada. No hay forma de distinguirlas por dentro;
    // sí de no usar el mismo cajón. Las viejas se borran al arrancar.
    const VISTO_DIA_KEY = 'awa-arp-visto-dia';
    const VISTO_DAWN_KEY = 'awa-arp-visto-amanecer';
    const VISTO_SEMANA_KEY = 'awa-arp-visto-semana';
    const CLAVES_VIEJAS = ['awa-arp-alert-done', 'awa-arp-alert-dawn', 'awa-arp-alert-week'];
    // Publicado por el propio sitio en `/faq-contact` («You can earn a total of 15
    // ARP a day») y en `/whatisarena` («up to 15 ARPs… every day»). Hasta el
    // 2026-08-25 esto iba comentado —y dicho en el tooltip— como «observado, no
    // publicado», que era falso: nadie había leído la FAQ.
    const TWITCH_CAP = 15;
    // Discord es la ÚNICA fuente cuyo importe el sitio no publica: la FAQ dice
    // «earn daily ARP from Discord Adventures» y `/whatisarena` habla de votar en
    // encuestas Y de las Adventures, o sea DOS actividades, sin cifra para
    // ninguna. Así que 5 no es un techo demostrado, es lo más que se ha visto
    // pagar en un día. Por eso la línea usa `Math.max` con lo cobrado: si algún
    // día pasa de 5, el panel enseña la cifra real en vez de fingir un tope.
    const DISCORD_CAP = 5;
    const LOG_KEY = 'awa-arp-log';
    // Tres avisos, y cada uno con su reloj. Los dos primeros son «date prisa» y el
    // tercero es «empieza de cero»:
    //
    //   1. Media hora antes de que acabe el DÍA, si queda algo del día por hacer.
    //   2. SEIS horas antes de que acabe la semana de Steam, si queda alguna sin
    //      hacer. Seis y no treinta minutos porque esas no se despachan pulsando:
    //      hay que jugar, y el sitio además tarda hasta una hora en enterarse.
    //   3. Al empezar el día nuevo, para arrancar con las tareas nuevas.
    //
    // Cada uno lleva su propia marca de «ya sonó», y las tres viven en
    // localStorage para que con tres pestañas abiertas suene una vez, no tres.
    // Y cada uno INSISTE mientras su ventana esté abierta y no lo hayas marcado
    // como visto. Un aviso que suena una vez y se calla es un aviso que te
    // pierdes si estabas en otra cosa; y el sitio no perdona: lo que caduca,
    // caduca. Las marcas de abajo NO significan «ya sonó», significan «ya lo
    // viste»: se escriben cuando pulsas la banda, no cuando suena.
    //
    // Los intervalos van por el tamaño de su ventana: media hora admite recordar
    // cada cinco minutos —seis veces como mucho—, pero seis horas a ese ritmo
    // serían setenta y dos, que es acoso. La de Steam recuerda cada media hora.
    const ALERT_MINUTES = 30;
    const ALERT_WEEK_HOURS = 6;
    const ALERT_REPEAT_MS = 5 * 60 * 1000;
    const ALERT_REPEAT_WEEK_MS = 30 * 60 * 1000;
    CLAVES_VIEJAS.forEach((k) => { if (recall(k) !== null) store(k, null); });
    // El aviso que ya sonó y AÚN NO SE HA VISTO. Sobrevive a cambiar de página,
    // porque un aviso que se borra solo al volver a la pestaña no es un aviso: es
    // un sonido que te perdiste. Se va cuando lo marcas como visto, o cuando pasa
    // su propia hora —si el día ya acabó, avisar de él no tiene sentido—.
    const AVISO_KEY = 'awa-arp-aviso';
    // El panel se relee solo. Los datos que enseña cambian mientras navegas —una
    // quest cobrada, ARP de Twitch, la encuesta de Discord— y una pestaña abierta
    // toda la tarde enseñaría el estado de cuando cargó.
    const REFRESH_MS = 15 * 60 * 1000;
    const ALERT_REFRESH_MS = 5 * 60 * 1000;
    // Marca compartida por TODAS las pestañas del navegador: la hora del último
    // refresco lo haya hecho quien lo haya hecho. Sin ella, tres pestañas
    // abiertas piden tres veces lo mismo.
    const REFRESH_KEY = 'awa-arp-refresh';
    const POSITIONS = ['tr', 'br', 'bl', 'tl'];

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------
    // Ni «es» ni «br» son etiquetas BCP47 servibles tal cual: la primera deja el
    // formato a merced del navegador y la segunda no existe. Se traducen una vez
    // aquí y valen para los números y para la edad del dato.
    let LOCALE = LANG === 'es' ? 'es-ES' : LANG === 'br' ? 'pt-BR' : LANG;
    let nf = new Intl.NumberFormat(LOCALE);

    function aplicarIdioma(codigo) {
        LANG = codigo;
        LOCALE = LANG === 'es' ? 'es-ES' : LANG === 'br' ? 'pt-BR' : LANG;
        nf = new Intl.NumberFormat(LOCALE);
    }

    // Cuándo se leyeron los datos que hay pintados. Vive fuera del panel porque
    // lo escribe quien lee y lo pinta quien dibuja.
    let _leidoEn = 0;
    // Y cuándo se INTENTÓ por última vez, que no es lo mismo: sin esta segunda
    // marca, una racha sin red dejaría el reloj reintentando cada 30 segundos.
    let _intentoEn = 0;

    // Una relectura solo puede AÑADIR. Un campo en `null` no significa «no hay»,
    // significa «no lo pude leer», y copiarlo tal cual hace que ACTUALIZAR BORRE
    // líneas del panel: pulsar ⟳ dejaba fuera «Tiempo en el sitio» y «Twitch»
    // porque la respuesta del servidor traía esos contadores vacíos, y el panel
    // pasaba a saber MENOS que antes de pulsar. Así que cada campo que llegue
    // vacío conserva el valor anterior.
    function fusionar(viejo, nuevo) {
        if (!nuevo) return viejo;
        if (!viejo) return nuevo;
        const out = {};
        Object.keys(viejo).forEach((k) => { out[k] = viejo[k]; });
        Object.keys(nuevo).forEach((k) => {
            if (nuevo[k] !== null && nuevo[k] !== undefined) out[k] = nuevo[k];
        });
        return out;
    }

    // El botón de actualizar, que además ES el reloj del dato. Vive aquí porque
    // lo crea el panel y lo repintan tanto el render como el tic.
    let _txtEdad = null;
    // La sub-línea de la cuenta —nivel, racha, mes—. Se repinta con cada dato que
    // llega, y no se pinta una sola vez al construir el panel: la racha y el mes
    // solo están en el Centro de control, así que en cualquier otra página llegan
    // DESPUÉS, con el fetch. Pintarla una vez la dejaba sin ellos para siempre.
    let _txtSub = null;

    // Nivel · Racha 1/7 · Mes 8/28. Las dos cuentas van juntas porque juntas
    // dicen algo que por separado no: que la racha se rompe y el mes no.
    function pintarSub(acc, daily) {
        if (!_txtSub) return;
        const bits = [];
        if (acc.tier !== null) bits.push(t('tier', { n: acc.tier }));
        const r = daily && daily.racha;
        if (r && r.dia !== null) bits.push(t('streakOf', { v: nf.format(r.dia), c: nf.format(r.total) }));
        else if (acc.streak !== null) bits.push(t('streak', { n: acc.streak }));
        const m = daily && daily.mes;
        if (m && m.dia !== null) bits.push(t('monthOf', { v: nf.format(m.dia), c: nf.format(m.total) }));
        _txtSub.textContent = bits.join(' · ');
    }

    function pintarEdad() {
        if (_txtEdad) _txtEdad.textContent = edadTexto();
    }

    // «hace 3 minutos», en el idioma del panel y sin una sola cadena nueva.
    function edadTexto() {
        if (!_leidoEn) return '';
        const s2 = Math.max(0, Math.round((Date.now() - _leidoEn) / 1000));
        try {
            const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
            return s2 < 60 ? rtf.format(-s2, 'second') : rtf.format(-Math.round(s2 / 60), 'minute');
        } catch (e) {
            return s2 < 60 ? '-' + s2 + 's' : '-' + Math.round(s2 / 60) + 'm';
        }
    }

    // Todo lo que inyectamos se marca como NO traducible. Sin esto, Weglot
    // retraduce el panel: con el sitio en español, «Tiempo en el sitio» salía como
    // «Tiempo de permanencia en el sitio» y «faltan 1» como «Queda 1». O sea que
    // el texto que se ve no es el que escribe el script —y con él se van las
    // cifras de las cadenas con {v}—. Las dos marcas son las que el propio AWA usa
    // en su switcher: `translate="no"` y `data-wg-notranslate`.
    function noTraducir(node) {
        node.setAttribute('translate', 'no');
        node.setAttribute('data-wg-notranslate', 'true');
        node.classList.add('notranslate');
        return node;
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function store(key, value) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
        catch (e) { /* almacenamiento no disponible */ }
    }

    function recall(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function num(text) {
        if (text === null || text === undefined) return null;
        const m = String(text).replace(/[^\d.-]/g, '');
        if (m === '' || m === '-') return null;
        const v = Number(m);
        return Number.isFinite(v) ? v : null;
    }

    // El sitio empieza su día a las 00:00 UTC: lo dice su propio código, que
    // calcula la cookie del calendario con setUTCHours(0,0,0,0). Así que las dos
    // cuentas atrás se hacen en UTC, no con la hora local del navegador.
    function msToDailyReset(now) {
        const d = new Date(now.getTime());
        d.setUTCHours(24, 0, 0, 0);
        return d.getTime() - now.getTime();
    }

    // Las quests de Steam van de lunes a lunes: las dos tandas observadas
    // cubrían 17-24 y 24-31 de agosto, y la ficha de cada quest trae ese rango.
    function msToWeekReset(now) {
        const d = new Date(now.getTime());
        d.setUTCHours(0, 0, 0, 0);
        const dow = d.getUTCDay();                    // 0 domingo … 1 lunes
        const faltan = dow === 1 ? 7 : (8 - dow) % 7 || 7;
        d.setUTCDate(d.getUTCDate() + faltan);
        return d.getTime() - now.getTime();
    }

    function fmtCountdown(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
    }

    // El filtro del registro va en YYYY-MM-DD y por el día del SITIO, que es UTC.
    function utcDate(ms) {
        const d = new Date(ms);
        const dd = (n) => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + dd(d.getUTCMonth() + 1) + '-' + dd(d.getUTCDate());
    }

    function utcStamp(ms) {
        const d = new Date(ms);
        return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
    }

    // La encuesta de Discord solo se cobra de LUNES A VIERNES. Lo dijo el usuario
    // y lo confirman los registros que ya teníamos, contando por día del sitio:
    // vie 21, lun 24, mar 25 y jue 27 pagaron 5; sáb 22 y dom 23, nada.
    //
    // Va en UTC porque el día del sitio empieza a las 00:00 UTC y las fechas del
    // registro son ésas: preguntar por el día LOCAL adelantaría o atrasaría el
    // fin de semana hasta seis horas, justo en el borde donde importa.
    function finDeSemana(ms) {
        const d = new Date(ms).getUTCDay();
        return d === 0 || d === 6;
    }

    // ------------------------------------------------------------------
    // Estado del usuario
    // ------------------------------------------------------------------
    // Alienware Arena publica el estado como variables globales en un <script>
    // inline de todas las páginas. Con @grant none el script corre en el
    // contexto de la página y las ve directas; unsafeWindow queda de reserva.
    function pageWindow() {
        try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; }
        catch (e) { return window; }
    }

    function readAccount() {
        const w = pageWindow();
        const g = (k) => (k in w ? w[k] : undefined);
        const logins = g('consecutive_logins');
        return {
            logged: g('user_is_logged_in') === true,
            balance: typeof g('arp_balance') === 'number' ? g('arp_balance') : null,
            tier: typeof g('arp_tier') === 'number' ? g('arp_tier') : null,
            country: typeof g('user_country') === 'string' ? g('user_country') : null,
            streak: logins && typeof logins.count === 'number' ? logins.count : null,
            steamId: typeof g('steamId') === 'number' ? g('steamId') : null,
        };
    }

    // ------------------------------------------------------------------
    // Lo que caduca, separado por reloj
    // ------------------------------------------------------------------
    // Las quests diarias y las de Steam se cuentan aparte a propósito: no
    // caducan igual. Juntarlas en un solo «faltan N» esconde justo lo que hay
    // que saber, que es cuándo se pierde cada cosa.
    // Los contadores del día NO están en el HTML del servidor: llegan VACÍOS y los
    // rellena un `<script>` inline al cargar la página. Comprobado el 2026-08-26
    // pidiendo `/control-center` desde la consola del navegador:
    //
    //     tos-arp=""   tos-max-arp="5"   twitch-arp=""   total-arp=""
    //
    // —solo el TOPE viene servido, porque es fijo—. Por eso desaparecían «Tiempo
    // en el sitio» y «Twitch» en cuanto el dato venía de un `fetch` en vez de la
    // página ya pintada, y por eso no se pudo reproducir con los volcados: los del
    // Centro de control se guardaron del DOM ya renderizado, con los huecos llenos.
    //
    // La fuente buena es el objeto que usa ese mismo script:
    //
    //     let dailyArpData = { timeOnSiteArp, timeOnSiteCap, dailyArp,
    //                          twitchData: { totalPoints, bonusPoints, underCap, … } };
    //
    // No es una global —vive dentro de un `$(function(){…})`—, así que se saca del
    // TEXTO del script; y así el mismo camino sirve para la página actual y para
    // una respuesta parseada. De paso, `underCap` sustituye a leer «Complete» del
    // estado de Twitch, que era texto traducido por Weglot: un booleano no tiene
    // idioma.
    function readDailyArp(doc) {
        const scripts = doc.querySelectorAll('script');
        for (let i = 0; i < scripts.length; i++) {
            const txt = scripts[i].textContent;
            if (!txt || txt.indexOf('dailyArpData') < 0) continue;
            // Perezoso hasta la primera llave de cierre seguida de `;`, que es el
            // final del objeto: dentro solo hay `} }` con un espacio en medio.
            const m = txt.match(/dailyArpData\s*=\s*(\{[\s\S]*?\})\s*;/);
            if (!m) continue;
            try { return JSON.parse(m[1]); } catch (e) { /* no era JSON válido */ }
        }
        return null;
    }

    function readDaily(doc) {
        const arp = readDailyArp(doc);
        const tos = doc.querySelector(SEL.tosArp);
        const twitch = doc.querySelector(SEL.twitchArp);
        const total = doc.querySelector(SEL.totalArp);
        if (!arp && !tos && !twitch && !total) return null;
        const tosMax = doc.querySelector(SEL.tosMax);
        const twitchSt = doc.querySelector(SEL.twitchStatus);

        // Diarias: una quest está sin hacer cuando su celda de recompensa llega
        // VACÍA. El texto del estado no vale ni para esto.
        let dPend = 0, dTot = 0;
        doc.querySelectorAll(SEL.questRow).forEach((row) => {
            if (!row.querySelector(SEL.questLink)) return;
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;      // el listado de /quests no trae estado
            dTot++;
            if (cells[2].textContent.trim() === '') dPend++;
        });

        // Steam: la tabla usa otro mecanismo —la recompensa está en el DOM pero
        // oculta con visibility:hidden mientras no se gane—, así que se mira el
        // estilo de la celda y no su texto.
        let sPend = 0, sTot = 0;
        doc.querySelectorAll(SEL.steamStatus).forEach((cell) => {
            const id = cell.id.replace('control-center__steam-quest-status-', '');
            const reward = doc.querySelector(SEL.steamReward + id);
            sTot++;
            const oculta = reward && /visibility:\s*hidden/i.test(reward.getAttribute('style') || '');
            if (oculta) sPend++;
        });

        const tw = arp && arp.twitchData ? arp.twitchData : null;
        const numOr = (v, node) => (typeof v === 'number' ? v : num(node && node.textContent));
        const salida = {
            // El objeto manda; los spans quedan de respaldo por si algún día el
            // sitio vuelve a servirlos llenos y deja de traer el script.
            tos: numOr(arp && arp.timeOnSiteArp, tos),
            tosMax: numOr(arp && arp.timeOnSiteCap, tosMax),
            twitch: tw ? (tw.totalPoints || 0) + (tw.bonusPoints || 0) : num(twitch && twitch.textContent),
            twitchDone: tw ? tw.underCap === false
                : !!(twitchSt && /complete/i.test(twitchSt.textContent) && !/incomplet/i.test(twitchSt.textContent)),
            total: numOr(arp && arp.dailyArp, total),
            dailyPending: dTot ? dPend : null,
            dailyTotal: dTot || null,
            steamPending: sTot ? sPend : null,
            steamTotal: sTot || null,
            // Solo están en el Centro de control, y por eso viajan con el resto de
            // lo diario: `fetchDaily` ya pide esa página, así que salen gratis.
            racha: readRejilla(doc, SEL.rachaDias, 'consecutive_logins'),
            mes: readRejilla(doc, SEL.mesDias, 'monthly_logins'),
            at: Date.now(),
        };

        // Diagnóstico. Nació sin saber por qué el panel se quedaba a veces sin
        // «Tiempo en el sitio» ni «Twitch» con las quests bien contadas, y la causa
        // ya se encontró: esos dos contadores los escribe el JS del sitio a partir
        // de `dailyArpData`, así que en una respuesta de `/control-center` leída con
        // DOMParser —que no ejecuta scripts— los elementos están y llegan VACÍOS.
        //
        // El aviso se queda igualmente, y no por inercia: separa «el elemento NO
        // ESTÁ» de «está y viene vacío», que son un cambio de maquetación y un
        // cambio de origen del dato, dos averías distintas con dos arreglos
        // distintos. Es la red por si el sitio deja de traer `dailyArpData`.
        // No cambia nada de lo que hace el script; solo deja el rastro en consola.
        if (salida.tos === null && salida.twitch === null) {
            const estado = (n) => (n ? JSON.stringify(String(n.textContent).slice(0, 20)) : 'AUSENTE');
            try {
                console.warn('[AWA-ARP] leído sin los contadores del día:', {
                    doc: doc === document ? 'la página actual' : 'respuesta de /control-center',
                    titulo: doc.title,
                    tos: estado(tos), tosMax: estado(tosMax),
                    twitch: estado(twitch), total: estado(total),
                    quests: dTot, steam: sTot,
                });
            } catch (e) { /* sin consola */ }
        }
        return salida;
    }

    function cacheOk(data, now) {
        if (!data || typeof data.at !== 'number') return false;
        // Cinco minutos, y en cualquier caso muere al cambiar el día del sitio:
        // un dato de ayer no vale ni aunque sea reciente.
        if (now.getTime() - data.at > 5 * 60 * 1000) return false;
        return utcStamp(data.at) === utcStamp(now.getTime());
    }

    function readCache(now) {
        try {
            const raw = recall(CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return cacheOk(data, now) ? data : null;
        } catch (e) { return null; }
    }

    // Una respuesta que no es NUESTRA no se parsea.
    //
    // Si la sesión caduca a mitad de navegación, el sitio contesta al fetch con
    // una página de invitado; y un redirect que cruce de origen viaja SIN la
    // cookie, porque `credentials: 'same-origin'` no la manda fuera del origen
    // —aunque el sitio la comparta entre sus subdominios—. Lo que vuelve entonces
    // no es un error: es la página de un desconocido, con los contadores
    // personales vacíos y las quests en su estado genérico. Parsearla no rompe
    // nada, y eso es lo malo: rellena el panel con datos de nadie.
    //
    // Se comprueban las dos cosas por separado porque fallan por separado: el
    // ORIGEN final de la respuesta (`res.url`, que ya trae el redirect resuelto) y
    // el marcador de sesión que el propio sitio escribe en todas sus páginas.
    function nuestra(res, html) {
        try {
            if (new URL(res.url, location.href).origin !== location.origin) return false;
        } catch (e) { /* sin URL fiable, decide el marcador */ }
        return /user_is_logged_in\s*=\s*true/.test(html);
    }

    function pedir(url) {
        return fetch(url, { credentials: 'same-origin' }).then((r) => {
            if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status));
            return r.text().then((html) => (nuestra(r, html)
                ? html
                : Promise.reject(new Error('respuesta sin nuestra sesión'))));
        });
    }

    function fetchDaily() {
        return pedir(CC_URL)
            .then((html) => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const data = readDaily(doc);
                if (data) store(CACHE_KEY, JSON.stringify(data));
                return data;
            });
    }

    // `forzar` salta el documento Y la caché. Es lo que hace que el botón de
    // actualizar sirva de algo: leer el DOM de la página en la que estás devuelve
    // el dato de cuando cargó, que es justo el que el usuario quiere renovar.
    function getDaily(forzar) {
        if (!forzar) {
            const now = new Date();
            const here = readDaily(document);
            if (here) { store(CACHE_KEY, JSON.stringify(here)); return Promise.resolve(here); }
            const cached = readCache(now);
            if (cached) return Promise.resolve(cached);
        }
        return fetchDaily().catch(() => null);
    }

    // ------------------------------------------------------------------
    // Discord: la encuesta, leída del registro de ARP
    // ------------------------------------------------------------------
    // Es la única fuente diaria SIN contador en el Centro de control, así que su
    // estado sale del registro (`/account/arp-log`). Se identifica por el ICONO
    // —`fab fa-discord`— y no por el nombre: Weglot lo traduce como «Encuesta en
    // Discordia».
    //
    // La fecha de cada fila se comprueba AQUÍ, y no se delega en el filtro del
    // servidor. El primer intento pedía `from=HOY&to=HOY` y el panel se quedaba
    // clavado en 0 de 5 con la encuesta ya contestada: el propio sitio, cuando
    // rellena su formulario, pone `to` en MAÑANA y no en hoy, así que un `to`
    // igual a hoy deja fuera justo el día que se quiere leer. Se pide el mismo
    // rango que usa él —hoy a mañana— y se descarta fila a fila lo que no sea de
    // hoy, de modo que el resultado es correcto aunque el servidor devuelva un
    // rango más ancho o cambie de criterio.
    //
    // El `max` sí importa: las filas del registro son CRÉDITOS, no días, y solo
    // Twitch pone quince en una jornada, así que con el tope de 20 del sitio el
    // día de hoy se podría cortar por la mitad.
    //
    // Las filas de detalle repiten el icono, pero cuelgan de `.card-table-row-details`
    // —otra clase—, así que `closest()` no las toma por filas y no se cuentan dos veces.
    function readLog(doc, hoy) {
        let discord = 0;
        let iconos = 0;
        const fechas = [];
        doc.querySelectorAll(SEL.logDiscord).forEach((icono) => {
            iconos++;
            const fila = icono.closest(SEL.logRow);
            if (!fila) return;
            const fecha = fila.querySelector(SEL.logDate);
            const f = fecha ? fecha.textContent.trim() : '';
            fechas.push(f || '(sin fecha)');
            if (f !== hoy) return;
            const celdas = fila.querySelectorAll(SEL.logArp);
            const v = celdas.length ? num(celdas[0].textContent) : null;
            if (v !== null) discord += v;
        });
        // Un cero aquí tiene TRES causas distintas y desde fuera se ven iguales:
        // que la respuesta no sea el registro, que no haya filas de Discord, o que
        // las haya con otra fecha. Sin separarlas no se puede arreglar nada —fue
        // exactamente lo que pasó con los contadores del día (§14.8)—.
        if (!discord) {
            try {
                console.warn('[AWA-ARP] registro leído sin ARP de Discord para hoy:', {
                    hoy: hoy,
                    titulo: doc.title,
                    filas: doc.querySelectorAll(SEL.logRow).length,
                    iconosDiscord: iconos,
                    fechasDeEsosIconos: fechas.slice(0, 8),
                });
            } catch (e) { /* sin consola */ }
        }
        return { discord: discord, at: Date.now() };
    }

    function getDiscord(forzar) {
        const now = new Date();
        try {
            const guardado = JSON.parse(recall(LOG_KEY) || 'null');
            // Una vez cobrada, la cifra ya no cambia hoy: se guarda para el resto
            // del día. Mientras esté a cero se recomprueba cada cinco minutos.
            if (!forzar && guardado && utcStamp(guardado.at) === utcStamp(now.getTime())
                && (guardado.discord >= DISCORD_CAP || now.getTime() - guardado.at < 5 * 60 * 1000)) {
                return Promise.resolve(guardado);
            }
        } catch (e) { /* caché ilegible */ }
        const hoy = utcDate(now.getTime());
        const manana = utcDate(now.getTime() + 24 * 60 * 60 * 1000);
        return pedir('/account/arp-log?from=' + hoy + '&to=' + manana + '&max=100')
            .then((html) => {
                const data = readLog(new DOMParser().parseFromString(html, 'text/html'), hoy);
                store(LOG_KEY, JSON.stringify(data));
                return data;
            })
            // Una petición caída aquí es INVISIBLE: `fusionar` conserva el 0 de
            // antes y la línea sigue diciendo «0/5» sin que nada delate que ni
            // siquiera se pudo preguntar.
            .catch((e) => {
                try { console.warn('[AWA-ARP] no se pudo leer el registro de ARP:', e && e.message); }
                catch (e2) { /* sin consola */ }
                return null;
            });
    }

    // Lo que otra pestaña dejó en las cachés. A diferencia de `readCache`, aquí NO
    // se aplica el TTL de cinco minutos: el dato es el que acaba de traer otra
    // pestaña, y el único requisito es que sea del día del sitio. Es lo que
    // permite que solo una pestaña pida y las demás se enteren igual.
    function leerAlmacen(clave) {
        try {
            const d = JSON.parse(recall(clave) || 'null');
            if (!d || typeof d.at !== 'number') return null;
            return utcStamp(d.at) === utcStamp(Date.now()) ? d : null;
        } catch (e) { return null; }
    }

    // ------------------------------------------------------------------
    // Pase de batalla
    // ------------------------------------------------------------------
    // Va aparte de lo diario porque su reloj es la TEMPORADA, no el día, y
    // porque el dato cambia despacio: se pide una vez al día como mucho. Los
    // hitos sin reclamar no urgen —el sitio los entrega al cerrar la temporada—,
    // pero las fichas sí se borran, y para empezar el pase hay que pulsar a mano.
    function readPass(doc) {
        const tok = doc.querySelector(SEL.passTokens);
        const started = doc.querySelector(SEL.passStarted);
        const startBtn = doc.querySelector(SEL.passStart);
        const cd = doc.querySelector(SEL.passCountdown);
        if (!tok && !started && !startBtn) return null;
        const partes = tok ? String(tok.textContent).split('/') : [];
        return {
            tokens: partes.length === 2 ? num(partes[0]) : null,
            tokensMax: partes.length === 2 ? num(partes[1]) : null,
            claimable: doc.querySelectorAll(SEL.passClaimable).length,
            // El de «sin empezar» solo se ha visto en el widget de la portada; en
            // la página del pase la clase existe en su CSS pero no se ha llegado a
            // observar, así que se acepta cualquiera de las dos.
            started: !startBtn,
            endsAt: cd ? Date.parse(cd.getAttribute('data-countdown')) : null,
            at: Date.now(),
        };
    }

    function getPass(forzar) {
        if (!forzar) {
            const now = new Date();
            const aqui = readPass(document);
            if (aqui) { store(PASS_KEY, JSON.stringify(aqui)); return Promise.resolve(aqui); }
            try {
                const guardado = JSON.parse(recall(PASS_KEY) || 'null');
                if (guardado && utcStamp(guardado.at) === utcStamp(now.getTime())) return Promise.resolve(guardado);
            } catch (e) { /* caché ilegible */ }
        }
        return pedir(PASS_URL)
            .then((html) => {
                const data = readPass(new DOMParser().parseFromString(html, 'text/html'));
                if (data) store(PASS_KEY, JSON.stringify(data));
                return data;
            })
            .catch(() => null);
    }

    // ------------------------------------------------------------------
    // Los TRES calendarios de Alienware Arena
    // ------------------------------------------------------------------
    // Descubierto el 2026-08-28 al mirar dos volcados nuevos, y hasta entonces el
    // panel solo leía uno de los tres y lo llamaba «Calendario» a secas:
    //
    //   1. **El promocional** (`.promotional-calendar__day`). Una campaña, con su
    //      botón «OBTENER ARTÍCULO» por día y 10 ARP cada uno. Sale en TODAS las
    //      páginas. Es el que el panel ya leía.
    //   2. **La racha de 7 días** (`#streak-days`, «Premios a la racha de 7 días»),
    //      de 1 a 5 ARP según el día. Se cobra sola al entrar.
    //   3. **El calendario de 28 días** (`#monthly-days-1..4`, «Recompensas de 28
    //      días de inicio de sesión diario»), de 1 a 6 ARP. También se cobra sola.
    //
    // Los dos últimos SOLO están en el Centro de control; el promocional, en todas
    // partes. Y no son redundantes entre sí: en el volcado del 2026-08-28 la racha
    // iba por el día 1 —recién rota— y el mes por el DÍA 8. O sea que «Racha día 1»
    // a secas hacía parecer que no llevabas nada cuando llevabas ocho.
    //
    // El día en curso NO se lee de la clase `current`, y ahí estuvo el fallo que
    // se veía al pulsar ⟳: esa clase la pone el JS del sitio al cargar
    //
    //     $('#streak-days .calendar-rewards__day[data-day=' + consecutive_logins['count'] + ']')
    //         .addClass('current');
    //
    // y `DOMParser` NO ejecuta scripts, así que la respuesta de `/control-center`
    // llega SIN ella. Leyendo la clase, el ⟳ devolvía `{dia: null, total: 7}` —un
    // objeto, o sea que `fusionar` lo daba por bueno y pisaba el dato correcto— y
    // la sub-línea caía a «Racha día 1», perdiendo el /7 y el mes entero.
    //
    // Es exactamente el mismo caso que los contadores del día (ver `readDailyArp`):
    // lo que el servidor sirve y lo que se ve en pantalla no son lo mismo, y un
    // volcado del DOM ya renderizado no distingue las dos cosas.
    //
    // La fuente buena son los globales que usa ese mismo JS, y esos SÍ viajan en
    // el HTML: `consecutive_logins = { "count": 1 }` y
    // `monthly_logins = { "count": 8, "extra_arp": 10 }`. Se sacan del TEXTO del
    // script, así que el mismo camino sirve para la página actual y para una
    // respuesta parseada. La clase queda de respaldo por si algún día el sitio
    // deja de emitir el global.
    //
    // El total sí se cuenta de las casillas: 7 y 28 son lo que hay hoy, no una
    // promesa del sitio.
    function leerGlobalObj(doc, nombre) {
        const re = new RegExp(nombre + '\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;');
        const scripts = doc.querySelectorAll('script');
        for (let i = 0; i < scripts.length; i++) {
            const txt = scripts[i].textContent;
            if (!txt || txt.indexOf(nombre) < 0) continue;
            const m = txt.match(re);
            if (!m) continue;
            try { return JSON.parse(m[1]); } catch (e) { /* no era JSON válido */ }
        }
        return null;
    }

    function readRejilla(doc, sel, global) {
        const dias = doc.querySelectorAll(sel);
        if (!dias.length) return null;
        const g = leerGlobalObj(doc, global);
        let actual = g && typeof g.count === 'number' ? g.count : null;
        if (actual === null) {
            dias.forEach((d) => {
                if (d.classList && d.classList.contains('current')) actual = num(d.getAttribute('data-day'));
            });
        }
        // Sin día no se devuelve media rejilla: `fusionar` solo mira si el campo
        // es null, y un `{dia: null, total: 7}` le parece un dato bueno y pisa el
        // que ya había. Un null entero conserva la última lectura buena, que es
        // el contrato del resto del panel.
        return actual === null ? null : { dia: actual, total: dias.length };
    }

    // ------------------------------------------------------------------
    // El calendario promocional, que la página tiene DOS VECES
    // ------------------------------------------------------------------
    // Hasta el 2026-08-28 esto era `claimable: !!doc.querySelector(SEL.calClaim)`
    // —«si hay botón, está por cobrar»— y decía «por reclamar» con el día ya
    // cobrado. El motivo está en el código del propio sitio:
    //
    //     $btn.remove();
    //     $('#claimed-' + day).show();
    //
    // El calendario vive en `#promotional-calendar-container`, OCULTO, y lo que
    // ves al pulsar el icono es una COPIA que `togglePromotionalCalendar()` clona
    // dentro de `.overlay-content`:
    //
    //     $('.overlay-content').html($('#promotional-calendar-container').html());
    //
    // Así que al cobrar hay dos ejemplares de cada día en el documento, y las dos
    // líneas de arriba tocan solo uno: `$btn` es el botón que pulsaste —el de la
    // copia—, y `$('#claimed-N')` resuelve por `getElementById`, o sea el PRIMERO
    // del documento, que también es el de la copia porque `.overlay-content` va
    // antes. **El original no se entera nunca.** Y al cerrar el overlay,
    // `$('.overlay-content').empty()` borra la única prueba de que cobraste.
    //
    // De ahí las tres cosas que hace esto:
    //
    //   1. Mira TODOS los ejemplares y los cruza por `data-day`. Si alguno dice
    //      que está cobrado, está cobrado: cobrar no se deshace.
    //   2. Se apunta el día cobrado, para que cerrar el overlay no lo borre.
    //   3. Decide por lo que se VE, no por lo que existe. El sitio esconde con
    //      `display:none` en línea —es lo que hacen `.show()` y `.hide()` de
    //      jQuery—, así que basta con mirar el atributo `style` propio y el de
    //      sus padres; lo que oculte una hoja de estilo no cuenta, porque el
    //      contenedor original está oculto así y de él SÍ queremos leer.
    const CAL_KEY = 'awa-arp-cal-cobrado';

    function visibleEnLinea(node) {
        if (!node) return false;
        for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
            if (/display:\s*none/i.test(n.getAttribute('style') || '')) return false;
        }
        return true;
    }

    function calCobrados() {
        try {
            const d = JSON.parse(recall(CAL_KEY) || 'null');
            if (!d || d.dia !== utcStamp(Date.now()) || !Array.isArray(d.ids)) return [];
            return d.ids;
        } catch (e) { return []; }
    }

    function apuntarCobrados(ids) {
        const ya = calCobrados();
        const todos = ya.slice();
        ids.forEach((id) => { if (id && todos.indexOf(id) < 0) todos.push(id); });
        if (todos.length !== ya.length) {
            store(CAL_KEY, JSON.stringify({ dia: utcStamp(Date.now()), ids: todos }));
        }
    }

    function readCalendar(doc) {
        const days = doc.querySelectorAll(SEL.calDay);
        if (!days.length) return null;
        const cobrados = calCobrados();
        const porDia = {};
        const vistos = [];
        days.forEach((d, i) => {
            // `data-day` es lo único estable entre los dos ejemplares: el id del
            // botón desaparece con él en cuanto se cobra.
            const clave = d.getAttribute('data-day') || ('n' + i);
            const btn = d.querySelector(SEL.calClaim);
            const marca = d.querySelector(SEL.calDone);
            const id = (btn && btn.getAttribute('data-id'))
                || (marca ? String(marca.id || '').replace(/^claimed-/, '') : '');
            const hecho = visibleEnLinea(marca);
            if (hecho && id) vistos.push(id);
            const previo = porDia[clave] || { hecho: false, boton: false, id: '' };
            porDia[clave] = {
                hecho: previo.hecho || hecho || (!!id && cobrados.indexOf(id) >= 0),
                boton: previo.boton || visibleEnLinea(btn),
                id: previo.id || id,
            };
        });
        apuntarCobrados(vistos);
        const claves = Object.keys(porDia);
        let hechos = 0, porCobrar = 0;
        claves.forEach((k) => {
            if (porDia[k].hecho) hechos++;
            else if (porDia[k].boton) porCobrar++;
        });
        return { total: claves.length, hechos: hechos, claimable: porCobrar > 0 };
    }

    // ------------------------------------------------------------------
    // Tooltips propios
    // ------------------------------------------------------------------
    // Mismo motor que kick-drops-highlighter e indiegala-bulk-join, y por los
    // mismos motivos: caja colgada del <body>, delegación en `document` leyendo
    // el `title` YA PUESTO, y el `title` guardado en un atributo mientras la caja
    // está arriba y devuelto al cerrarla —sigue siendo el respaldo y el nombre
    // accesible—. Así un control se documenta poniéndole su `title` y nada más.
    //
    // Aquí hace más falta que en otros sitios: Alienware Arena usa Bootstrap y
    // pinta sus propios tooltips, que salían por encima de los del navegador.
    const TIP_ID = 'awa-arp-tip';
    const TIP_STASH = 'data-awa-tip';
    // Al ratón se le da un cuarto de segundo: sin retardo, cruzar el panel
    // enciende y apaga seis cajas seguidas. Por teclado sale al instante, porque
    // llegar tabulando ya es intención.
    const TIP_DELAY_MS = 250;
    const TIP_GAP = 10;
    const TIP_MARGIN = 8;
    // Solo lo nuestro. Un `title` de AWA sigue saliendo con la caja del
    // navegador, como hasta ahora.
    const TIP_SCOPE = '#' + WIDGET_ID + ', .awa-keys, .awa-tag, .awa-modal';
    const TIP_SELECTOR = '[title], [' + TIP_STASH + ']';

    let _tipEl = null;
    let _tipAnchor = null;
    let _tipTimer = null;

    function _tipNode() {
        if (_tipEl && document.body.contains(_tipEl)) return _tipEl;
        _tipEl = noTraducir(el('div'));
        _tipEl.id = TIP_ID;
        // Es un aviso, y decirlo cuesta un atributo: así un lector de pantalla no
        // lo lee como un párrafo suelto aparecido de la nada.
        _tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(_tipEl);
        return _tipEl;
    }

    // El peso 600 se reserva para los avisos que son UN VALOR —«15 ARP», «6d 5h»—,
    // no para la prosa. Es la única diferencia entre los dos tipos de aviso, y
    // vive en el texto y no en la caja: dos cajas distintas en el mismo panel se
    // leerían como dos cosas distintas.
    function _tipIsValue(text) {
        return /\d/.test(text) && text.length <= 40;
    }

    // Dos reglas según dónde viva el control, porque el sitio libre no está en el
    // mismo lado:
    //   - En el PANEL, al lado del panel entero y centrada en el control. El panel
    //     es estrecho y sus filas van apiladas, así que una caja encima del control
    //     taparía al de arriba; anclando al panel todos los avisos salen alineados
    //     en la misma columna en vez de bailar. Si a ese lado no cabe, al otro.
    //   - En la página, encima del control y centrada en él. Si arriba no cabe,
    //     debajo.
    function _positionTip(anchor) {
        const box = _tipNode().getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const panel = anchor.closest('#' + WIDGET_ID);
        let left, top;
        if (panel) {
            const p = panel.getBoundingClientRect();
            left = p.left - box.width - TIP_GAP;
            if (left < TIP_MARGIN) left = p.right + TIP_GAP;
            top = a.top + a.height / 2 - box.height / 2;
        } else {
            left = a.left + a.width / 2 - box.width / 2;
            top = a.top - box.height - TIP_GAP;
            if (top < TIP_MARGIN) top = Math.min(a.bottom + TIP_GAP, vh - box.height - TIP_MARGIN);
        }
        left = Math.max(TIP_MARGIN, Math.min(left, vw - box.width - TIP_MARGIN));
        top = Math.max(TIP_MARGIN, Math.min(top, vh - box.height - TIP_MARGIN));
        _tipEl.style.left = Math.round(left) + 'px';
        _tipEl.style.top = Math.round(top) + 'px';
    }

    function showTip(anchor) {
        const text = anchor.getAttribute('title') || anchor.getAttribute(TIP_STASH);
        if (!text) return;
        // Se guarda y se quita el title mientras la caja está arriba, para que el
        // navegador no pinte la suya encima de la nuestra.
        if (anchor.hasAttribute('title')) {
            anchor.setAttribute(TIP_STASH, text);
            anchor.removeAttribute('title');
        }
        const node = _tipNode();
        node.textContent = text;
        node.style.fontWeight = _tipIsValue(text) ? '600' : '400';
        node.classList.add('awa-tip--on');
        _tipAnchor = anchor;
        _positionTip(anchor);
    }

    function hideTip() {
        clearTimeout(_tipTimer);
        if (_tipAnchor && _tipAnchor.hasAttribute(TIP_STASH)) {
            _tipAnchor.setAttribute('title', _tipAnchor.getAttribute(TIP_STASH));
            _tipAnchor.removeAttribute(TIP_STASH);
        }
        _tipAnchor = null;
        if (_tipEl) _tipEl.classList.remove('awa-tip--on');
    }

    function _tipTargetFrom(node) {
        if (!node || !node.closest) return null;
        const scope = node.closest(TIP_SCOPE);
        if (!scope) return null;
        const target = node.closest(TIP_SELECTOR);
        return target && scope.contains(target) ? target : null;
    }

    function bindTips() {
        // La caja se crea ya, y no en el primer hover: así queda marcada como no
        // traducible desde el principio y no hay un salto de medida la primera vez
        // que se coloca.
        _tipNode();
        document.addEventListener('mouseover', (e) => {
            const target = _tipTargetFrom(e.target);
            if (!target || target === _tipAnchor) return;
            hideTip();
            _tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
        });
        document.addEventListener('mouseout', (e) => {
            if (_tipTargetFrom(e.target)) hideTip();
        });
        document.addEventListener('focusin', (e) => {
            const target = _tipTargetFrom(e.target);
            if (target) { hideTip(); showTip(target); }   // por teclado, sin retardo
        });
        document.addEventListener('focusout', hideTip);
        window.addEventListener('scroll', hideTip, { passive: true });
    }

    // Poner el aviso es poner el title, y el motor hace el resto. Se mantiene el
    // nombre corto porque se usa en cada fila.
    function tip(node, text) {
        if (text) {
            node.setAttribute('title', text);
            // Sin esto no hay tooltip por teclado en un div, que es lo que son las
            // filas del panel.
            if (!node.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
                node.setAttribute('tabindex', '0');
            }
        }
        return node;
    }

    // ------------------------------------------------------------------
    // El aviso: un diálogo
    // ------------------------------------------------------------------
    // Aquí hubo un sonido, y se quitó el 2026-08-27 después de tres intentos de
    // hacerlo sonar en Alienware Arena. Lo que se probó y por qué no bastó:
    //
    //   1. **Desbloqueo por gesto.** Al primer clic se reproducía el fichero en
    //      silencio para que el navegador diera por consentido el resto de la
    //      carga. No fue suficiente.
    //   2. **Beep sintetizado de respaldo.** Cae por LO MISMO —la política de
    //      autoplay— así que el respaldo tenía la misma dependencia que aquello
    //      de lo que era respaldo.
    //   3. **Normalizar el fichero.** Picaba a −13 dBFS, once por debajo del que
    //      usa steamgifts-points-value; se subió a −2. Tampoco.
    //
    // Y el dato que cierra la discusión: `steamgifts-points-value` hace MENOS
    // —`new Audio(x).play().catch(()=>{})`, sin desbloqueo ni respaldo— y ahí sí
    // suena. O sea que el problema no está en el código, y desde dentro de la
    // página no hay más palancas: no se puede seguir arreglando lo que no se
    // controla.
    //
    // Es la MISMA conclusión a la que llegó indiegala-bulk-join, y por el mismo
    // camino: allí el sonido entró y salió dos veces antes de quitarse en 1.10.5.
    // Dos sitios distintos, dos veces el mismo final. Lo que alcanza a alguien
    // que no está mirando es un DIÁLOGO, que congela el hilo y hay que cerrar.
    //
    // Quedan tres canales, y ninguno depende de un permiso que no tenemos:
    //   - el diálogo, que interrumpe;
    //   - la marca 👽 en el título, que se ve desde otra pestaña;
    //   - la banda del panel, que se queda hasta que la marcas.

    // El diálogo va en un timeout de cero, y NO es cosmética: `alert()` congela el
    // hilo, así que lo que no esté pintado antes no se ve hasta que lo cierras.
    // Dejarlo para el siguiente turno da tiempo a que el panel se repinte con su
    // banda y a que la marca 👽 esté en el título, de modo que al cerrar el
    // diálogo el aviso sigue estando en algún sitio. El comentario equivalente
    // lleva años escrito en indiegala-bulk-join.
    //
    // Y NO SALE EN UNA PESTAÑA DE FONDO. El navegador se queda el `alert()` de una
    // pestaña que no estás mirando: no lo pinta, y la llamada vuelve sin haber
    // enseñado nada. O sea que el aviso se gastaba justo cuando más falta hacía
    // —el aviso existe para cuando NO estás mirando— y desde dentro no se puede
    // traer la pestaña al frente: `window.focus()` lo ignoran todos.
    //
    // Así que se espera. El texto se guarda y sale en cuanto vuelves a la pestaña,
    // que es cuando un diálogo puede hacer su trabajo. Mientras tanto llaman los
    // otros dos canales, que sí se ven desde fuera: el título y el favicon.
    let _dialogoPendiente = null;

    function dialogo(texto) {
        if (!texto) return;
        if (document.hidden) { _dialogoPendiente = texto; return; }
        setTimeout(() => {
            try { alert(texto); } catch (e) { /* sin diálogos */ }
        }, 0);
    }

    // Al volver a la pestaña. Se consume: un diálogo aplazado sale una vez.
    function soltarDialogoPendiente() {
        if (document.hidden || !_dialogoPendiente) return;
        const texto = _dialogoPendiente;
        _dialogoPendiente = null;
        dialogo(texto);
    }

    // ------------------------------------------------------------------
    // La pestaña: título y favicon
    // ------------------------------------------------------------------
    // Los dos canales que se ven SIN estar en la pestaña, que es justo donde el
    // sonido no llegaba y el diálogo se queda esperando. Es el patrón de toda la
    // vida —el de Gmail y el de Slack—: la tira de pestañas es el único sitio de
    // la pantalla que sigue ahí cuando estás en otra cosa.
    //
    // El alienígena y no un reloj: entre veinte pestañas, lo que hace que la
    // encuentres de un vistazo es que la marca sea RECONOCIBLE como este sitio,
    // no que describa el motivo. El motivo ya lo cuenta el panel al volver.
    const TITLE_MARK = '👽';
    let tituloBase = null;

    // Un SVG y no un canvas. El favicon del sitio vive en media.alienwarearena.com
    // —otro origen—, así que dibujarlo en un canvas lo mancha y `toDataURL()`
    // lanza: no se puede componer una insignia ENCIMA del suyo. Y un canvas
    // tampoco hace falta: un `data:` con SVG vale de favicon desde hace años y es
    // una cadena, o sea que se puede comprobar sin pintar nada.
    const FAVICON_ID = 'awa-arp-favicon';
    const FAVICON_SVG = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        + '<rect width="64" height="64" rx="14" fill="#11161d"/>'
        + '<circle cx="52" cy="12" r="10" fill="#ffcf66"/>'
        + '<text x="30" y="48" font-size="40" text-anchor="middle">👽</text></svg>');

    // Los iconos del sitio se DESACTIVAN quitándoles el `rel`, no se borran: así
    // el nodo sigue donde estaba —si el sitio repinta la cabecera, no le falta
    // nada— y devolverlos es exacto. AWA trae cuatro (48, 32, 16 y el .ico).
    function marcarFavicon() {
        try {
            if (document.getElementById(FAVICON_ID)) return;
            document.querySelectorAll('link[rel~="icon"]').forEach((l) => {
                l.setAttribute('data-awa-icon-rel', l.getAttribute('rel') || 'icon');
                l.removeAttribute('rel');
            });
            const link = el('link');
            link.id = FAVICON_ID;
            link.rel = 'icon';
            link.type = 'image/svg+xml';
            link.href = FAVICON_SVG;
            (document.head || document.documentElement).appendChild(link);
        } catch (e) { /* sin cabecera */ }
    }

    function limpiarFavicon() {
        try {
            const nuestro = document.getElementById(FAVICON_ID);
            if (nuestro) nuestro.remove();
            document.querySelectorAll('link[data-awa-icon-rel]').forEach((l) => {
                l.setAttribute('rel', l.getAttribute('data-awa-icon-rel'));
                l.removeAttribute('data-awa-icon-rel');
            });
        } catch (e) { /* sin cabecera */ }
    }

    function marcarTitulo() {
        marcarFavicon();
        if (tituloBase !== null) return;
        try {
            tituloBase = document.title;
            document.title = TITLE_MARK + ' ' + tituloBase;
        } catch (e) { tituloBase = null; }
    }

    function limpiarTitulo() {
        limpiarFavicon();
        // El diálogo aplazado se va con la marca: si ya lo diste por visto, no
        // tiene ningún sentido que salte al volver a la pestaña.
        _dialogoPendiente = null;
        if (tituloBase === null) return;
        try { document.title = tituloBase; } catch (e) { /* sin título */ }
        tituloBase = null;
    }

    // El título no es nuestro. Si el sitio lo reescribe, la marca se pierde en
    // silencio, así que se vuelve a poner encima de lo que haya dejado él.
    function vigilarTitulo() {
        if (tituloBase === null) return;
        if (document.title.indexOf(TITLE_MARK) === 0) return;
        tituloBase = document.title;
        try { document.title = TITLE_MARK + ' ' + tituloBase; } catch (e) { /* sin título */ }
    }

    function alertsOn() { return recall(ALERT_KEY) === '1'; }

    // La constancia de lo que ha sonado y aún no se ha marcado como visto:
    // `{ avisos: [{tipo, etiquetas, hasta, cada}], sonoEn }`. Vive en
    // localStorage para sobrevivir a cambiar de página —un aviso que se pierde al
    // navegar es un sonido que te perdiste, no un aviso— y para que con tres
    // pestañas abiertas suene una vez y no tres.
    function leerAviso() {
        try {
            const a = JSON.parse(recall(AVISO_KEY) || 'null');
            // Ilegible, vacío o con la forma vieja: se borra en vez de quedarse
            // pegado. Sin esto, quien venga de una versión anterior arrastraría un
            // valor muerto que nunca se limpia.
            if (!a || !a.avisos || !a.avisos.length) {
                if (recall(AVISO_KEY)) store(AVISO_KEY, null);
                return null;
            }
            // Cada uno se retira solo al pasar SU hora: avisar de un día que ya
            // acabó no sirve de nada.
            const vivos = a.avisos.filter((x) => x && typeof x.hasta === 'number' && Date.now() <= x.hasta);
            if (!vivos.length) { store(AVISO_KEY, null); return null; }
            return { avisos: vivos, sonoEn: a.sonoEn || 0 };
        } catch (e) { return null; }
    }

    function guardarAviso(avisos, sonoEn) {
        store(AVISO_KEY, JSON.stringify({ avisos: avisos, sonoEn: sonoEn }));
    }

    // Marcar como visto es lo ÚNICO que calla un aviso antes de que caduque su
    // ventana. Por eso escribe aquí las marcas de cada tipo, y no al sonar.
    function marcarVisto() {
        const a = leerAviso();
        if (a) {
            const now = new Date();
            a.avisos.forEach((x) => {
                if (x.tipo === 'dawn') store(VISTO_DAWN_KEY, utcStamp(now.getTime()));
                else if (x.tipo === 'day') store(VISTO_DIA_KEY, utcStamp(now.getTime()));
                else if (x.tipo === 'week') store(VISTO_SEMANA_KEY, utcDate(now.getTime() + msToWeekReset(now)));
            });
        }
        store(AVISO_KEY, null);
        limpiarTitulo();
        // Y se suelta la memoria de qué tanda ya abrió diálogo aquí: si no, tras
        // rearmar la casilla el aviso volvería sin su diálogo.
        _dialogoEn = '';
    }

    // Lo contrario de marcarVisto: borra las tres marcas y la constancia, de modo
    // que los avisos que tocarían ahora vuelven a tocar. Lo usa la casilla.
    function olvidarVistos() {
        store(VISTO_DAWN_KEY, null);
        store(VISTO_DIA_KEY, null);
        store(VISTO_SEMANA_KEY, null);
        store(AVISO_KEY, null);
        limpiarTitulo();
        // Y se suelta la memoria de qué tanda ya abrió diálogo aquí: si no, tras
        // rearmar la casilla el aviso volvería sin su diálogo.
        _dialogoEn = '';
    }

    // El día del sitio que se estaba viendo la última vez que se miró. Sirve SOLO
    // para releer al cruzar la medianoche: el aviso de amanecer ya no depende de
    // observar el cambio, sino de estar dentro de sus primeros treinta minutos
    // —que es lo mismo pero sin perderse si abres la pestaña a las 00:10—.
    let _diaVisto = utcStamp(Date.now());

    function amaneció() {
        const hoy = utcStamp(Date.now());
        if (hoy === _diaVisto) return false;
        _diaVisto = hoy;
        return true;
    }

    // Qué avisos están VIVOS ahora mismo: su ventana abierta, su condición
    // cumplida y sin marcar como vistos. No decide si suena —eso es de más
    // abajo—, solo dice qué hay.
    function avisosVivos(daily, pass, pendientes, now) {
        const vivos = [];
        const hoy = utcStamp(now.getTime());
        const left = msToDailyReset(now);
        const ventana = ALERT_MINUTES * 60 * 1000;

        // 1. Empieza el día. Su ventana NO son los primeros treinta minutos: es
        //    TODO el día, hasta que lo marques. Un aviso que solo existe entre
        //    las 00:00 y las 00:30 UTC se lo pierde quien no tenga el sitio
        //    abierto a esa hora —o sea, casi todo el mundo casi siempre—, y el
        //    aviso está justo para eso: para que al entrar sepas que hay tareas
        //    nuevas. No pide datos: «empieza el día» es cierto se pueda leer el
        //    sitio o no, y al cruzar la medianoche la relectura puede no haber
        //    llegado.
        //
        //    La única hora en que se calla es la última media hora, que es la
        //    ventana del aviso contrario. «Empieza un día nuevo» a las 23:40 no
        //    es que llegue tarde: es que dice lo contrario de lo que pasa, y
        //    además saldría en la misma banda que «se acaba el día».
        //
        //    Insiste cada cinco minutos mientras es NOTICIA —la primera media
        //    hora— y cada media hora el resto del día. A cinco minutos durante
        //    veinticuatro horas serían casi trescientos avisos.
        const reciente = 24 * 60 * 60 * 1000 - left < ventana;
        if (left > ventana && recall(VISTO_DAWN_KEY) !== hoy) {
            vivos.push({ tipo: 'dawn', etiquetas: [], hasta: now.getTime() + left,
                cada: reciente ? ALERT_REPEAT_MS : ALERT_REPEAT_WEEK_MS });
        }

        if (!daily) return vivos;

        // 2. Las seis horas antes de que acabe la semana de Steam.
        const paraLaSemana = msToWeekReset(now);
        const semana = utcDate(now.getTime() + paraLaSemana);
        if (paraLaSemana <= ALERT_WEEK_HOURS * 60 * 60 * 1000
            && pendientes.indexOf('qSteam') >= 0
            && recall(VISTO_SEMANA_KEY) !== semana) {
            vivos.push({ tipo: 'week', etiquetas: [t('qSteam')],
                hasta: now.getTime() + paraLaSemana, cada: ALERT_REPEAT_WEEK_MS });
        }

        // 3. La media hora antes de que acabe el día. Lo de Steam NO entra: tiene
        //    su propio aviso, y meterlo aquí sonaría cada noche de la semana por
        //    algo que no vence hasta el lunes.
        if (left <= ventana && recall(VISTO_DIA_KEY) !== hoy) {
            const delDia = pendientes.filter((k) => k !== 'qSteam');
            // La única cosa que urge sin salir en amarillo: los hitos del pase se
            // entregan solos al cerrar, pero las FICHAS se borran. Si la temporada
            // cierra esta noche y quedan sin gastar, son 100, 200 o 500 ARP.
            const temporadaAcaba = !!(pass && pass.endsAt
                && pass.endsAt > now.getTime() && pass.endsAt - now.getTime() <= left);
            if (delDia.length || (temporadaAcaba && !!(pass && pass.tokens))) {
                vivos.push({ tipo: 'day', etiquetas: delDia.map((k) => t(k)),
                    hasta: now.getTime() + left, cada: ALERT_REPEAT_MS });
            }
        }
        return vivos;
    }

    function tiposDe(avisos) { return avisos.map((a) => a.tipo).sort().join(','); }

    // Qué tanda de avisos ya abrió diálogo EN ESTA CARGA de la página. Vive en
    // memoria a propósito, y ahí está el fallo que arregla: la constancia vive en
    // localStorage y SOBREVIVE a cambiar de página, así que decidir el diálogo
    // con ella lo hacía salir la primerísima vez y nunca más. Si el primero te
    // pilló en otra pestaña, ya no lo veías —y tocar la casilla lo «arreglaba»
    // solo de rebote, porque borra la constancia—.
    //
    // Con esto, cada página que abras con un aviso sin marcar te lo dice una vez.
    // Es más insistente, y es lo correcto: el diálogo es el ÚNICO canal que
    // interrumpe, y lo que lo calla —marcar la banda— está a un clic.
    let _dialogoEn = '';

    // El texto de un aviso, en un solo sitio: lo usan la banda del panel y el
    // diálogo. Tenerlo dos veces es cómo el tooltip acabó mintiendo (§14.x).
    function textoAviso(a) {
        return [t('avi' + a.tipo)].concat(a.etiquetas.length
            ? [a.etiquetas.join(' · ')] : []).join(' — ');
    }

    // Decide si suena. Devuelve true cuando ha sonado, para que el panel repinte:
    // la banda del aviso no existía cuando se dibujó.
    function evaluarAvisos(daily, cal, pass, discord, pendientes) {
        if (!alertsOn()) return false;
        const now = new Date();
        const vivos = avisosVivos(daily, pass, pendientes, now);
        const guardado = leerAviso();

        if (!vivos.length) {
            // Fuera de ventana, pero la banda se queda si no la has marcado: la
            // ventana limita el RUIDO, no el recordatorio.
            if (!guardado && !vivos.length && !recall(AVISO_KEY)) {
                try {
                    const left = msToDailyReset(now);
                    if (left <= ALERT_MINUTES * 60 * 1000) {
                        console.warn('[AWA-ARP] se acaba el día, pero no queda nada del día pendiente:', {
                            minutosParaElReinicio: Math.round(left / 60000),
                            enAmarillo: pendientes,
                            horasParaLaSemanaDeSteam: Math.round(msToWeekReset(now) / 3600000),
                        });
                    }
                } catch (e) { /* sin consola */ }
            }
            return false;
        }

        // Suena si es la primera vez, si ha cambiado QUÉ está vivo, o si ya toca
        // recordarlo. El intervalo lo manda el aviso más impaciente de los vivos.
        const cada = Math.min.apply(null, vivos.map((a) => a.cada));
        const cambio = !guardado || tiposDe(guardado.avisos) !== tiposDe(vivos);
        const toca = cambio || (Date.now() - guardado.sonoEn >= cada);
        guardarAviso(vivos, toca ? Date.now() : guardado.sonoEn);

        // El diálogo NO se abre aquí: lo abre quien pinta la banda (ver
        // renderDaily). Los dos dicen lo mismo, así que salen del mismo sitio.
        if (!toca) return false;
        marcarTitulo();
        return true;
    }

    // ------------------------------------------------------------------
    // Ficha del script
    // ------------------------------------------------------------------
    // La misma forma que en los demás scripts del catálogo, y por los mismos
    // motivos: cabecera fija con la ficha en dos columnas, cuerpo con la prosa
    // que SÍ scrollea —si scrollease la caja entera se iría el título y habría
    // que bajar hasta el final para encontrar el botón—, y un «Aceptar» centrado.
    // El alto no es fijo porque la descripción cambia de largo con el idioma.
    function openInfo() {
        if (document.getElementById('awa-arp-modal')) return;

        const overlay = noTraducir(el('div'));
        overlay.id = 'awa-arp-modal';
        overlay.className = 'awa-modal';
        const box = el('div', 'awa-modal__box');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', t('infoTitle'));

        const head = el('div', 'awa-modal__head');
        head.appendChild(el('div', 'awa-modal__title', t('infoTitle')));

        const meta = el('div', 'awa-modal__meta');
        [
            [t('infoName'), 'Alienware Arena ARP Tracker', null],
            [t('infoVersion'), SCRIPT_VERSION, null],
            [t('infoAuthor'), 'g31w0fw0rld', null],
            [t('infoGitHub'), 'github.com/g31w0fw0rld/alienware-arena-arp-tracker', 'https://github.com/g31w0fw0rld/alienware-arena-arp-tracker'],
            ['☕ Ko-fi:', 'ko-fi.com/g31w0fw0rld', 'https://ko-fi.com/g31w0fw0rld'],
        ].forEach(([label, value, href]) => {
            meta.appendChild(el('div', 'awa-modal__k', label));
            const v = el('div', 'awa-modal__v');
            if (href) {
                const a = el('a', null, value);
                a.href = href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                v.appendChild(a);
            } else v.textContent = value;
            meta.appendChild(v);
        });
        head.appendChild(meta);
        box.appendChild(head);
        box.appendChild(el('div', 'awa-modal__hr'));

        const body = el('div', 'awa-modal__body');
        [
            [t('infoDescription'), [t('infoDescriptionText')]],
            // Los cinco párrafos de «cómo funciona esto» viven aquí, que es donde
            // caben: son lo que no se puede explicar en un tooltip de una línea.
            [t('title'), [t('mDaily'), t('mQuests'), t('mTwitch'), t('mLate')]],
            [t('infoPrivacy'), [t('infoPrivacyText'), t('mIntro')]],
        ].forEach(([titulo, parrafos], n) => {
            const h = el('div', 'awa-modal__h');
            // Sin los dos puntos: ya no encabeza una línea, encabeza un bloque. Se
            // quitan también los de ancho completo del chino y el espacio previo
            // del francés.
            h.textContent = String(titulo).replace(/\s*[:：]\s*$/, '');
            if (n) h.classList.add('awa-modal__h--sep');
            body.appendChild(h);
            parrafos.forEach((texto) => body.appendChild(el('p', null, texto)));
        });
        box.appendChild(body);
        box.appendChild(el('div', 'awa-modal__hr'));

        const foot = el('div', 'awa-modal__foot');
        const ok = el('button', 'awa-modal__btn', t('accept'));
        foot.appendChild(ok);
        box.appendChild(foot);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const cerrar = () => {
            hideTip();
            document.removeEventListener('keydown', esc);
            overlay.classList.remove('awa-modal--on');
            setTimeout(() => overlay.remove(), 180);
        };
        function esc(e) { if (e.key === 'Escape') cerrar(); }
        ok.addEventListener('click', cerrar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
        document.addEventListener('keydown', esc);

        // La animación necesita un cuadro con la clase puesta antes de quitarla.
        setTimeout(() => overlay.classList.add('awa-modal--on'), 10);
        // Sin esto el foco se queda en el ℹ️ del panel, detrás del overlay.
        setTimeout(() => ok.focus(), 140);
    }

    // ------------------------------------------------------------------
    // Panel
    // ------------------------------------------------------------------
    function line(label, value, tipText, tone) {
        const row = el('div', 'awa-w__line' + (tone ? ' awa-w__line--' + tone : ''));
        row.appendChild(el('span', 'awa-w__k', label));
        row.appendChild(el('span', 'awa-w__v', value));
        return tip(row, tipText);
    }

    function readPos() {
        const v = recall(POS_KEY);
        return POSITIONS.indexOf(v) >= 0 ? v : 'tr';
    }

    function applyPos(box, pos) {
        POSITIONS.forEach((p) => box.classList.remove('awa-w--' + p));
        box.classList.add('awa-w--' + pos);
    }

    function buildWidget(acc, alCambiarAlerta) {
        const box = noTraducir(el('div'));
        box.id = WIDGET_ID;
        applyPos(box, readPos());

        const head = el('div', 'awa-w__head');
        head.appendChild(el('strong', 'awa-w__title', t('title')));

        const tools = el('div', 'awa-w__tools');
        // El panel arranca arriba a la derecha y no abajo, porque abajo a la
        // derecha vive el selector de idiomas de AWA —fijo, y se despliega hacia
        // arriba—, y abajo a la izquierda su botón de cookies. Este botón rota
        // por las cuatro esquinas por si en alguna página estorba igual.
        const mover = el('button', 'awa-w__btn', '⤡');
        tip(mover, t('move'));
        mover.addEventListener('click', () => {
            const next = POSITIONS[(POSITIONS.indexOf(readPos()) + 1) % POSITIONS.length];
            store(POS_KEY, next);
            applyPos(box, next);
            hideTip();
        });
        tools.appendChild(mover);

        // El ℹ️ va en la cabecera, como en los demás scripts, y no como un botón
        // ancho al pie: la ficha no es una acción del panel, es su documentación.
        const info = el('button', 'awa-w__btn awa-w__btn--info', 'ℹ️');
        tip(info, t('info'));
        info.addEventListener('click', openInfo);
        tools.appendChild(info);

        const fold = el('button', 'awa-w__btn', '–');
        tip(fold, t('fold'));
        fold.addEventListener('click', () => {
            const hidden = box.classList.toggle('awa-w--folded');
            fold.textContent = hidden ? '+' : '–';
            store(FOLD_KEY, hidden ? '1' : null);
        });
        tools.appendChild(fold);
        head.appendChild(tools);
        box.appendChild(head);

        const body = el('div', 'awa-w__body');
        box.appendChild(body);
        if (recall(FOLD_KEY) === '1') { box.classList.add('awa-w--folded'); fold.textContent = '+'; }

        const acct = el('div', 'awa-w__acct');
        tip(acct, t('tipAcct'));
        if (acc.balance !== null) acct.appendChild(el('span', 'awa-w__arp', t('balance', { v: nf.format(acc.balance) })));
        _txtSub = el('span', 'awa-w__sub');
        acct.appendChild(_txtSub);
        pintarSub(acc, null);
        body.appendChild(acct);

        const list = el('div', 'awa-w__list');
        body.appendChild(list);

        const relojes = el('div', 'awa-w__clocks');
        body.appendChild(relojes);

        // El botón de actualizar es TAMBIÉN el reloj del dato, y por eso está
        // aquí y no arriba: un icono de 14 px metido entre otros tres se falla
        // con el ratón y no se encuentra con la vista. Una fila entera, con su
        // texto —«↻ hace 3 minutos»—, se ve, se lee y se acierta; y decir cuándo
        // se leyó es justo lo que hace falta para saber si vale la pena pulsar.
        // Lo cablea boot(), que es quien sabe leer.
        const refrescar = el('button', 'awa-w__refresh');
        refrescar.appendChild(el('span', 'awa-w__spin', '↻'));
        _txtEdad = el('span', 'awa-w__age');
        refrescar.appendChild(_txtEdad);
        pintarEdad();
        tip(refrescar, t('tipRefresh'));
        refrescar.setAttribute('aria-label', t('refresh'));
        body.appendChild(refrescar);

        const foot = el('div', 'awa-w__foot');
        const alerta = el('label', 'awa-w__check');
        const box2 = el('input');
        box2.type = 'checkbox';
        box2.checked = alertsOn();
        // Tocar la casilla OLVIDA lo ya notificado, en los dos sentidos. Es la
        // única forma que hay de recuperar un aviso que marcaste sin querer —o de
        // volver a verlo—, y no hace falta explicarla: apagar y encender es lo que
        // ya hace todo el mundo cuando algo no responde.
        //
        // Y al encender **vuelve a avisar en el acto**, si es que había algo que
        // avisar: es la respuesta a lo que acabas de pedir. También es la forma de
        // ver el aviso sin esperar a que llegue su hora.
        box2.addEventListener('change', () => {
            store(ALERT_KEY, box2.checked ? '1' : null);
            olvidarVistos();
            if (alCambiarAlerta) alCambiarAlerta();
        });
        alerta.appendChild(box2);
        alerta.appendChild(el('span', null, t('alertOn')));
        tip(alerta, t('tipAlert'));
        foot.appendChild(alerta);

        const langRow = el('div', 'awa-w__lang-row');
        langRow.appendChild(el('span', null, t('langLabel')));
        const sel = el('select', 'awa-w__lang');
        const opciones = [['', t('auto')]].concat(LANGS.map((l) => [l, {
            en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français',
            pt: 'Português', br: 'Português (BR)', zh: '中文', hi: 'हिन्दी',
        }[l]]));
        opciones.forEach(([v, label]) => {
            const o = el('option', null, label);
            o.value = v;
            if (v === readLangPref()) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => { saveLangPref(sel.value); location.reload(); });
        tip(sel, t('tipLang'));
        langRow.appendChild(sel);
        foot.appendChild(langRow);

        body.appendChild(foot);
        return { box, list, relojes, refrescar };
    }

    // Toda cifra del panel se pinta igual: HECHO/TOTAL, y una marca verde cuando
    // ya está. El «hecho» a secas de antes escondía el dato —cinco de cinco y
    // quince de quince se leían igual— y obligaba a abrir el Centro de control
    // para saber de cuánto se hablaba. La marca es lo que se ve de un vistazo;
    // el número es lo que contesta «¿cuánto me falta?».
    const OK_MARK = ' ✅';

    function cuenta(v, total, hecho) {
        return t('ofCap', { v: nf.format(v), c: nf.format(total) }) + (hecho ? OK_MARK : '');
    }

    // ------------------------------------------------------------------
    // Las líneas que se cumplen EN OTRO SITIO
    // ------------------------------------------------------------------
    // Casi todo el panel dice QUÉ falta; estas dicen además DÓNDE se hace. La
    // flecha va con la etiqueta y no con la cifra: pertenece a lo que se abre,
    // no al dato.
    //
    // Ninguna de ellas cobra nada. Llevar a una página no es reclamar: lo que
    // pasa por el captcha lo sigue pulsando el usuario, y la promesa de «solo
    // lee» sigue en pie.
    function enlazar(fila, ir) {
        if (!fila || !ir) return;
        fila.classList.add('awa-w__line--go');
        fila.querySelector('.awa-w__k').appendChild(el('span', 'awa-w__go', ' ↗'));
        fila.addEventListener('click', () => { hideTip(); ir(); });
    }

    // Un destino del propio sitio. Devuelve null si YA ESTÁS AHÍ, y por eso no
    // devuelve la función directamente: una flecha que no te mueve es peor que
    // ninguna flecha, porque promete algo y no pasa nada.
    function irA(ruta) {
        const aqui = location.pathname.replace(/\/+$/, '');
        if (aqui === ruta.replace(/\/+$/, '')) return null;
        return () => { location.href = ruta; };
    }

    // Fuera del sitio: pestaña nueva y sin `opener`, que es lo mínimo al abrir
    // algo de terceros desde una página que no es nuestra.
    function irFuera(url) {
        return () => {
            try { window.open(url, '_blank', 'noopener,noreferrer'); }
            catch (e) { /* el navegador lo bloqueó */ }
        };
    }

    // El aviso de una línea con enlace lleva pegado a dónde va; sin enlace, no
    // lo dice, que sería prometer un clic que no hace nada.
    function tipMas(base, clave) {
        return clave ? base + ' ' + t(clave) : base;
    }

    function renderDaily(list, relojes, daily, cal, pass, discord, acc) {
        list.textContent = '';
        relojes.textContent = '';
        pintarSub(acc, daily);

        // La lista de lo pendiente se hace AQUÍ, mientras se pinta, y es la misma
        // que decide el aviso: **si sale en amarillo, entra**. Calcularla aparte
        // era tener dos ideas de «pendiente» que acabaron contradiciéndose (ver
        // evaluarAvisos).
        // Guarda la CLAVE i18n y no la etiqueta: quien decide los avisos tiene que
        // poder distinguir «qSteam» del resto, y hacerlo por el texto pintado
        // sería casar contra ocho traducciones.
        const pendientes = [];
        // Los tres destinos, calculados una vez: `irA` devuelve null si ya estás
        // en esa página, y de eso depende tanto la flecha como el aviso.
        const aCC = irA(CC_URL);
        const aPase = irA(PASS_URL);
        const pinta = (clave, label, value, tipText, tone) => {
            if (tone === 'todo') pendientes.push(clave);
            return list.appendChild(line(label, value, tipText, tone));
        };

        // Lo primero del panel, porque es lo único que exige una respuesta. Se
        // queda hasta que la marcas —no se borra por volver a la pestaña— y con
        // ella se va la marca 👽 del título.
        const aviso = leerAviso();
        if (aviso) {
            const banda = el('div', 'awa-w__alert');
            banda.setAttribute('role', 'status');
            const textos = el('div', 'awa-w__alert-txt');
            // Puede haber más de uno vivo a la vez: el domingo por la noche la
            // semana de Steam y el fin del día se solapan. Van los dos, y un solo
            // «visto» los calla a los dos.
            aviso.avisos.forEach((a) => {
                textos.appendChild(el('div', null, textoAviso(a)));
            });

            // El diálogo va CON LA BANDA y no con la decisión de avisar, porque
            // son la misma cosa vista de dos maneras y tenerlos en dos sitios ya
            // se pagó: la banda sale de la constancia guardada, que sobrevive a
            // cambiar de página, mientras que la decisión se recalcula y necesita
            // datos. En una página donde no se pueden leer —la portada, por
            // ejemplo— salía la banda y no salía el diálogo.
            //
            // Una vez por CARGA de página y por tanda: ni en cada recordatorio
            // —un modal cada cinco minutos es un secuestro— ni una sola vez en la
            // vida del aviso, que es lo que lo hacía desaparecer en cuanto
            // cambiabas de página.
            const tipos = tiposDe(aviso.avisos);
            if (_dialogoEn !== tipos) {
                _dialogoEn = tipos;
                dialogo('👽 Alienware Arena\n\n'
                    + aviso.avisos.map(textoAviso).join('\n') + '\n\n' + t('aviMudo'));
            }
            banda.appendChild(textos);
            banda.appendChild(el('span', 'awa-w__alert-x', '✕'));
            tip(banda, t('aviSeen'));
            // El clic vale en toda la banda y no solo en la ✕: es lo que se quiere
            // pulsar, y una diana de 8 px es una diana que se falla.
            banda.addEventListener('click', () => {
                marcarVisto();
                hideTip();
                banda.remove();
            });
            list.appendChild(banda);
        }

        if (!daily) {
            list.appendChild(tip(el('div', 'awa-w__empty', t('noData')), t('tipNoData')));
        } else {
            if (daily.tos !== null && daily.tosMax !== null) {
                const hecho = daily.tos >= daily.tosMax;
                pinta('tos', t('tos'), cuenta(daily.tos, daily.tosMax, hecho),
                    t('tipTos'), hecho ? 'done' : 'todo');
            }

            if (daily.twitch !== null) {
                // `twitchDone` puede venir marcado con la cifra por debajo del
                // tope, así que el número que se enseña es el que hay, y la marca
                // la pone el estado: inventarle un 15 sería mentir sobre el ARP.
                const hecho = daily.twitchDone || daily.twitch >= TWITCH_CAP;
                enlazar(pinta('twitch', t('twitch'), cuenta(daily.twitch, TWITCH_CAP, hecho),
                    tipMas(t('tipTwitch'), aCC && 'goCC'), hecho ? 'done' : 'todo'), aCC);
                // El cero no demuestra que el widget esté apagado —también vale
                // cero si aún no has visto nada hoy—, así que es recordatorio y
                // no diagnóstico.
                if (!hecho && daily.twitch === 0) {
                    list.appendChild(tip(el('div', 'awa-w__note', t('tipTwitchZero')), t('tipTwitch')));
                }
            }

            if (discord) {
                const hecho = discord.discord >= DISCORD_CAP;
                // El total se estira si lo cobrado lo pasa: enseñar «8/5» sería
                // afirmar un tope que el sitio no publica (ver DISCORD_CAP).
                const tope = Math.max(DISCORD_CAP, discord.discord);
                // Sábado y domingo no hay encuesta (ver finDeSemana). Sin esto la
                // línea se quedaba en amarillo TODO el fin de semana, y como el
                // aviso de fin de día se alimenta de lo amarillo, avisaba de algo
                // que no se podía hacer y no había forma de callarlo.
                //
                // La condición pide ADEMÁS que no se haya cobrado nada: si algún
                // sábado llegara a pagar, esto no lo esconde. El código no afirma
                // que sea imposible, solo deja de pedirlo.
                const cerrado = finDeSemana(Date.now()) && !discord.discord;
                // El único destino FUERA del sitio, así que va en pestaña nueva:
                // el panel no se lleva por delante la página en la que estabas
                // para mandarte a otro dominio.
                // La cifra se enseña SIEMPRE, también el fin de semana: el «de
                // lunes a viernes» vive en el tooltip y no en la columna del
                // valor. Lo que sí cambia el fin de semana es el tono —gris en
                // vez de amarillo—, y con él que la línea NO entre en la lista de
                // pendientes que alimenta el aviso de fin de día.
                enlazar(pinta('discord', t('discord'),
                    cuenta(discord.discord, tope, hecho),
                    tipMas(t('tipDiscord'), 'goDiscord'),
                    cerrado ? 'off' : (hecho ? 'done' : 'todo')),
                    irFuera(DISCORD_URL));
            }

            // Las quests se cuentan HECHAS de TOTAL, no «faltan N»: es el mismo
            // dato, pero dice además cuántas había, que es lo que hace falta para
            // saber si vale la pena entrar.
            if (daily.dailyPending !== null && daily.dailyTotal) {
                const hecho = daily.dailyPending === 0;
                enlazar(pinta('qDaily', t('qDaily'),
                    cuenta(daily.dailyTotal - daily.dailyPending, daily.dailyTotal, hecho),
                    tipMas(t('tipDaily'), aCC && 'goCC'), hecho ? 'done' : 'todo'), aCC);
            }

            if (daily.steamPending !== null && daily.steamTotal) {
                const hecho = daily.steamPending === 0;
                enlazar(pinta('qSteam', t('qSteam'),
                    cuenta(daily.steamTotal - daily.steamPending, daily.steamTotal, hecho),
                    tipMas(t('tipSteam'), aCC && 'goCC'), hecho ? 'done' : 'todo'), aCC);
            }
        }

        // HECHO/TOTAL como todo lo demás. Antes era «por reclamar» / «hecho ✅»,
        // que escondía de cuántos días hablaba la campaña.
        if (cal) {
            const fila = pinta('calendar', t('calendar'), cuenta(cal.hechos, cal.total, !cal.claimable),
                t('tipCalendar'), cal.claimable ? 'todo' : 'done');
            // Es la ÚNICA línea del panel que se cobra en otro sitio: no en la
            // página en la que estés, sino en el icono de la campaña de la barra
            // de arriba. Decir «5/5» sin decir dónde deja al usuario buscando.
            //
            // El icono no se puede nombrar por su dibujo —cambia con cada
            // campaña— así que la línea hace algo mejor que describirlo: lo
            // pulsa. Abrir el calendario no es cobrarlo; cobrar sigue pasando por
            // el captcha del sitio y lo sigue haciendo el usuario.
            const gatillo = document.querySelector(SEL.calTrigger);
            enlazar(fila, gatillo && (() => (gatillo.querySelector('a') || gatillo).click()));
        }

        if (pass) {
            const cerrada = pass.endsAt && pass.endsAt <= Date.now();
            let valor, tono;
            if (!pass.started) { valor = t('passNone'); tono = 'todo'; }
            else if (pass.claimable > 0) { valor = t('passClaim', { n: pass.claimable }); tono = 'todo'; }
            else if (cerrada) { valor = t('passClosed') + OK_MARK; tono = 'done'; }
            // Las fichas del pase van a su propio ritmo —la temporada—, así que
            // aquí la cuenta NO lleva marca aunque esté llena: no es una tarea
            // del día que se pueda dar por cerrada.
            else if (pass.tokens !== null) { valor = cuenta(pass.tokens, pass.tokensMax, false); tono = 'done'; }
            else { valor = t('done') + OK_MARK; tono = 'done'; }
            enlazar(pinta('qPass', t('qPass'), valor,
                tipMas(t('tipPass'), aPase && 'goPass'), tono), aPase);

            // Las fichas caducan con la temporada, así que lo que valen ahora es
            // información con fecha. Se enseña el MEJOR paquete que alcanzan, que
            // es también el de mejor cambio (90→500 sale a 5,6 ARP por ficha;
            // 25→100, a 4).
            //
            // El tono NUNCA es 'todo', y no es un descuido: lo amarillo alimenta
            // el aviso de fin de día, y esto no vence hoy sino al cerrar la
            // temporada. Ponerlo en amarillo sería avisar cada noche durante
            // semanas de algo que no corre prisa.
            if (pass.tokens !== null) {
                const paquete = STORE_PACKS.find((q) => pass.tokens >= q.fichas) || null;
                const falta = STORE_PACKS[STORE_PACKS.length - 1].fichas - pass.tokens;
                enlazar(pinta('store', t('store'),
                    paquete ? t('storePack', { a: nf.format(paquete.arp), f: nf.format(paquete.fichas) })
                        : t('storeShort', { n: nf.format(falta) }),
                    tipMas(t('tipStore'), irA(STORE_URL) && 'goStore'),
                    paquete ? 'done' : 'off'), irA(STORE_URL));
            }
        }

        // Los dos relojes, separados: no caduca lo mismo a la misma hora.
        const now = new Date();
        relojes.appendChild(tip(el('div', 'awa-w__clock', t('dailyReset', { v: fmtCountdown(msToDailyReset(now)) })), t('tipReset')));
        if (daily && daily.steamPending !== null) {
            relojes.appendChild(tip(el('div', 'awa-w__clock awa-w__clock--week',
                t('weekReset', { v: fmtCountdown(msToWeekReset(now)) })), t('tipSteam')));
        }
        // La edad del dato, que es lo único que distingue una caché de una
        // lectura fresca cuando no hay consola —la lección de bing-rewards—. Sin
        // esto, el botón de actualizar no se puede comprobar: repinta lo mismo y
        // no hay forma de saber si releyó. Vive en el botón, que no se rehace en
        // cada pintada y así conserva su listener.
        pintarEdad();

        return pendientes;
    }

    // Lo justo para notar que el calendario ha cambiado sin repintar por si acaso.
    function firmaCal(cal) {
        return cal ? cal.hechos + '/' + cal.total + (cal.claimable ? '!' : '') : '';
    }

    function refreshClocks(relojes) {
        const now = new Date();
        const nodes = relojes.querySelectorAll('.awa-w__clock');
        if (nodes[0]) nodes[0].textContent = t('dailyReset', { v: fmtCountdown(msToDailyReset(now)) });
        if (nodes[1]) nodes[1].textContent = t('weekReset', { v: fmtCountdown(msToWeekReset(now)) });
        pintarEdad();
    }

    // ------------------------------------------------------------------
    // Ficha de sorteo
    // ------------------------------------------------------------------
    // El inventario real está en la global countryKeys, un mapa de país a
    // {nivel: claves}. El DOM no sirve: .key-count llega vacío del servidor y lo
    // rellena el JS del sitio después.
    function paintGiveaway(acc) {
        const keys = pageWindow().countryKeys;
        if (!keys || typeof keys !== 'object') return;
        const host = document.querySelector(SEL.giveawayActions);
        if (!host || document.querySelector('.awa-keys')) return;

        const mine = acc.country && Object.prototype.hasOwnProperty.call(keys, acc.country) ? keys[acc.country] : null;
        const tiers = mine && typeof mine === 'object' ? Object.keys(mine).map(Number).sort((a, b) => a - b) : [];
        const conClaves = tiers.filter((tier) => mine[tier] > 0);

        const box = noTraducir(el('div', 'awa-keys'));
        if (!conClaves.length) {
            box.classList.add('awa-keys--none');
            box.textContent = t('keysNone', { c: acc.country || '—' });
        } else {
            const alcanzables = conClaves.filter((tier) => acc.tier !== null && acc.tier >= tier);
            if (!alcanzables.length) {
                box.classList.add('awa-keys--tier');
                box.textContent = t('keysTier', { t: conClaves[0], u: acc.tier === null ? '—' : acc.tier });
            } else {
                const mejor = Math.max.apply(null, alcanzables.map((tier) => mine[tier]));
                box.classList.add('awa-keys--ok');
                box.textContent = t('keysFor', { n: nf.format(mejor), t: alcanzables[0] });
            }
        }
        tip(box, t('tipKeys'));
        host.insertBefore(box, host.firstChild);
    }

    // ------------------------------------------------------------------
    // Marketplace y Bóveda
    // ------------------------------------------------------------------
    // Los dos traen precio, stock y nivel en atributos, así que el cruce con el
    // saldo es directo y no hace falta leer un solo texto.
    function tagCard(card, price, tier, inStock, acc) {
        if (card.querySelector('.awa-tag')) return;
        const tag = noTraducir(el('div', 'awa-tag'));
        if (inStock === false) {
            tag.classList.add('awa-tag--out');
            tag.textContent = t('soldOut');
        } else if (tier !== null && acc.tier !== null && acc.tier < tier) {
            tag.classList.add('awa-tag--tier');
            tag.textContent = t('tierShort', { t: tier });
        } else if (price !== null && acc.balance !== null) {
            if (acc.balance >= price) {
                tag.classList.add('awa-tag--ok');
                tag.textContent = t('afford');
            } else {
                tag.classList.add('awa-tag--short');
                tag.textContent = t('short', { v: nf.format(price - acc.balance) });
            }
        } else return;
        tip(tag, price !== null && acc.balance !== null
            ? t('tipTag', { p: nf.format(price), b: nf.format(acc.balance) })
            : t('tipKeys'));
        card.appendChild(tag);
    }

    function paintMarketplace(acc) {
        document.querySelectorAll(SEL.marketCard).forEach((card) => {
            const stock = card.getAttribute('data-product-in-stock');
            tagCard(card, num(card.getAttribute('data-product-price')), null,
                stock === null ? null : stock === 'true', acc);
        });
    }

    // Una subasta a ciegas no se compra, se puja, así que los dos datos con los
    // que `tagCard` decide MIENTEN en esa tarjeta y hay que sacarla de ahí:
    //
    //   - `data-product-in-stock` vale `false` también con la subasta abierta,
    //     así que la etiqueta salía «AGOTADO» sobre algo a lo que sí puedes pujar.
    //   - `data-product-price` no es lo que pagas. En la de Dinoblade valía 2400
    //     con la entrada en 100 (`data-min-bid-amount`) y las diez ganadoras
    //     entre 7.000 y 8.500, o sea que un «te faltan N ARP» contra 2400 no
    //     significaba nada.
    //
    // Se reconoce por `data-is-blind-auction`, y el estado por `data-auction-active`,
    // que son suyos y no se solapan con los de una tarjeta normal.
    function tagAuction(card) {
        if (card.querySelector('.awa-tag')) return;
        const activa = card.getAttribute('data-auction-active') === 'true';
        const minimo = num(card.getAttribute('data-min-bid-amount'));
        const tag = noTraducir(el('div', 'awa-tag'));
        if (activa && minimo !== null) {
            tag.classList.add('awa-tag--bid');
            tag.textContent = t('bidFrom', { v: nf.format(minimo) });
        } else if (activa) {
            tag.classList.add('awa-tag--bid');
            tag.textContent = t('bidOpen');
        } else {
            tag.classList.add('awa-tag--out');
            tag.textContent = t('bidOver');
        }
        tip(tag, t('tipAuction'));
        card.appendChild(tag);
    }

    function paintVault(acc) {
        document.querySelectorAll(SEL.vaultCard).forEach((card) => {
            if (card.getAttribute('data-is-blind-auction') === 'true') { tagAuction(card); return; }
            const stock = card.getAttribute('data-product-in-stock');
            tagCard(card, num(card.getAttribute('data-product-price')),
                num(card.getAttribute('data-arp-tier')),
                stock === null ? null : stock === 'true', acc);
        });
    }

    // ------------------------------------------------------------------
    // Estilos
    // ------------------------------------------------------------------
    function injectCss() {
        if (document.getElementById('awa-arp-css')) return;
        const css = el('style');
        css.id = 'awa-arp-css';
        const W = '#' + WIDGET_ID;
        css.textContent = [
            W + '{position:fixed;z-index:99999;width:246px;',
            'font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6e9ee;',
            'background:rgba(17,22,29,.96);border:1px solid #2b3644;border-radius:10px;',
            'box-shadow:0 6px 20px rgba(0,0,0,.45);overflow:hidden;}',
            // Arriba a la derecha por defecto: abajo a la derecha está el selector
            // de idioma de AWA y abajo a la izquierda su botón de cookies.
            W + '.awa-w--tr{top:92px;right:14px;}',
            W + '.awa-w--br{bottom:76px;right:14px;}',
            W + '.awa-w--bl{bottom:76px;left:14px;}',
            W + '.awa-w--tl{top:92px;left:14px;}',
            W + ' .awa-w__head{display:flex;align-items:center;justify-content:space-between;',
            'padding:8px 10px;background:#1b2230;border-bottom:1px solid #2b3644;}',
            W + ' .awa-w__title{font-size:12px;letter-spacing:.03em;text-transform:uppercase;}',
            W + ' .awa-w__tools{display:flex;gap:5px;}',
            W + ' .awa-w__btn{font:inherit;line-height:1.2;cursor:pointer;background:transparent;',
            'border:1px solid #3a465a;border-radius:4px;color:#9aa4b2;padding:3px 8px;min-width:26px;}',
            W + ' .awa-w__btn:hover{color:#fff;border-color:#7d8899;}',
            W + '.awa-w--folded .awa-w__body{display:none;}',
            W + ' .awa-w__body{padding:9px 10px 10px;}',
            W + ' .awa-w__acct{margin-bottom:8px;}',
            W + ' .awa-w__arp{display:block;font-size:17px;font-weight:600;color:#01f5ff;}',
            W + ' .awa-w__sub{display:block;color:#9aa4b2;font-size:11px;}',
            W + ' .awa-w__line{display:flex;justify-content:space-between;gap:8px;padding:3px 0;outline:none;}',
            W + ' .awa-w__line:focus-visible{outline:1px solid #4b72d4;outline-offset:2px;}',
            W + ' .awa-w__k{color:#b8c1cd;}',
            W + ' .awa-w__v{font-weight:600;white-space:nowrap;}',
            W + ' .awa-w__line--done .awa-w__v{color:#67d98b;}',
            W + ' .awa-w__line--todo .awa-w__v{color:#ffcf66;}',
            // Tercer tono: ni hecho ni pendiente. Hoy solo lo usa Discord el fin de
            // semana, y por eso es gris y no verde: verde diria «ya esta», y no lo esta.
            W + ' .awa-w__line--off .awa-w__v{color:#8b95a3;}',
            // La línea que además LLEVA a algún sitio. La flecha va con la
            // etiqueta y no con la cifra: pertenece a lo que se abre, no al dato.
            W + ' .awa-w__line--go{cursor:pointer;border-radius:4px;margin:0 -4px;padding:3px 4px;}',
            W + ' .awa-w__line--go:hover{background:rgba(1,245,255,.08);}',
            W + ' .awa-w__line--go:hover .awa-w__k{color:#01f5ff;}',
            W + ' .awa-w__go{opacity:.65;}',
            // El único elemento del panel que pide una respuesta, así que es el
            // único que se pinta como algo pulsable de cuerpo entero.
            W + ' .awa-w__alert{display:flex;align-items:flex-start;gap:8px;cursor:pointer;',
            'margin:0 0 8px;padding:6px 8px;border-radius:6px;line-height:1.3;',
            'background:rgba(1,245,255,.10);border:1px solid rgba(1,245,255,.45);color:#01f5ff;}',
            W + ' .awa-w__alert:hover{background:rgba(1,245,255,.18);}',
            W + ' .awa-w__alert:focus-visible{outline:1px solid #4b72d4;outline-offset:2px;}',
            W + ' .awa-w__alert-txt{flex:1 1 auto;font-weight:600;}',
            W + ' .awa-w__alert-x{flex:0 0 auto;opacity:.7;}',
            W + ' .awa-w__note{margin:3px 0 6px;padding:5px 7px;border-radius:5px;',
            'background:rgba(255,207,102,.10);border:1px solid rgba(255,207,102,.35);color:#ffcf66;font-size:11px;}',
            W + ' .awa-w__clocks{margin-top:8px;padding-top:7px;border-top:1px solid #2b3644;}',
            W + ' .awa-w__clock{color:#9aa4b2;padding:1px 0;outline:none;}',
            W + ' .awa-w__clock--week{color:#7f8998;}',
            // Fila entera y no un icono: es el control que más se pulsa y era el
            // que peor se acertaba de los cuatro que había en la cabecera.
            W + ' .awa-w__refresh{display:flex;align-items:center;gap:6px;width:100%;',
            'margin-top:6px;padding:5px 7px;font:inherit;text-align:left;cursor:pointer;',
            'color:#8d97a5;background:transparent;border:1px solid transparent;border-radius:5px;}',
            W + ' .awa-w__refresh:hover{color:#01f5ff;border-color:#3a465a;background:rgba(1,245,255,.06);}',
            W + ' .awa-w__refresh:focus-visible{outline:1px solid #4b72d4;outline-offset:2px;}',
            W + ' .awa-w__age{font-size:11px;}',
            // Mientras relee, el icono gira: sin esto un clic sobre datos que no
            // cambian no se distingue de un botón que no hace nada. Gira solo el
            // icono; si girase el botón entero el texto quedaría ilegible.
            W + ' .awa-w__spin{display:inline-block;line-height:1;}',
            W + ' .awa-w__refresh--busy{color:#01f5ff;}',
            W + ' .awa-w__refresh--busy .awa-w__spin{animation:awa-spin 900ms linear infinite;}',
            '@keyframes awa-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
            W + ' .awa-w__empty{color:#9aa4b2;font-style:italic;}',
            W + ' .awa-w__foot{margin-top:9px;padding-top:8px;border-top:1px solid #2b3644;}',
            W + ' .awa-w__check{display:flex;align-items:center;gap:7px;color:#b8c1cd;cursor:pointer;',
            'user-select:none;line-height:1.25;}',
            W + ' .awa-w__check input{flex:0 0 auto;width:13px;height:13px;margin:0;cursor:pointer;accent-color:#4b72d4;}',
            W + ' .awa-w__lang-row{display:flex;align-items:center;justify-content:space-between;',
            'gap:6px;margin-top:8px;color:#7f8998;font-size:11px;}',
            W + ' .awa-w__lang{font:inherit;padding:1px 3px;border-radius:3px;max-width:120px;',
            'border:1px solid #3a465a;background:#1f2733;color:#e6e9ee;}',
            W + ' .awa-w__btn--info{border-color:#3a465a;padding:1px 4px;}',
            // Tooltip propio: cuelga del body para que no lo recorte el panel, y no
            // recibe puntero para no robarle el hover ni el clic al control.
            '#' + TIP_ID + '{position:fixed;left:0;top:0;z-index:999999;max-width:300px;',
            'padding:8px 10px;border-radius:6px;white-space:normal;',
            'font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6e9ee;',
            'background:#141a22;border:1px solid #01f5ff;box-shadow:0 4px 16px rgba(0,0,0,.55);',
            'opacity:0;pointer-events:none;transition:opacity 120ms ease;}',
            '#' + TIP_ID + '.awa-tip--on{opacity:1;}',
            '#' + WIDGET_ID + ' [title],#' + WIDGET_ID + ' [' + TIP_STASH + ']{cursor:help;}',
            '#' + WIDGET_ID + ' button[title],#' + WIDGET_ID + ' select[title]{cursor:pointer;}',
            // Ficha del script, con la misma forma que en los demás scripts: overlay
            // con padding (el margen lo reserva él, no una altura fija que en un
            // idioma sobra y en otro falta), caja que aparece con un desplazamiento
            // corto, y solo el cuerpo scrollea.
            '.awa-modal{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;',
            'justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.6);',
            'opacity:0;transition:opacity 180ms ease;}',
            '.awa-modal.awa-modal--on{opacity:1;}',
            '.awa-modal__box{display:flex;flex-direction:column;min-width:min(340px,100%);',
            'max-width:560px;max-height:100%;overflow:hidden;box-sizing:border-box;',
            'padding:26px 30px;border-radius:14px;background:#141a22;color:#e6e9ee;',
            'border:1px solid #01f5ff;box-shadow:0 8px 32px rgba(0,0,0,.5);',
            'font:13px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
            'transform:translateY(8px) scale(.98);opacity:0;',
            'transition:transform 180ms ease,opacity 180ms ease;}',
            '.awa-modal--on .awa-modal__box{transform:none;opacity:1;}',
            '.awa-modal__head{flex-shrink:0;}',
            '.awa-modal__title{font-weight:700;font-size:17px;margin-bottom:12px;color:#01f5ff;}',
            // Rejilla en dos columnas: con «etiqueta en negrita + valor» en la misma
            // línea, el ancho de la etiqueta empujaba al valor y los cinco salían
            // escalonados.
            '.awa-modal__meta{display:grid;grid-template-columns:auto minmax(0,1fr);',
            'column-gap:10px;row-gap:5px;font-size:13px;}',
            '.awa-modal__k{font-weight:600;color:#9aa4b2;white-space:nowrap;}',
            // Sin esto la URL no parte y estira la caja más allá de su max-width.
            '.awa-modal__v{min-width:0;overflow-wrap:anywhere;}',
            '.awa-modal__v a{color:#01f5ff;text-decoration:underline;}',
            '.awa-modal__hr{flex-shrink:0;height:1px;margin:14px 0;background:#2b3644;}',
            '.awa-modal__body{overflow-y:auto;min-height:0;padding-right:4px;}',
            '.awa-modal__h{font-weight:700;color:#01f5ff;margin-bottom:6px;}',
            '.awa-modal__h--sep{margin-top:16px;}',
            '.awa-modal__body p{margin:0 0 8px;}',
            '.awa-modal__foot{flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:10px;}',
            '.awa-modal__btn{font:inherit;cursor:pointer;padding:5px 18px;border-radius:6px;',
            'border:1px solid #01f5ff;background:rgba(1,245,255,.12);color:#01f5ff;}',
            '.awa-modal__btn:hover{background:rgba(1,245,255,.22);}',
            '.awa-keys{margin:0 auto 10px;padding:7px 12px;border-radius:8px;text-align:center;',
            'font:600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;}',
            '.awa-keys--ok{background:rgba(103,217,139,.12);border:1px solid rgba(103,217,139,.5);color:#67d98b;}',
            '.awa-keys--none{background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.5);color:#ff8f8f;}',
            '.awa-keys--tier{background:rgba(255,207,102,.12);border:1px solid rgba(255,207,102,.5);color:#ffcf66;}',
            '.awa-tag{margin-top:6px;padding:2px 6px;border-radius:4px;text-align:center;',
            'font:600 11px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}',
            '.awa-tag--ok{background:rgba(103,217,139,.14);color:#67d98b;}',
            '.awa-tag--short{background:rgba(154,164,178,.14);color:#9aa4b2;}',
            '.awa-tag--tier{background:rgba(255,207,102,.14);color:#ffcf66;}',
            '.awa-tag--out{background:rgba(255,107,107,.14);color:#ff8f8f;}',
            // Azul y no verde: «puedes pujar» no es «te alcanza». Lo que cuesta de
            // verdad una subasta no se sabe hasta que cierra (ver tagAuction).
            '.awa-tag--bid{background:rgba(102,181,255,.14);color:#66b5ff;}',
        ].join('');
        document.head.appendChild(css);
    }

    // ------------------------------------------------------------------
    // Arranque
    // ------------------------------------------------------------------
    function boot() {
        const acc = readAccount();
        if (!acc.logged) return;          // sin sesión no hay nada que contar

        injectCss();

        const path = location.pathname;
        // La rama de `/community-giveaways/` entra y hoy no pinta nada: esos
        // sorteos NO llevan `countryKeys` —comprobado en los dos volcados de la
        // comunidad—, así que `paintGiveaway` se encuentra sin inventario y se
        // va. Se deja a propósito y no se borra: no está mal, está inerte, y si
        // AWA les diera inventario algún día el aviso aparecería solo. Borrarla
        // sería cambiar «no hay nada que decir» por «no lo miramos».
        if (/\/Giveaway\//.test(path) || /\/community-giveaways\//.test(path)) paintGiveaway(acc);
        if (/^\/marketplace\/game-vault/.test(path)) paintVault(acc);
        else if (/^\/marketplace/.test(path)) paintMarketplace(acc);

        let { box, list, relojes, refrescar } = buildWidget(acc, alCambiarAlerta);
        document.body.appendChild(box);

        let leyendo = false;
        // Lo último que se leyó BIEN de cada cosa. Una relectura fallida no puede
        // borrar el panel: dejarlo en blanco por un fetch caído se lee como «no
        // queda nada» —y además apagaría el aviso, que necesita `daily` para
        // decidir—. Es mejor un dato de hace un rato, con su edad a la vista.
        const ultimo = { daily: null, pass: null, discord: null };

        // Lo último que se pintó en amarillo. Lo guarda quien pinta y lo usa quien
        // avisa, y por eso el aviso puede evaluarse en cada tic SIN volver a pedir
        // nada: los de amanecer y de semana de Steam dependen del reloj, no de que
        // acabe de llegar un dato.
        let pendientes = [];

        // Declarada (y no `const`) para que se pueda pasar a buildWidget arriba:
        // las declaraciones se izan, las asignaciones no.
        function alCambiarAlerta() { repinta(); }

        // El estado del calendario la última vez que se pintó. Lo usa el reloj
        // para notar que has cobrado un día sin tener que releer el sitio.
        let calFirma = '';

        function repinta() {
            // Una sola lectura para las tres: ahora cruza los dos ejemplares del
            // calendario y escribe en localStorage, así que llamarla tres veces
            // por repintado ya no es gratis.
            const cal = readCalendar(document);
            calFirma = firmaCal(cal);
            pendientes = renderDaily(list, relojes, ultimo.daily, cal,
                ultimo.pass, ultimo.discord, acc) || [];
            // El aviso se decide DESPUÉS de pintar, porque necesita saber qué salió
            // en amarillo. Si suena, hay que volver a pintar: su banda no existía
            // cuando se dibujó el panel. La segunda pasada no puede disparar nada
            // —las marcas de «ya sonó» ya están puestas—, así que no hay bucle.
            if (evaluarAvisos(ultimo.daily, cal, ultimo.pass, ultimo.discord, pendientes)) {
                pendientes = renderDaily(list, relojes, ultimo.daily, cal,
                    ultimo.pass, ultimo.discord, acc) || [];
            }
        }

        // Tres modos, y la diferencia entre ellos es cuánto se pide a la red:
        //
        //   'inicial' — lo que haya en la página, y si no, la caché; solo pide lo
        //               que falte. Es lo que se hace al cargar.
        //   'auto'    — el reloj. Fuerza SOLO lo volátil: el día y Discord. El
        //               pase cambia una vez al día, y forzarlo cada cuarto de hora
        //               era una petición tirada a la basura por ciclo.
        //   'manual'  — el botón. Fuerza las tres, que para eso lo pulsas.
        function pintar(modo) {
            if (leyendo) return Promise.resolve();
            leyendo = true;
            _intentoEn = Date.now();
            store(REFRESH_KEY, String(_intentoEn));
            if (modo === 'manual') refrescar.classList.add('awa-w__refresh--busy');
            const dia = modo === 'auto' || modo === 'manual';
            return Promise.all([getDaily(dia), getPass(modo === 'manual'), getDiscord(dia)])
                .then(([daily, pass, discord]) => {
                    ultimo.daily = fusionar(ultimo.daily, daily);
                    ultimo.pass = fusionar(ultimo.pass, pass);
                    ultimo.discord = fusionar(ultimo.discord, discord);
                    // La edad solo avanza si de verdad se leyó algo nuevo: si no,
                    // el «↻ hace un momento» estaría mintiendo sobre un dato viejo.
                    if (daily) _leidoEn = Date.now();
                    repinta();
                })
                .catch(() => { /* sin red: se queda lo que hubiera */ })
                .then(() => {
                    leyendo = false;
                    refrescar.classList.remove('awa-w__refresh--busy');
                });
        }

        // Lo que trajo OTRA pestaña, sin pedir nada. Es la mitad barata de la
        // coordinación: una pide y las demás se enteran por localStorage.
        function pintarDeAlmacen() {
            const d = leerAlmacen(CACHE_KEY);
            const pa = leerAlmacen(PASS_KEY);
            const lo = leerAlmacen(LOG_KEY);
            if (!d && !pa && !lo) return false;
            ultimo.daily = fusionar(ultimo.daily, d);
            ultimo.pass = fusionar(ultimo.pass, pa);
            ultimo.discord = fusionar(ultimo.discord, lo);
            if (d && d.at > _leidoEn) _leidoEn = d.at;
            repinta();
            return true;
        }

        pintar('inicial');

        function alPulsarRefresco() { hideTip(); pintar('manual'); }
        refrescar.addEventListener('click', alPulsarRefresco);

        // Rehacer el panel entero es la forma barata de cambiar de idioma: las
        // cadenas están repartidas por cada nodo y su `title`, así que traducir
        // en sitio sería recorrerlo todo. La posición, el plegado y la casilla
        // viven en localStorage, así que el panel vuelve como estaba.
        function rehacer() {
            hideTip();
            box.remove();
            const nuevo = buildWidget(acc, alCambiarAlerta);
            box = nuevo.box; list = nuevo.list; relojes = nuevo.relojes; refrescar = nuevo.refrescar;
            document.body.appendChild(box);
            refrescar.addEventListener('click', alPulsarRefresco);
            renderDaily(list, relojes, ultimo.daily, readCalendar(document),
                ultimo.pass, ultimo.discord, acc);
        }

        // Weglot llega tarde: cuando arranca el script su selector no existe y su
        // API tampoco, así que el primer idioma puede salir mal (ver siteLang).
        // Se revisa medio minuto al arrancar, y luego con el reloj —que además
        // recoge el caso de que el usuario cambie de idioma sin recargar—.
        function vigilarIdioma() {
            const nuevo = idiomaVigente();
            if (nuevo === LANG) return false;
            aplicarIdioma(nuevo);
            rehacer();
            return true;
        }
        let weglotEnganchado = false;
        function engancharWeglot() {
            if (weglotEnganchado) return true;
            try {
                const wg = pageWindow().Weglot;
                if (!wg || typeof wg.on !== 'function') return false;
                wg.on('languageChanged', () => vigilarIdioma());
                weglotEnganchado = true;
                return true;
            } catch (e) { return false; }
        }
        engancharWeglot();

        let intentosIdioma = 0;
        const relojIdioma = setInterval(() => {
            // El enganche va DENTRO de este sondeo y no en un intervalo propio:
            // el panel ya tiene dos relojes vivos y una prueba que los cuenta,
            // porque un temporizador que nadie apaga es una fuga silenciosa.
            engancharWeglot();
            if (vigilarIdioma() || ++intentosIdioma > 60) clearInterval(relojIdioma);
        }, 500);

        // Y DESPUÉS de esos treinta segundos, el sondeo se acaba: a partir de ahí
        // solo quedaba el reloj de 30 s, así que cambiar de idioma en el selector
        // de AWA tardaba hasta medio minuto en llegar al panel. Se ve como «a
        // veces no lo hace», que es lo que reportó el usuario, porque medio minuto
        // es más de lo que nadie espera mirando.
        //
        // Dos avisos inmediatos, y los dos son del propio sitio:
        //
        //   1. El evento de Weglot. Es la fuente que manda —`getCurrentLang()` ya
        //      es la primera opción de `siteLang()`—, así que escuchar su cambio
        //      es enterarse en el mismo instante. Su API no está al arrancar, por
        //      eso se engancha aquí y también desde el sondeo de arriba.
        //   2. El `lang` del <html>. Weglot lo reescribe al cambiar de idioma, y
        //      un observer de ESE ATRIBUTO Y NADA MÁS no se ve a sí mismo: rehacer
        //      el panel no toca el <html>, así que no hay bucle. (La lección de
        //      «un observer que se ve a sí mismo» costó un repintado cada 200 ms
        //      en otro script; aquí el alcance es un atributo de un solo nodo.)
        //
        // El reloj de 30 s se queda como última red: si el sitio cambiara de
        // mecanismo, el panel seguiría acabando en el idioma correcto.
        // El segundo aviso inmediato, para cuando la API de Weglot no esté: se
        // vigila lo que el sitio CAMBIA al traducir. Y no es el `lang` del <html>
        // —o no solo—: en el volcado del Centro de control el idioma vigente lo
        // marca la clase `wgcurrent` moviéndose entre los <div> del selector, que
        // es justo lo que `siteLang()` lee en segundo lugar. Vigilar solo el
        // <html> habría parecido que funcionaba y no habría reaccionado.
        //
        // El observer no se ve a sí mismo: mira `class` dentro del selector de
        // Weglot y `lang` en el <html>, y `rehacer()` no toca ninguno de los dos.
        try {
            const alCambiar = new MutationObserver(() => vigilarIdioma());
            alCambiar.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
            const conmutador = document.querySelector('#weglot-switcher-1, .weglot_switcher');
            if (conmutador) {
                alCambiar.observe(conmutador, { attributes: true, attributeFilter: ['class'], subtree: true });
            }
        } catch (e) { /* sin MutationObserver */ }

        // Volver a la pestaña ya NO borra la marca 👽: eso la convertía en un aviso
        // que se cancelaba solo por mirar de refilón, aunque no hubieras hecho
        // nada. Ahora se apaga marcando el aviso como visto en el panel, que es
        // un acto y no un accidente. Lo que sí se hace al volver es mirar si el
        // dato quedó viejo mientras no mirabas.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            soltarDialogoPendiente();
            revisarRefresco();
        });
        // Y si la página se cargó con un aviso sin ver, la marca vuelve al título.
        if (leerAviso()) marcarTitulo();

        // El sitio avisa por su cuenta de que ha cobrado un día del calendario
        // —`$('body').trigger('pac.claim.success')`—, y ese es el ÚNICO instante en
        // que la copia del overlay dice la verdad: al cerrarla se vacía. Es un
        // evento de jQuery, y los eventos propios de jQuery no llegan a
        // `addEventListener`, así que hay que pedírselo a la jQuery de la página.
        // Si no está, lo recoge el reloj de abajo unos segundos después.
        try {
            const jq = pageWindow().jQuery;
            if (jq) jq('body').on('pac.claim.success', () => repinta());
        } catch (e) { /* sin jQuery en la página */ }

        // Los relojes se repintan solos: calcularlos una vez al cargar es el
        // fallo que ya se pagó en el panel de Bing Rewards.
        //
        // Y el AVISO tiene el mismo problema, que es peor porque no se ve: si
        // solo se decide al pintar, una pestaña abierta desde antes del último
        // tramo del día nunca llega a evaluarlo. O sea que el sonido no sonaba
        // «cuando llega la hora», sonaba solo si recargabas una página dentro de
        // la media hora justa —que es casi nunca, y precisamente el rato en el
        // que se supone que sirve—. Así que la ventana se vigila con el reloj.
        // Cuándo toca volver a pedir, y sobre todo cuándo NO.
        //
        // Los términos del sitio prohíben usar «any robot… or other manual or
        // automatic device or process to retrieve… its contents», así que un
        // panel que pide en bucle no es gratis por muy tuyas que sean las páginas.
        // Tres frenos, y ninguno le quita nada al panel que estás mirando:
        //
        //   - **Pestaña oculta, nada.** Una pestaña de fondo pidiendo ocho horas
        //     es el peor patrón y el menos útil: se relee al volver a ella.
        //   - **Una pestaña pide, todas se enteran.** La hora del último refresco
        //     se comparte por localStorage; la que llega tarde repinta de la caché
        //     en vez de pedir lo mismo otra vez.
        //   - **El automático no fuerza el pase** (ver `pintar`).
        //
        // La ÚNICA excepción a lo de la pestaña oculta es la ventana del aviso: si
        // no se relee ahí, no se puede decidir si avisar —y es justo cuando no
        // estás mirando cuando el aviso sirve—. Son 6 ciclos al día como mucho.
        function revisarRefresco() {
            const ahora = Date.now();
            const enVentana = alertsOn()
                && recall(VISTO_DIA_KEY) !== utcStamp(ahora)
                && msToDailyReset(new Date()) <= ALERT_MINUTES * 60 * 1000;
            if (document.hidden && !enVentana) return false;
            const cada = enVentana ? ALERT_REFRESH_MS : REFRESH_MS;
            // Dentro de la ventana se relee más seguido, porque ahí decidir con un
            // dato viejo significa avisar en falso o no avisar; y mirar una sola
            // vez daría por pendiente algo que se acaba de hacer.
            if (ahora - _intentoEn < cada) return false;
            const ajeno = Number(recall(REFRESH_KEY)) || 0;
            if (ahora - ajeno < cada) return pintarDeAlmacen();
            pintar('auto');
            return true;
        }

        setInterval(() => {
            if (vigilarIdioma()) return;      // rehacer ya repinta todo
            refreshClocks(relojes);
            vigilarTitulo();

            // Cobrar un día del calendario no cambia ningún dato que se pida por
            // red: pasa entero en el DOM, y en un overlay que el sitio vacía al
            // cerrarlo. Sin vigilarlo aquí, la línea seguiría en amarillo hasta la
            // siguiente relectura, hasta un cuarto de hora después.
            if (firmaCal(readCalendar(document)) !== calFirma) { repinta(); return; }

            // Empieza un día nuevo. Dos cosas, y ninguna puede esperar al ciclo
            // normal de 15 minutos:
            //
            //   - **Lo de ayer se tira.** Los contadores del sitio se ponen a cero
            //     a las 00:00 UTC, pero `ultimo` sigue guardando los de ayer, y
            //     `fusionar` los conserva —que es lo correcto DENTRO de un día y
            //     lo peor posible al cruzarlo—. Sin esto el panel enseñaría «5/5 ✅»
            //     un cuarto de hora largo con el día entero por hacer.
            //   - **Se relee ya**, aunque los avisos estén apagados y aunque la
            //     pestaña esté oculta: es una vez al día, y es la lectura que hace
            //     que el panel signifique algo al empezar.
            //
            // El pase NO se tira: su reloj es la temporada, no el día.
            if (amaneció()) {
                ultimo.daily = null;
                ultimo.discord = null;
                pintar('auto');
                return;
            }
            // El aviso se evalúa en CADA tic y no solo al repintar: dos de los
            // tres dependen del reloj —el amanecer y la semana de Steam— y
            // esperar a que llegue un dato nuevo es cómo el aviso de la noche se
            // pasaba de largo antes (§14.2).
            //
            // Pero primero se mira si toca releer, y si va a haber repintado NO se
            // evalúa aquí: `repinta` lo hará con el dato nuevo. Si no, la media
            // hora final decidiría con datos de hasta un cuarto de hora antes y
            // podría avisar de algo que ya hiciste.
            if (!revisarRefresco()) {
                if (evaluarAvisos(ultimo.daily, readCalendar(document), ultimo.pass,
                    ultimo.discord, pendientes)) repinta();
            }
        }, 30000);
        bindTips();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
