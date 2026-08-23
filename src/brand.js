/* ==========================================================================
   NEXO — Fuente única de configuración de marca (white-label)

   Toda la identidad visible del producto se deriva de variables de
   entorno (wrangler.toml [vars] o dashboard). Ningún HTML, title,
   manifest, mensaje de WhatsApp ni JSON-LD debe contener el nombre de
   marca como literal: se inyecta desde aquí.

   NUNCA incluir secretos en este módulo: todo lo que devuelve
   buildBrand() es público por diseño (se sirve en /api/config y se
   inyecta en HTML).
   ========================================================================== */

const DEFAULTS = {
  name: "NEXO",
  tagline: "Conecta con tu próximo lugar.",
  description: "Encuentra casas, apartamentos y terrenos verificados. Publica tu propiedad y contacta directo por WhatsApp.",
  businessName: "",
  legalName: "",
  phone: "",
  whatsapp: "+5358385702",
  email: "",
  address: "",
  websiteUrl: "",
  country: "Cuba",
  countryCode: "CU",
  locale: "es_CU",
  currency: "USD",
  primaryColor: "#c2410c",
  secondaryColor: "#1C1917",
  bgColor: "#faf9f7",
  logo: "/icons/icon-192.png",
  socialInstagram: "",
  socialFacebook: "",
  socialLinkedin: "",
  demoMode: false,
  mapCenterLat: 23.1136,
  mapCenterLng: -82.3666,
  mapZoom: 12
};

export function buildBrand(env = {}) {
  const b = {
    name: env.BRAND_NAME || DEFAULTS.name,
    tagline: env.BRAND_TAGLINE || DEFAULTS.tagline,
    description: env.BRAND_DESCRIPTION || DEFAULTS.description,
    businessName: env.BUSINESS_NAME || env.BRAND_NAME || DEFAULTS.name,
    legalName: env.LEGAL_NAME || env.BUSINESS_NAME || env.BRAND_NAME || DEFAULTS.name,
    phone: env.CONTACT_PHONE || DEFAULTS.phone,
    whatsapp: env.WHATSAPP_PHONE || DEFAULTS.whatsapp,
    email: env.CONTACT_EMAIL || DEFAULTS.email,
    address: env.BUSINESS_ADDRESS || DEFAULTS.address,
    websiteUrl: env.WEBSITE_URL || DEFAULTS.websiteUrl,
    country: env.MARKET_COUNTRY || DEFAULTS.country,
    countryCode: env.MARKET_COUNTRY_CODE || DEFAULTS.countryCode,
    locale: env.MARKET_LOCALE || DEFAULTS.locale,
    currency: env.DEFAULT_CURRENCY || DEFAULTS.currency,
    primaryColor: env.BRAND_PRIMARY_COLOR || env.BRAND_THEME_COLOR || DEFAULTS.primaryColor,
    secondaryColor: env.BRAND_SECONDARY_COLOR || DEFAULTS.secondaryColor,
    bgColor: env.BRAND_BG_COLOR || DEFAULTS.bgColor,
    logo: env.BRAND_LOGO || DEFAULTS.logo,
    socialInstagram: env.SOCIAL_INSTAGRAM || DEFAULTS.socialInstagram,
    socialFacebook: env.SOCIAL_FACEBOOK || DEFAULTS.socialFacebook,
    socialLinkedin: env.SOCIAL_LINKEDIN || DEFAULTS.socialLinkedin,
    demoMode: env.DEMO_MODE === "1",
    mapCenterLat: parseFloat(env.MAP_CENTER_LAT) || DEFAULTS.mapCenterLat,
    mapCenterLng: parseFloat(env.MAP_CENTER_LNG) || DEFAULTS.mapCenterLng,
    mapZoom: parseInt(env.MAP_ZOOM, 10) || DEFAULTS.mapZoom
  };
  return b;
}

export function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* --------------------------------------------------------------------------
   Sustitución de tokens en plantillas HTML públicas.

   Sintaxis: {{BRAND_NAME}}, {{BRAND_TAGLINE}}, ... (ver TOKEN_MAP).
   Las plantillas se sirven desde ASSETS (estáticas) y el worker las
   transforma una vez por request, en streaming de texto completo.
   -------------------------------------------------------------------------- */

export function tokenMap(brand, origin) {
  const year = new Date().getFullYear();
  return {
    BRAND_NAME: brand.name,
    BRAND_TAGLINE: brand.tagline,
    BRAND_DESCRIPTION: brand.description,
    BUSINESS_NAME: brand.businessName,
    LEGAL_NAME: brand.legalName,
    CONTACT_PHONE: brand.phone,
    WHATSAPP_PHONE: brand.whatsapp,
    CONTACT_EMAIL: brand.email,
    BUSINESS_ADDRESS: brand.address,
    MARKET_COUNTRY: brand.country,
    MARKET_COUNTRY_CODE: brand.countryCode,
    MARKET_LOCALE: brand.locale,
    DEFAULT_CURRENCY: brand.currency,
    BRAND_PRIMARY_COLOR: brand.primaryColor,
    BRAND_SECONDARY_COLOR: brand.secondaryColor,
    BRAND_BG_COLOR: brand.bgColor,
    BRAND_LOGO: brand.logo,
    SITE_ORIGIN: origin || brand.websiteUrl,
    YEAR: String(year)
  };
}

export function applyTokens(html, brand, origin) {
  const map = tokenMap(brand, origin);
  let out = html;
  for (const [key, value] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escHtml(value));
  }
  return out;
}

/* --------------------------------------------------------------------------
   Manifest PWA dinámico: se genera desde buildBrand() para que el nombre
   instalable, colores y descripción sigan la marca sin editar archivos.
   -------------------------------------------------------------------------- */

export function buildManifest(brand, origin) {
  const base = origin || brand.websiteUrl || "";
  return {
    id: "/",
    name: `${brand.name} — ${brand.tagline}`,
    short_name: brand.name,
    description: brand.description,
    lang: brand.locale.replace("_", "-"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: brand.bgColor,
    theme_color: brand.secondaryColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      { name: "Explorar propiedades", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mapa", url: "/mapa/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }
    ],
    ...(base ? { url: base } : {})
  };
}
