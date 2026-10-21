// -----------------------------------------------------------------------------
// Texts sent from the container (connection status, action answers, errors),
// in the four languages of the Gladys interface. Entries are strings or
// functions of one parameter object. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Connection status of the Configuration screen, by NetAlertXError kind.
export const STATUS = {
  notConfigured: {
    en: 'Enter the address of the NetAlertX API and its API token.',
    fr: "Saisissez l'adresse de l'API NetAlertX et son jeton d'API.",
    de: 'Gib die Adresse der NetAlertX-API und ihr API-Token ein.',
    es: 'Introduzca la dirección de la API de NetAlertX y su token de API.',
  },
  auth: {
    en: 'NetAlertX refused the API token: copy it again from Settings → General (API token).',
    fr: "NetAlertX refuse le jeton d'API : recopiez-le depuis Paramètres → General (API token).",
    de: 'NetAlertX lehnt das API-Token ab: Kopiere es erneut aus Einstellungen → General (API token).',
    es: 'NetAlertX rechaza el token de API: cópielo de nuevo desde Ajustes → General (API token).',
  },
  network: {
    en: 'NetAlertX does not answer: check the address and the API port (20212 by default).',
    fr: "NetAlertX ne répond pas : vérifiez l'adresse et le port de l'API (20212 par défaut).",
    de: 'NetAlertX antwortet nicht: Prüfe die Adresse und den API-Port (standardmäßig 20212).',
    es: 'NetAlertX no responde: compruebe la dirección y el puerto de la API (20212 por defecto).',
  },
  http: {
    en: ({ status }) => `NetAlertX answered with an error (HTTP ${status}): see its logs.`,
    fr: ({ status }) => `NetAlertX a répondu par une erreur (HTTP ${status}) : voyez ses logs.`,
    de: ({ status }) =>
      `NetAlertX hat mit einem Fehler geantwortet (HTTP ${status}): Sieh dir seine Protokolle an.`,
    es: ({ status }) =>
      `NetAlertX ha respondido con un error (HTTP ${status}): consulte sus registros.`,
  },
  format: {
    en: 'This address does not answer like the NetAlertX API (port 20212, not the 20211 web interface).',
    fr: "Cette adresse ne répond pas comme l'API NetAlertX (port 20212, pas l'interface web 20211).",
    de: 'Diese Adresse antwortet nicht wie die NetAlertX-API (Port 20212, nicht die Weboberfläche 20211).',
    es: 'Esta dirección no responde como la API de NetAlertX (puerto 20212, no la interfaz web 20211).',
  },
};

export function statusOf(err) {
  if (err?.kind === 'auth') {
    return STATUS.auth;
  }
  if (err?.kind === 'format' || err?.kind === 'notFound') {
    return STATUS.format;
  }
  if (err?.kind === 'http' && err.status) {
    return render(STATUS.http, { status: err.status });
  }
  return STATUS.network;
}

// Errors of the "Mark as known" scene action, widget buttons and configuration actions.
export const ERRORS = {
  mac: {
    en: ({ value }) => `"${value}" is not a MAC address (e.g. 64:e4:d5:b4:12:66).`,
    fr: ({ value }) => `« ${value} » n'est pas une adresse MAC (ex. 64:e4:d5:b4:12:66).`,
    de: ({ value }) => `„${value}“ ist keine MAC-Adresse (z. B. 64:e4:d5:b4:12:66).`,
    es: ({ value }) => `«${value}» no es una dirección MAC (p. ej. 64:e4:d5:b4:12:66).`,
  },
  unknownMac: {
    en: ({ value }) => `NetAlertX does not know the device ${value}.`,
    fr: ({ value }) => `NetAlertX ne connaît pas l'appareil ${value}.`,
    de: ({ value }) => `NetAlertX kennt das Gerät ${value} nicht.`,
    es: ({ value }) => `NetAlertX no conoce el dispositivo ${value}.`,
  },
  unavailable: {
    en: 'NetAlertX cannot be reached right now: try again later.',
    fr: 'NetAlertX est injoignable pour le moment : réessayez plus tard.',
    de: 'NetAlertX ist gerade nicht erreichbar: Versuche es später erneut.',
    es: 'NetAlertX no está accesible en este momento: inténtelo más tarde.',
  },
};

// Answers of the configuration actions.
export const REPORTS = {
  test: {
    en: ({ total, online, fresh }) =>
      `Connected to NetAlertX: ${total} device(s), ${online} online, ${fresh} new.`,
    fr: ({ total, online, fresh }) =>
      `Connecté à NetAlertX : ${total} appareil(s), ${online} en ligne, ${fresh} nouveau(x).`,
    de: ({ total, online, fresh }) =>
      `Mit NetAlertX verbunden: ${total} Gerät(e), ${online} online, ${fresh} neu.`,
    es: ({ total, online, fresh }) =>
      `Conectado a NetAlertX: ${total} dispositivo(s), ${online} en línea, ${fresh} nuevo(s).`,
  },
  markedAll: {
    en: ({ count }) => `${count} device(s) marked as known in NetAlertX.`,
    fr: ({ count }) => `${count} appareil(s) marqué(s) comme connu(s) dans NetAlertX.`,
    de: ({ count }) => `${count} Gerät(e) in NetAlertX als bekannt markiert.`,
    es: ({ count }) => `${count} dispositivo(s) marcado(s) como conocido(s) en NetAlertX.`,
  },
  marked: {
    en: ({ name }) => `${name} marked as known.`,
    fr: ({ name }) => `${name} marqué comme connu.`,
    de: ({ name }) => `${name} als bekannt markiert.`,
    es: ({ name }) => `${name} marcado como conocido.`,
  },
};

/** A multi-language object from an entry of the tables above. */
export function render(entry, params = {}) {
  return Object.fromEntries(
    Object.entries(entry).map(([language, value]) => [
      language,
      typeof value === 'function' ? value(params) : value,
    ]),
  );
}

/** An error whose message is a multi-language object (shown in Gladys). */
export class GladysError extends Error {
  constructor(message, language = 'en') {
    super(message[language] ?? message.en);
    this.messages = message;
  }
}
