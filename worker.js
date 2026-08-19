/**
 * ============================================================
 * NEXO 2.1 — CLOUDFLARE WORKER
 * ============================================================
 *
 * NEXO Inmueble
 *
 * Backend central:
 *
 * PUBLIC
 *   GET    /api/health
 *   GET    /api/properties
 *   GET    /api/properties/:id
 *   POST   /api/search
 *   POST   /api/ia
 *
 * ADMIN
 *   POST   /api/admin/login
 *   POST   /api/admin/logout
 *   GET    /api/admin/session
 *   POST   /api/properties
 *   PUT    /api/properties/:id
 *   PATCH  /api/properties/:id
 *   DELETE /api/properties/:id
 *   POST   /api/properties/:id/geocode
 *
 * BINDINGS
 *   DB      -> D1 nexo-db
 *   AI      -> Workers AI
 *   ASSETS  -> ./public
 *
 * SECRET
 *   ADMIN_PASSWORD
 *
 * ============================================================
 */

const AI_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SESSION_COOKIE =
  "NEXO_ADMIN_SESSION";

const SESSION_MAX_AGE =
  60 * 60 * 24 * 7;

const MAX_PROPERTIES =
  200;

const MAX_AI_PROPERTIES =
  12;

const MAX_CONVERSATION =
  20;

const MAX_MESSAGE_LENGTH =
  1000;

const MAX_BODY_BYTES =
  64 * 1024;

const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/search";


/*
 * Observabilidad mínima: aviso JSON cuando
 * una petición supera el umbral de lentitud.
 */

const SLOW_REQUEST_MS =
  2000;

function logIfSlow(
  request,
  started,
  status
) {

  const ms =
    Date.now() - started;

  if (ms > SLOW_REQUEST_MS) {

    console.warn(
      JSON.stringify({
        level: "warn",
        event:
          "slow_request",
        route:
          new URL(
            request.url
          ).pathname,
        method:
          request.method,
        status,
        ms
      })
    );

  }

}


/*
 * Rate limiting best-effort por IP (en
 * memoria por instancia). Protege los
 * endpoints con coste de Workers AI.
 */

const rateBuckets =
  new Map();

function rateLimited(
  key,
  max,
  windowMs
) {

  const now =
    Date.now();

  const list = (
    (rateBuckets.get(key) || [])
      .filter(
        time =>
          now - time < windowMs
      )
  );

  list.push(now);

  rateBuckets.set(
    key,
    list
  );

  return (
    list.length > max
  );

}


function requestIP(
  request
) {

  return (
    request.headers.get(
      "CF-Connecting-IP"
    ) || "unknown"
  );

}


/*
 * Protección best-effort contra fuerza bruta
 * en el login (en memoria por instancia).
 */

const loginAttempts =
  new Map();

const LOGIN_WINDOW_MS =
  10 * 60 * 1000;

const LOGIN_MAX_ATTEMPTS =
  10;


function loginLimited(
  ip
) {

  const now =
    Date.now();

  const list = (
    loginAttempts.get(ip) || []
  )
    .filter(
      time =>
        now - time < LOGIN_WINDOW_MS
    );

  list.push(
    now
  );

  loginAttempts.set(
    ip,
    list
  );


  return (
    list.length >
    LOGIN_MAX_ATTEMPTS
  );

}


/* ============================================================
   FETCH
============================================================ */

export default {

  async fetch(request, env, ctx) {

    const url =
      new URL(request.url);

    const started =
      Date.now();

    try {

      if (
        request.method === "OPTIONS"
      ) {

        return corsResponse(
          null,
          204,
          request
        );

      }

      if (
        url.pathname.startsWith("/api/")
      ) {

        const response =
          await handleAPI(
            request,
            env,
            url,
            ctx
          );

        logIfSlow(
          request,
          started,
          response.status
        );

        return response;

      }

      /*
       * SEO Edge-Side Rendering:
       * /propiedad/<id> sirve la página de
       * detalle con metaetiquetas Open Graph
       * inyectadas desde D1.
       */

      const ogMatch =
        url.pathname.match(
          /^\/propiedad\/(\d+)\/?$/
        );

      if (
        ogMatch &&
        env.ASSETS &&
        env.DB &&
        request.method === "GET"
      ) {

        return renderPropertyPage(
          request,
          env,
          url,
          Number(
            ogMatch[1]
          )
        );

      }


      /*
       * Sitemap dinámico: solo content-
       * routes reales desde D1. Nada de
       * thin content.
       */

      if (
        url.pathname === "/sitemap.xml" &&
        env.DB &&
        request.method === "GET"
      ) {

        return renderSitemap(
          request,
          env,
          url
        );

      }


      /*
       * robots.txt propio (el de Cloudflare
       * por defecto no enlaza el sitemap).
       */

      if (
        url.pathname === "/robots.txt" &&
        request.method === "GET"
      ) {

        return renderRobots(
          request,
          url
        );

      }

      if (env.ASSETS) {

        const response =
          await env.ASSETS.fetch(
            request
          );


        /*
         * Los assets pueden traer headers
         * inmutables; envolvemos la respuesta
         * para añadir seguridad.
         */

        const wrapped =
          new Response(
            response.body,
            response
          );


        for (
          const [key, value] of
          Object.entries(
            securityHeaders()
          )
        ) {

          wrapped.headers.set(
            key,
            value
          );

        }


        return wrapped;

      }

      return new Response(
        "NEXO",
        {
          status: 200,
          headers: {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        }
      );

    } catch (error) {

      /*
       * Log estructurado JSON: una línea
       * parseable por error, con ruta,
       * método y duración.
       */

      console.error(
        JSON.stringify({
          level: "error",
          event:
            "worker_error",
          route:
            url.pathname,
          method:
            request.method,
          status: 500,
          ms:
            Date.now() -
              started,
          error:
            String(
              error?.message ||
              error
            )
        })
      );

      return json(
        {
          ok: false,
          error:
            "Error interno de NEXO."
        },
        500,
        request
      );

    }

  }

};


/* ============================================================
   CACHE API (respuestas públicas GET, 60s)
   Si la petición trae cookie de sesión de
   administración, se sirve siempre fresco.
============================================================ */

async function cachedPublicGET(
  request,
  ctx,
  handler
) {

  const hasSession =
    request.headers
      .get("cookie")
      ?.includes(SESSION_COOKIE);

  /*
   * Sin sesión administrativa ni fuera del
   * runtime de Cloudflare (tests/dev), se
   * sirve directamente sin cachear.
   */

  if (
    hasSession ||
    typeof caches === "undefined" ||
    !caches.default ||
    !ctx ||
    !ctx.waitUntil
  ) {

    return handler();

  }


  const cache =
    caches.default;


  const key =
    new Request(
      request.url,
      { method: "GET" }
    );


  const hit =
    await cache.match(
      key
    );


  if (hit) {

    const wrapped =
      new Response(
        hit.body,
        hit
      );

    wrapped.headers.set(
      "X-Nexo-Cache",
      "HIT"
    );

    return wrapped;

  }


  const response =
    await handler();


  if (response.status === 200) {

    response.headers.set(
      "Cache-Control",
      "public, max-age=60"
    );

    ctx.waitUntil(
      cache.put(
        key,
        response.clone()
      )
    );

  }


  return response;

}


/* ============================================================
   IMAGE PROXY (preparación R2)
   Sirve y opcionalmente redimensiona imágenes
   de hosts autorizados con cf.image.
   TODO: migrar a BUCKET_IMAGENES (R2) cuando
   se cree el bucket de producción.
============================================================ */

const IMAGE_HOSTS = [
  "images.unsplash.com",
  "unsplash.com"
];

const IMAGE_WIDTH_MAX = 2000;

const IMAGE_WIDTH_MIN = 16;

const IMAGE_FORMATS = [
  "auto",
  "webp",
  "avif",
  "jpeg",
  "png"
];


function imageURLAllowed(
  candidate
) {

  let parsed;

  try {

    parsed =
      new URL(candidate);

  } catch (error) {

    return false;

  }


  if (parsed.protocol !== "https:") {

    return false;

  }


  return IMAGE_HOSTS.some(
    host =>
      parsed.hostname === host ||
      parsed.hostname.endsWith(
        `.${host}`
      )
  );

}


async function imageProxy(
  request,
  env,
  url
) {

  const params =
    url.searchParams;


  const target =
    params.get("url") || "";


  if (!imageURLAllowed(target)) {

    return json(
      {
        ok: false,
        error:
          "Imagen no permitida."
      },
      403,
      request
    );

  }


  const width =
    Number(
      params.get("width") || 0
    );

  const format = (
    params.get("format") ||
    "auto"
  ).toLowerCase();


  const options = {};


  if (width) {

    if (
      !Number.isInteger(width) ||
      width < IMAGE_WIDTH_MIN ||
      width > IMAGE_WIDTH_MAX
    ) {

      return json(
        {
          ok: false,
          error:
            "Ancho inválido."
        },
        400,
        request
      );

    }

    options.width = width;

  }

  options.format = IMAGE_FORMATS.includes(
    format
  )
    ? format
    : "auto";


  const upstream =
  await fetch(
    target,
    {
      cf: {
        image: options,
        cacheEverything: true,
        cacheTtl: 86400
      }
    }
  );


  if (!upstream.ok) {

    return json(
      {
        ok: false,
        error:
          "No se pudo obtener la imagen.",
        status:
          upstream.status
      },
      502,
      request
    );

  }


  const headers = {

    "Content-Type":
      upstream.headers.get(
        "content-type"
      ) ||
      "image/jpeg",

    "Cache-Control":
      "public, max-age=86400, immutable",

    ...securityHeaders(),

    ...corsHeaders(
      request
    )

  };


  return new Response(
    upstream.body,
    {
      status: 200,
      headers
    }
  );

}


/* ============================================================
   SEO EDGE-SIDE RENDERING
   Inyecta Open Graph en la página de
   detalle consultando D1 en el borde.
============================================================ */

function escapeAttr(
  value
) {

  return String(
    value ?? ""
  )
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function firstPhoto(
  value
) {

  if (!value) {

    return null;

  }

  try {

    const parsed =
      typeof value === "string"
        ? JSON.parse(value)
        : value;

    if (
      Array.isArray(parsed) &&
      parsed.length &&
      typeof parsed[0] === "string"
    ) {

      return parsed[0];

    }

  } catch (error) {

    /* photos vacías o mal formadas */

  }

  return null;

}


async function renderPropertyPage(
  request,
  env,
  url,
  id
) {

  const property =
    await env.DB
      .prepare(`
        SELECT
          id,
          property_type,
          title,
          province,
          city,
          neighborhood,
          price,
          square_meters,
          bedrooms,
          bathrooms,
          description,
          photos
        FROM properties
        WHERE id = ?
      `)
      .bind(id)
      .first();


  /*
   * Página base del detalle (SPA estática).
   */

  const assetURL =
    new URL(
      "/property",
      url.origin
    );

  const assetResponse =
    await env.ASSETS.fetch(
      new Request(
        assetURL.toString(),
        request
      )
    );


  let html =
    await assetResponse.text();


  if (property) {

    const title =
      property.title ||
      property.property_type ||
      `Propiedad #${id}`;


    const location =
      [
        property.neighborhood,
        property.city,
        property.province
      ]
        .filter(Boolean)
        .join(", ");


    const price =
      Number(property.price);

    const priceText =
      Number.isFinite(price)
        ? "$" +
          price.toLocaleString("en-US")
        : "";


    const description =
      (
        property.description ||
        [
          property.property_type,
          location,
          priceText
        ]
          .filter(Boolean)
          .join(" · ")
      )
        .slice(0, 220);


    const image =
      firstPhoto(
        property.photos
      );


    const pageURL =
      `${url.origin}/propiedad/${id}`;


    const tags = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="NEXO">`,
      `<meta property="og:title" content="${escapeAttr(title)} — ${escapeAttr(priceText || "NEXO")}">`,
      `<meta property="og:description" content="${escapeAttr(description)}">`,
      `<meta property="og:url" content="${escapeAttr(pageURL)}">`,
      image
        ? `<meta property="og:image" content="${escapeAttr(image)}">`
        : "",
      `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
      `<link rel="canonical" href="${escapeAttr(pageURL)}">`
    ]
      .filter(Boolean)
      .join("\n");


    /*
     * Structured Data (schema.org) con
     * campos reales de D1. Los crawlers
     * de Google/Meta lo usan para rich
     * snippets inmobiliarios.
     */

    const jsonLD = {

      "@context":
        "https://schema.org",

      "@type":
        "RealEstateListing",

      name: title,

      url: pageURL,

      ...(image
        ? { image: [image] }
        : {}),

      description,

      address: {
        "@type": "PostalAddress",
        ...(location
          ? {
              addressLocality:
                location
            }
          : {}),
        addressCountry: "CU"
      },

      ...(
        Number.isFinite(price) &&
        price > 0
          ? {
              offers: {
                "@type": "Offer",
                price,
                priceCurrency: "USD"
              }
            }
          : {}
      ),

      ...(
        Number(property.square_meters) >
          0
          ? {
              floorSize: {
                "@type":
                  "QuantitativeValue",
                value: Number(
                  property.square_meters
                ),
                unitCode: "MTK"
              }
            }
          : {}
      ),

      ...(
        Number(property.bedrooms) >
          0
          ? {
              numberOfRooms: Number(
                property.bedrooms
              )
            }
          : {}
      )

    };


    const jsonLDSafe =
      JSON.stringify(jsonLD)
        .replace(/</g, "\\u003c");


    const tags2 =
      tags +
      `\n<script type="application/ld+json">${jsonLDSafe}</script>`;


    html =
      html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeAttr(title)} — NEXO</title>`
      );


    html =
      html.replace(
        "</head>",
        `${tags2}\n</head>`
      );

  }


  const headers =
    new Headers(
      assetResponse.headers
    );

  headers.set(
    "Content-Type",
    "text/html; charset=utf-8"
  );

  for (
    const [key, value] of
    Object.entries(
      securityHeaders()
    )
  ) {

    headers.set(
      key,
      value
    );

  }


  return new Response(
    html,
    {
      status: 200,
      headers
    }
  );

}


/* ============================================================
   SITEMAP + ROBOTS (SEO Growth)
============================================================ */

function escapeXML(
  value
) {

  return String(
    value ?? ""
  )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

}


async function renderSitemap(
  request,
  env,
  url
) {

  const result =
    await env.DB
      .prepare(`
        SELECT id, created_at
        FROM properties
        WHERE status = 'available'
        ORDER BY id
        LIMIT 5000
      `)
      .all();


  const origin =
    url.origin;


  const staticPages = [
    "/",
    "/mapa/",
    "/ia/",
    "/comparar/"
  ];


  const entries = [
    ...staticPages.map(
      path => `
  <url>
    <loc>${origin}${path}</loc>
    <changefreq>daily</changefreq>
  </url>`
    ),
    ...(result.results || [])
      .map(
        row => `
  <url>
    <loc>${origin}/propiedad/${row.id}</loc>
    <lastmod>${
      escapeXML(
        String(
          row.created_at || ""
        ).split(" ")[0]
      )
    }</lastmod>
    <changefreq>weekly</changefreq>
  </url>`
      )
  ];


  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    entries.join("") +
    `\n</urlset>\n`;


  return new Response(
    xml,
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/xml; charset=utf-8",
        "Cache-Control":
          "public, max-age=3600",
        ...securityHeaders()
      }
    }
  );

}


function renderRobots(
  request,
  url
) {

  const text =
    `User-agent: *\n` +
    `Allow: /\n` +
    `Disallow: /admin.html\n` +
    `Disallow: /api/\n` +
    `\n` +
    `Sitemap: ${url.origin}/sitemap.xml\n`;


  return new Response(
    text,
    {
      status: 200,
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
        "Cache-Control":
          "public, max-age=3600",
        ...securityHeaders()
      }
    }
  );

}


/* ============================================================
   SEMANTIC SEARCH (Hito 3)
   Embeddings con Workers AI (bge, 768 dims)
   y consulta a Vectorize (nexo-index).
   Degrada con elegancia si el índice aún
   no está configurado (mock inicial).
============================================================ */

const EMBED_MODEL =
  "@cf/baai/bge-base-en-v1.5";


function propertyEmbeddingText(
  property
) {

  return [
    property.title,
    property.property_type,
    property.neighborhood,
    property.city,
    property.province,
    property.price
      ? `precio ${property.price} USD`
      : "",
    property.description
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 800);

}


async function embedTexts(
  env,
  texts
) {

  const result =
    await env.AI.run(
      EMBED_MODEL,
      { text: texts }
    );


  return (
    Array.isArray(
      result?.data
    )
      ? result.data
      : []
  );

}


async function semanticSearch(
  request,
  env
) {

  const body =
    await readJSON(
      request
    );


  /*
   * En desarrollo local el binding de
   * Vectorize puede lanzar (requiere
   * ejecución remota): degradamos a mock.
   */

  try {

    return await semanticSearchReal(
      request,
      env,
      body
    );

  } catch (error) {

    console.warn(
      "NEXO SEMANTIC (mock):",
      error?.message ||
        error
    );

    return json(
      {
        ok: true,
        semantic: false,
        note:
          "Búsqueda semántica en preparación: índice vectorial pendiente de configuración.",
        results: []
      },
      200,
      request
    );

  }

}


async function semanticSearchReal(
  request,
  env,
  body
) {


  const prompt =
    String(
      body?.prompt || ""
    )
      .trim()
      .slice(0, 500);


  if (!prompt) {

    return json(
      {
        ok: false,
        error:
          "El prompt es obligatorio."
      },
      400,
      request
    );

  }


  const limit =
    clamp(
      Number(
        body?.limit || 5
      ),
      1,
      20
    );


  /*
   * Mock inicial: sin Vectorize/AI todavía
   * configurados, se responde de forma
   * explícita sin romper al cliente.
   */

  if (
    !env.VECTOR_INDEX ||
    !env.AI ||
    !env.DB
  ) {

    return json(
      {
        ok: true,
        semantic: false,
        note:
          "Búsqueda semántica en preparación: índice vectorial pendiente de configuración.",
        results: []
      },
      200,
      request
    );

  }


  const vectors =
    await embedTexts(
      env,
      [prompt]
    );


  const vector =
    vectors[0];


  if (
    !Array.isArray(vector) ||
    !vector.length
  ) {

    return json(
      {
        ok: false,
        error:
          "No se pudo generar el embedding."
      },
      502,
      request
    );

  }


  const matches =
    await env.VECTOR_INDEX.query(
      vector,
      {
        topK: limit,
        returnMetadata: "none"
      }
    );


  const hits = (
    matches?.matches || []
  )
    .map(match => ({
      id: match.id,
      score: match.score
    }))
    .filter(hit => hit.id);


  if (!hits.length) {

    return json(
      {
        ok: true,
        semantic: true,
        results: []
      },
      200,
      request
    );

  }


  const placeholders =
    hits
      .map(() => "?")
      .join(",");


  const rows =
    await env.DB
      .prepare(`
        SELECT
          id,
          property_type,
          title,
          province,
          city,
          neighborhood,
          latitude,
          longitude,
          bedrooms,
          bathrooms,
          square_meters,
          price,
          placa_libre,
          gas_calle,
          agua_247,
          pago_exterior,
          description,
          photos,
          status,
          verified,
          created_at,
          embedding_id
        FROM properties
        WHERE embedding_id
          IN (${placeholders})
          AND status = 'available'
      `)
      .bind(
        ...hits.map(hit => hit.id)
      )
      .all();


  const byEmbedding = new Map(
    (rows.results || [])
      .map(row => [
        row.embedding_id,
        row
      ])
  );


  const results =
    hits
      .map(hit => {

        const property =
          byEmbedding.get(
            hit.id
          );

        if (!property) {

          return null;

        }

        return {
          ...normalizeProperty(
            property,
            false
          ),
          score: hit.score
        };

      })
      .filter(Boolean);


  return json(
    {
      ok: true,
      semantic: true,
      model: EMBED_MODEL,
      results
    },
    200,
    request
  );

}


/*
 * Sincroniza propiedades sin embedding_id:
 * genera el vector con Workers AI, lo sube
 * a Vectorize y guarda el ID en D1.
 * Ruta administrativa (cookie o JWT).
 */

async function syncEmbeddings(
  request,
  env
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  let rows;

  try {

    if (
      !env.VECTOR_INDEX ||
      !env.AI ||
      !env.DB
    ) {

      throw new Error(
        "bindings no configurados"
      );

    }


    rows =
      await env.DB
        .prepare(`
          SELECT
            id,
            property_type,
            title,
            province,
            city,
            neighborhood,
            price,
            description
          FROM properties
          WHERE embedding_id IS NULL
          LIMIT 25
        `)
        .all();

  } catch (error) {

    console.warn(
      "NEXO EMBEDDINGS SYNC:",
      error?.message ||
        error
    );

    return json(
      {
        ok: false,
        error:
          "Vectorize o Workers AI no están configurados."
      },
      503,
      request
    );

  }


  const pending =
    rows.results || [];


  if (!pending.length) {

    return json(
      {
        ok: true,
        synced: 0,
        note:
          "Todas las propiedades ya están sincronizadas."
      },
      200,
      request
    );

  }


  const texts =
    pending.map(
      propertyEmbeddingText
    );


  const vectors =
    await embedTexts(
      env,
      texts
    );


  const entries = [];


  for (
    let i = 0;
    i < pending.length;
    i++
  ) {

    if (
      Array.isArray(vectors[i]) &&
      vectors[i].length
    ) {

      entries.push({
        id:
          `prop-${pending[i].id}`,
        values: vectors[i]
      });

    }

  }


  if (entries.length) {

    await env.VECTOR_INDEX.upsert(
      entries
    );


    for (const entry of entries) {

      await env.DB
        .prepare(`
          UPDATE properties
          SET embedding_id = ?
          WHERE id = ?
        `)
        .bind(
          entry.id,
          Number(
            entry.id.replace(
              "prop-",
              ""
            )
          )
        )
        .run();

    }

  }


  return json(
    {
      ok: true,
      synced: entries.length,
      remaining:
        pending.length -
        entries.length
    },
    200,
    request
  );

}


/* ============================================================
   ANALYTICS PRIVADO
   Solo tipos y contadores agregados por día.
   Nada de PII, cookies ni fingerprints.
============================================================ */

const METRIC_KINDS = [
  "contact_open",
  "whatsapp_click",
  "search_no_results"
];

const METRIC_DAYS =
  30;


async function trackMetric(
  request,
  env
) {

  if (!env.DB) {

    return json(
      {
        ok: false,
        error:
          "Base de datos no configurada."
      },
      503,
      request
    );

  }


  const body =
    await readJSON(
      request
    );


  const kind =
    String(
      body?.kind || ""
    );


  if (
    !METRIC_KINDS.includes(
      kind
    )
  ) {

    return json(
      {
        ok: false,
        error:
          "Tipo de métrica inválido."
      },
      400,
      request
    );

  }


  const day =
    new Date()
      .toISOString()
      .slice(0, 10);


  await env.DB
    .prepare(`
      INSERT INTO
        analytics_counters
      (kind, day, count)
      VALUES (?, ?, 1)

      ON CONFLICT (kind, day)
      DO UPDATE SET
        count = count + 1
    `)
    .bind(
      kind,
      day
    )
    .run();


  return json(
    { ok: true },
    200,
    request
  );

}


async function getMetrics(
  request,
  env
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  if (!env.DB) {

    return json(
      {
        ok: false,
        error:
          "Base de datos no configurada."
      },
      503,
      request
    );

  }


  const since =
    new Date(
      Date.now() -
        METRIC_DAYS *
          24 *
          3600 *
          1000
    )
      .toISOString()
      .slice(0, 10);


  const rows =
    await env.DB
      .prepare(`
        SELECT
          kind,
          day,
          count
        FROM analytics_counters
        WHERE day >= ?
        ORDER BY day DESC
      `)
      .bind(since)
      .all();


  const totals = {};

  for (
    const row of
    rows.results || []
  ) {

    totals[row.kind] =
      (totals[row.kind] ||
        0) +
      row.count;

  }


  const today =
    new Date()
      .toISOString()
      .slice(0, 10);


  return json(
    {
      ok: true,
      days: METRIC_DAYS,
      totals,
      today:
        (rows.results || [])
          .filter(
            row =>
              row.day ===
              today
          ),
      series:
        rows.results || []
    },
    200,
    request
  );

}


/* ============================================================
   ROUTER
============================================================ */

async function handleAPI(
  request,
  env,
  url,
  ctx
) {

  const path =
    url.pathname;


  /*
   * Límite de tamaño para peticiones
   * que envían cuerpo (JSON).
   */

  if (
    request.method !== "GET"
  ) {

    const size =
      Number(
        request.headers.get(
          "content-length"
        ) || 0
      );

    if (
      size > MAX_BODY_BYTES
    ) {

      return json(
        {
          ok: false,
          error:
            "La solicitud es demasiado grande."
        },
        413,
        request
      );

    }

  }


  /* ----------------------------------------------------------
     HEALTH
  ---------------------------------------------------------- */

  if (
    path === "/api/health" &&
    request.method === "GET"
  ) {

    return json(
      {
        ok: true,
        service: "NEXO",
        version: "2.1",
        database:
          !!env.DB,
        ai:
          !!env.AI,
        timestamp:
          new Date().toISOString()
      },
      200,
      request
    );

  }


  /* ----------------------------------------------------------
     ADMIN LOGIN
  ---------------------------------------------------------- */

  if (
    path === "/api/admin/login" &&
    request.method === "POST"
  ) {

    return adminLogin(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     ADMIN LOGOUT
  ---------------------------------------------------------- */

  if (
    path === "/api/admin/logout" &&
    request.method === "POST"
  ) {

    return adminLogout(
      request
    );

  }


  /* ----------------------------------------------------------
     ADMIN SESSION
  ---------------------------------------------------------- */

  if (
    path === "/api/admin/session" &&
    request.method === "GET"
  ) {

    return adminSession(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     GEOCODE
  ---------------------------------------------------------- */

  const geoMatch =
    path.match(
      /^\/api\/properties\/([^/]+)\/geocode$/
    );

  if (
    geoMatch &&
    request.method === "POST"
  ) {

    const id =
      Number(
        geoMatch[1]
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return json(
        {
          ok: false,
          error:
            "ID inválido."
        },
        400,
        request
      );

    }

    return geocodeProperty(
      request,
      env,
      id
    );

  }


  /* ----------------------------------------------------------
     PROPERTIES COLLECTION
  ---------------------------------------------------------- */

  if (
    path === "/api/properties"
  ) {

    if (
      request.method === "GET"
    ) {

      return cachedPublicGET(
        request,
        ctx,
        () =>
          getProperties(
            request,
            env,
            url
          )
      );

    }

    if (
      request.method === "POST"
    ) {

      return createProperty(
        request,
        env
      );

    }

  }


  /* ----------------------------------------------------------
     IMAGE PROXY (pre-R2)
     /api/images?url=<https-url>&width=400&format=webp
  ---------------------------------------------------------- */

  if (
    path === "/api/images" &&
    request.method === "GET"
  ) {

    return imageProxy(
      request,
      env,
      url
    );

  }


  /* ----------------------------------------------------------
     INTELLIGENT SEARCH
  ---------------------------------------------------------- */

  if (
    path === "/api/search" &&
    request.method === "POST"
  ) {

    return intelligentSearch(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     SEMANTIC SEARCH (Hito 3)
     POST /api/search/semantic
     {prompt, limit?}
  ---------------------------------------------------------- */

  if (
    path === "/api/search/semantic" &&
    request.method === "POST"
  ) {

    return semanticSearch(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     EMBEDDINGS SYNC (Hito 3)
     POST /api/admin/embeddings/sync
  ---------------------------------------------------------- */

  if (
    path === "/api/admin/embeddings/sync" &&
    request.method === "POST"
  ) {

    return syncEmbeddings(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     RATE LIMIT (endpoints con coste
     de Workers AI: IA + semantic)
  ---------------------------------------------------------- */

  const aiCostedRoutes = [
    "/api/ia",
    "/api/search/semantic"
  ];

  if (
    aiCostedRoutes.includes(path) &&
    request.method === "POST"
  ) {

    const ip =
      requestIP(request);


    if (
      rateLimited(
        ip,
        20,
        60 * 1000
      )
    ) {

      return json(
        {
          ok: false,
          error:
            "Demasiadas solicitudes. Inténtalo en un minuto."
        },
        429,
        request
      );

    }

  }


  /* ----------------------------------------------------------
     ANALYTICS PRIVADO (agregado,
     sin PII ni cookies)
  ---------------------------------------------------------- */

  if (
    path === "/api/metrics/track" &&
    request.method === "POST"
  ) {

    return trackMetric(
      request,
      env
    );

  }

  if (
    path === "/api/metrics" &&
    request.method === "GET"
  ) {

    return getMetrics(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     NEXO IA
  ---------------------------------------------------------- */

  if (
    path === "/api/ia" &&
    request.method === "POST"
  ) {

    return nexAI(
      request,
      env
    );

  }


  /* ----------------------------------------------------------
     INDIVIDUAL PROPERTY
  ---------------------------------------------------------- */

  const propertyMatch =
    path.match(
      /^\/api\/properties\/([^/]+)$/
    );

  if (propertyMatch) {

    const id =
      Number(
        propertyMatch[1]
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return json(
        {
          ok: false,
          error:
            "ID inválido."
        },
        400,
        request
      );

    }


    if (
      request.method === "GET"
    ) {

      return cachedPublicGET(
        request,
        ctx,
        () =>
          getProperty(
            request,
            env,
            id
          )
      );

    }


    if (
      request.method === "PUT" ||
      request.method === "PATCH"
    ) {

      return updateProperty(
        request,
        env,
        id
      );

    }


    if (
      request.method === "DELETE"
    ) {

      return deleteProperty(
        request,
        env,
        id
      );

    }

  }


  return json(
    {
      ok: false,
      error:
        "Endpoint no encontrado."
    },
    404,
    request
  );

}


/* ============================================================
   GET PROPERTIES
============================================================ */

async function getProperties(
  request,
  env,
  url
) {

  if (!env.DB) {

    return json(
      {
        ok: false,
        error:
          "Base de datos no configurada."
      },
      500,
      request
    );

  }


  const params =
    url.searchParams;


  /*
   * Solo mostramos información privada
   * cuando existe una sesión administrativa.
   */

  const admin =
    await requireAdmin(
      request,
      env
    );


  /*
   * El listado "all" (disponibles + reservadas +
   * vendidas) es una vista administrativa.
   * Público: solo propiedades disponibles.
   */

  let status =
    params.get("status") ||
    "available";

  if (
    status === "all" &&
    !admin
  ) {

    status =
      "available";

  }


  const limit =
    clamp(
      Number(
        params.get("limit") || 100
      ),
      1,
      MAX_PROPERTIES
    );

  const offset =
    Math.max(
      0,
      Number(
        params.get("offset") || 0
      )
    );


  let sql = `
    SELECT
      id,
      property_type,
      title,
      province,
      city,
      neighborhood,
      address,
      latitude,
      longitude,
      bedrooms,
      bathrooms,
      square_meters,
      price,
      placa_libre,
      gas_calle,
      agua_247,
      pago_exterior,
      description,
      photos,
      owner_name,
      owner_phone,
      contact_email,
      notes,
      status,
      verified,
      created_at
    FROM properties
    WHERE 1 = 1
  `;


  const bindings = [];


  if (
    status !== "all"
  ) {

    sql += `
      AND status = ?
    `;

    bindings.push(
      status
    );

  }


    /*
   * Filtros de contexto cubano (1 = requerido):
   * ?placa_libre=1&gas_calle=1&agua_247=1&pago_exterior=1
   */

  const contextFlags = [
    "placa_libre",
    "gas_calle",
    "agua_247",
    "pago_exterior"
  ];

  for (const flag of contextFlags) {

    if (params.get(flag) === "1") {

      sql += `
        AND ${flag} = 1
      `;

    }

  }


  /*
   * Comparación lado a lado:
   * /api/properties?ids=a,b,c (máx. 5)
   */

  const ids = (
    params.get("ids") ||
    ""
  )
    .split(",")
    .map(
      value =>
        value.trim()
    )
    .filter(
      value =>
        value.length &&
        value.length <= 64
    )
    .slice(0, 5);


  if (
    ids.length
  ) {

    sql += `
      AND id IN (${ids
      .map(() => "?")
      .join(",")})
    `;

    bindings.push(
      ...ids
    );

  }


  sql += `
    ORDER BY created_at DESC
    LIMIT ?
    OFFSET ?
  `;


  bindings.push(
    limit,
    offset
  );


  const result =
    await env.DB
      .prepare(sql)
      .bind(...bindings)
      .all();


  const properties =
    (result.results || [])
      .map(
        property =>
          normalizeProperty(
            property,
            admin
          )
      );


  return json(
    {
      ok: true,
      success: true,
      properties,
      count:
        properties.length,
      limit,
      offset
    },
    200,
    request
  );

}


/* ============================================================
   GET PROPERTY
============================================================ */

async function getProperty(
  request,
  env,
  id
) {

  const result =
    await env.DB
      .prepare(`
        SELECT
          id,
          property_type,
          title,
          province,
          city,
          neighborhood,
          address,
          latitude,
          longitude,
          bedrooms,
          bathrooms,
          square_meters,
          price,
          placa_libre,
          gas_calle,
          agua_247,
          pago_exterior,
          description,
          photos,
          owner_name,
          owner_phone,
          contact_email,
          notes,
          status,
          verified,
          created_at
        FROM properties
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();


  if (!result) {

    return json(
      {
        ok: false,
        error:
          "Propiedad no encontrada."
      },
      404,
      request
    );

  }


  const admin =
    await requireAdmin(
      request,
      env
    );


  /*
   * Similares reales: misma ciudad y
   * precio ±30%, excluyendo la propia.
   * Solo campos reales de D1.
   */

  const similarSql = `
    SELECT
      id,
      property_type,
      title,
      province,
      city,
      neighborhood,
      bedrooms,
      bathrooms,
      square_meters,
      price,
      photos,
      status
    FROM properties
    WHERE id != ?
      AND status = 'available'
      AND (
        city = ?
        OR province = ?
      )
      AND price BETWEEN ? AND ?
    ORDER BY ABS(price - ?)
    LIMIT 4
  `;


  const price =
    Number(
      result.price
    );


  const similarRows =
    Number.isFinite(price) &&
    price > 0
      ? (
          await env.DB
            .prepare(similarSql)
            .bind(
              id,
              result.city || "",
              result.province || "",
              price * 0.7,
              price * 1.3,
              price
            )
            .all()
        ).results || []
      : [];


  return json(
    {
      ok: true,
      property:
        normalizeProperty(
          result,
          admin
        ),
      similar:
        similarRows.map(
          row =>
            normalizeProperty(
              row,
              false
            )
        )
    },
    200,
    request
  );

}


/* ============================================================
   CREATE PROPERTY
============================================================ */

async function createProperty(
  request,
  env
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  const body =
    await readJSON(
      request
    );


  if (!body) {

    return json(
      {
        ok: false,
        error:
          "JSON inválido."
      },
      400,
      request
    );

  }


  const data =
    propertyInput(
      body
    );


  const validation =
    validateProperty(
      data
    );


  if (validation) {

    return json(
      {
        ok: false,
        error:
          validation
      },
      400,
      request
    );

  }


  const result =
    await env.DB
      .prepare(`
        INSERT INTO properties (
          property_type,
          title,
          province,
          city,
          neighborhood,
          address,
          latitude,
          longitude,
          bedrooms,
          bathrooms,
          square_meters,
          price,
          placa_libre,
          gas_calle,
          agua_247,
          pago_exterior,
          description,
          photos,
          owner_name,
          owner_phone,
          contact_email,
          notes,
          status,
          verified,
          created_at
        )
        VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          datetime('now')
        )
      `)
      .bind(
        data.property_type,
        data.title,
        data.province,
        data.city,
        data.neighborhood,
        data.address,
        data.latitude,
        data.longitude,
        data.bedrooms,
        data.bathrooms,
        data.square_meters,
        data.price,
        data.placa_libre,
        data.gas_calle,
        data.agua_247,
        data.pago_exterior,
        data.description,
        data.photos,
        data.owner_name,
        data.owner_phone,
        data.contact_email,
        data.notes,
        data.status,
        data.verified
      )
      .run();


  const id =
    Number(
      result.meta?.last_row_id
    );


  let geocode =
    null;


  if (
    id &&
    data.address
  ) {

    try {

      geocode =
        await geocodePropertyInternal(
          env,
          id
        );

    } catch (error) {

      console.warn(
        "NEXO automatic geocode:",
        error
      );

    }

  }


  return json(
    {
      ok: true,
      success: true,
      id,
      geocode
    },
    201,
    request
  );

}


/* ============================================================
   UPDATE PROPERTY
============================================================ */

async function updateProperty(
  request,
  env,
  id
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  const exists =
    await env.DB
      .prepare(`
        SELECT id
        FROM properties
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();


  if (!exists) {

    return json(
      {
        ok: false,
        error:
          "Propiedad no encontrada."
      },
      404,
      request
    );

  }


  const body =
    await readJSON(
      request
    );


  if (!body) {

    return json(
      {
        ok: false,
        error:
          "JSON inválido."
      },
      400,
      request
    );

  }


  const data =
    propertyInput(
      body
    );


  const validation =
    validateProperty(
      data
    );


  if (validation) {

    return json(
      {
        ok: false,
        error:
          validation
      },
      400,
      request
    );

  }


  await env.DB
    .prepare(`
      UPDATE properties
      SET
        property_type = ?,
        title = ?,
        province = ?,
        city = ?,
        neighborhood = ?,
        address = ?,
        latitude = ?,
        longitude = ?,
        bedrooms = ?,
        bathrooms = ?,
        square_meters = ?,
        price = ?,
        placa_libre = ?,
        gas_calle = ?,
        agua_247 = ?,
        pago_exterior = ?,
        description = ?,
        photos = ?,
        owner_name = ?,
        owner_phone = ?,
        contact_email = ?,
        notes = ?,
        status = ?,
        verified = ?
      WHERE id = ?
    `)
    .bind(
      data.property_type,
      data.title,
      data.province,
      data.city,
      data.neighborhood,
      data.address,
      data.latitude,
      data.longitude,
      data.bedrooms,
      data.bathrooms,
      data.square_meters,
      data.price,
      data.placa_libre,
      data.gas_calle,
      data.agua_247,
      data.pago_exterior,
      data.description,
      data.photos,
      data.owner_name,
      data.owner_phone,
      data.contact_email,
      data.notes,
      data.status,
      data.verified,
      id
    )
    .run();


  let geocode =
    null;


  if (data.address) {

    try {

      geocode =
        await geocodePropertyInternal(
          env,
          id
        );

    } catch (error) {

      console.warn(
        "NEXO update geocode:",
        error
      );

    }

  }


  return json(
    {
      ok: true,
      success: true,
      id,
      geocode
    },
    200,
    request
  );

}


/* ============================================================
   DELETE PROPERTY
============================================================ */

async function deleteProperty(
  request,
  env,
  id
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  const result =
    await env.DB
      .prepare(`
        DELETE FROM properties
        WHERE id = ?
      `)
      .bind(id)
      .run();


  if (
    !result.meta ||
    result.meta.changes === 0
  ) {

    return json(
      {
        ok: false,
        error:
          "Propiedad no encontrada."
      },
      404,
      request
    );

  }


  return json(
    {
      ok: true,
      success: true,
      deleted: id
    },
    200,
    request
  );

}


/* ============================================================
   PROPERTY INPUT
============================================================ */

function propertyInput(
  body
) {

  return {

    property_type:
      cleanString(
        body.property_type
      ),

    title:
      cleanString(
        body.title
      ),

    province:
      cleanString(
        body.province
      ),

    city:
      cleanString(
        body.city
      ),

    neighborhood:
      cleanString(
        body.neighborhood
      ),

    address:
      cleanString(
        body.address
      ),

    latitude:
      nullableNumber(
        body.latitude
      ),

    longitude:
      nullableNumber(
        body.longitude
      ),

    bedrooms:
      nullableNumber(
        body.bedrooms
      ),

    bathrooms:
      nullableNumber(
        body.bathrooms
      ),

    square_meters:
      nullableNumber(
        body.square_meters
      ),

    price:
      nullableNumber(
        body.price
      ),

    // Filtros de contexto cubano
    placa_libre:
      body.placa_libre ? 1 : 0,

    gas_calle:
      body.gas_calle ? 1 : 0,

    agua_247:
      body.agua_247 ? 1 : 0,

    pago_exterior:
      body.pago_exterior ? 1 : 0,

    description:
      cleanString(
        body.description
      ),

    photos:
      serializePhotos(
        body.photos
      ),

    owner_name:
      cleanString(
        body.owner_name ||
        body.contact_name
      ),

    owner_phone:
      cleanString(
        body.owner_phone ||
        body.contact_phone
      ),

    contact_email:
      cleanString(
        body.contact_email
      ),

    notes:
      cleanString(
        body.notes
      ),

    status:
      normalizeStatus(
        body.status
      ),

    verified:
      body.verified ? 1 : 0

  };

}


/* ============================================================
   VALIDATION
============================================================ */

function validateProperty(
  data
) {

  if (
    !data.property_type
  ) {

    return (
      "El tipo de propiedad es obligatorio."
    );

  }


  if (
    !data.title
  ) {

    return (
      "El título de la propiedad es obligatorio."
    );

  }


  if (
    !data.city
  ) {

    return (
      "La ciudad es obligatoria."
    );

  }


  if (
    !data.address
  ) {

    return (
      "La dirección es obligatoria."
    );

  }


  if (
    data.price === null ||
    !Number.isFinite(
      data.price
    ) ||
    data.price < 0
  ) {

    return (
      "El precio es obligatorio y debe ser válido."
    );

  }


  return null;

}


/* ============================================================
   STATUS
============================================================ */

function normalizeStatus(
  value
) {

  const status =
    cleanString(
      value
    ).toLowerCase();


  if (
    status === "reserved"
  ) {

    return "reserved";

  }


  if (
    status === "sold"
  ) {

    return "sold";

  }


  return "available";

}


/* ============================================================
   NORMALIZE PROPERTY
============================================================ */

/*
 * Quality Score (Trust System, 0–100).
 * Pesos pensados para lo que más pesa
 * en la decisión de un comprador cubano:
 * fotos reales, ubicación en el mapa,
 * título y descripción informativas.
 * `contact` solo se evalúa en vistas
 * administrativas (datos privados).
 */

function computeQuality(
  property,
  includePrivate = false
) {

  const flags = [];

  let score = 0;


  const photos =
    firstPhoto(
      property.photos
    );


  if (photos) {

    score += 30;

  } else {

    flags.push("sin_fotos");

  }


  if (
    Number.isFinite(
      property.latitude
    ) &&
    Number.isFinite(
      property.longitude
    )
  ) {

    score += 25;

  } else {

    flags.push("sin_ubicacion");

  }


  if (
    String(property.title || "")
      .trim().length >= 4
  ) {

    score += 15;

  } else {

    flags.push("sin_titulo");

  }


  if (
    String(
      property.description || ""
    ).trim().length >= 40
  ) {

    score += 20;

  } else {

    flags.push(
      "sin_descripcion"
    );

  }


  if (includePrivate) {

    if (
      property.owner_phone ||
      property.contact_email
    ) {

      score += 10;

    } else {

      flags.push("sin_contacto");

    }

  } else {

    /*
     * En la vista pública no penalizamos
     * por contacto (es canalizado por NEXO).
     */

    score += 10;

  }


  return {
    score,
    complete:
      flags.length === 0,
    flags
  };

}


function normalizeProperty(
  property,
  includePrivate = false
) {

  const base = {

    id:
      property.id,

    property_type:
      property.property_type || "",

    title:
      property.title || "",

    province:
      property.province || "",

    city:
      property.city || "",

    neighborhood:
      property.neighborhood || "",

    latitude:
      nullableNumber(
        property.latitude
      ),

    longitude:
      nullableNumber(
        property.longitude
      ),

    bedrooms:
      nullableNumber(
        property.bedrooms
      ),

    bathrooms:
      nullableNumber(
        property.bathrooms
      ),

    square_meters:
      nullableNumber(
        property.square_meters
      ),

    price:
      nullableNumber(
        property.price
      ),

    description:
      property.description || "",

    photos:
      property.photos || "[]",

    status:
      property.status ||
      "available",

    // Sello público de confianza
    verified:
      property.verified ? 1 : 0,

    // Filtros cubanos (públicos)
    placa_libre:
      property.placa_libre ? 1 : 0,

    gas_calle:
      property.gas_calle ? 1 : 0,

    agua_247:
      property.agua_247 ? 1 : 0,

    pago_exterior:
      property.pago_exterior ? 1 : 0,

    created_at:
      property.created_at || null

  };


  /*
   * Datos administrativos.
   * Nunca salen a usuarios públicos.
   */

  if (includePrivate) {

    base.address =
      property.address || "";

    base.owner_name =
      property.owner_name || "";

    base.owner_phone =
      property.owner_phone || "";

    base.contact_email =
      property.contact_email || "";

    base.notes =
      property.notes || "";

  }


  /*
   * Quality Score (Trust System):
   * se deriva SOLO de campos reales.
   * Nunca se inventa ni se maquilla.
   */

  base.quality =
    computeQuality(
      base,
      includePrivate
    );


  return base;

}


/* ============================================================
   PHOTOS
============================================================ */

function serializePhotos(
  value
) {

  if (
    Array.isArray(value)
  ) {

    return JSON.stringify(
      value
        .map(
          item =>
            String(
              item ?? ""
            ).trim()
        )
        .filter(Boolean)
        .slice(0, 30)
    );

  }


  if (!value) {

    return "[]";

  }


  const text =
    String(value).trim();


  try {

    const parsed =
      JSON.parse(text);


    if (
      Array.isArray(parsed)
    ) {

      return JSON.stringify(
        parsed
          .map(
            item =>
              String(
                item ?? ""
              ).trim()
          )
          .filter(Boolean)
          .slice(0, 30)
      );

    }

  } catch (_) {}


  return JSON.stringify(
    text
      .split(/[\n,|]+/)
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean)
      .slice(0, 30)
  );

}


/* ============================================================
   INTELLIGENT SEARCH
============================================================ */

async function intelligentSearch(
  request,
  env
) {

  const body =
    await readJSON(
      request
    );


  if (!body) {

    return json(
      {
        ok: false,
        error:
          "JSON inválido."
      },
      400,
      request
    );

  }


  const query =
    cleanString(
      body.query ||
      body.message
    );


  if (!query) {

    return json(
      {
        ok: false,
        error:
          "Introduce una búsqueda."
      },
      400,
      request
    );

  }


  const properties =
    await fetchSearchProperties(
      env
    );


  const normalizedQuery =
    normalizeText(
      query
    );


  const numbers =
    normalizedQuery.match(
      /\d+(?:[.,]\d+)?/g
    ) || [];


  const budget =
    detectBudget(
      normalizedQuery
    );


  const bedrooms =
    detectBedrooms(
      normalizedQuery
    );


  const type =
    detectPropertyType(
      normalizedQuery
    );


  const city =
    detectCity(
      normalizedQuery
    );


  let results =
    properties.filter(
      property => {

        const text =
          normalizeText(
            [
              property.title,
              property.property_type,
              property.province,
              property.city,
              property.neighborhood,
              property.description
            ]
              .filter(Boolean)
              .join(" ")
          );


        if (
          type &&
          normalizeText(
            property.property_type
          ) !== type
        ) {

          return false;

        }


        if (
          city &&
          !text.includes(city)
        ) {

          return false;

        }


        if (
          bedrooms !== null &&
          Number(
            property.bedrooms
          ) < bedrooms
        ) {

          return false;

        }


        if (
          budget !== null &&
          Number(
            property.price
          ) > budget
        ) {

          return false;

        }


        return true;

      }
    );


  /*
   * Si los filtros no producen resultados,
   * hacemos búsqueda textual.
   */

  if (
    !results.length
  ) {

    results =
      properties.filter(
        property => {

          const text =
            normalizeText(
              [
                property.title,
                property.property_type,
                property.province,
                property.city,
                property.neighborhood,
                property.description
              ]
                .filter(Boolean)
                .join(" ")
            );

          return text.includes(
            normalizedQuery
          );

        }
      );

  }


  results =
    results.slice(
      0,
      MAX_AI_PROPERTIES
    );


  return json(
    {
      ok: true,
      success: true,
      query,
      filters: {
        budget,
        bedrooms,
        property_type: type,
        city
      },
      count:
        results.length,
      properties:
        results.map(
          property =>
            normalizeProperty(
              property,
              false
            )
        )
    },
    200,
    request
  );

}


/* ============================================================
   NEXO IA
============================================================ */

async function nexAI(
  request,
  env
) {

  if (!env.AI) {

    return json(
      {
        ok: false,
        error:
          "Workers AI no está configurado."
      },
      503,
      request
    );

  }


  const body =
    await readJSON(
      request
    );


  if (!body) {

    return json(
      {
        ok: false,
        error:
          "JSON inválido."
      },
      400,
      request
    );

  }


  const message =
    cleanString(
      body.message
    );


  if (!message) {

    return json(
      {
        ok: false,
        error:
          "Escribe un mensaje."
      },
      400,
      request
    );

  }


  if (
    message.length >
    MAX_MESSAGE_LENGTH
  ) {

    return json(
      {
        ok: false,
        error:
          "El mensaje es demasiado largo."
      },
      400,
      request
    );

  }


  const conversation =
    Array.isArray(
      body.conversation
    )
      ? body.conversation
          .filter(
            item =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content ===
                "string"
          )
          .slice(
            -MAX_CONVERSATION
          )
          .map(
            item => ({
              role:
                item.role,
              content:
                String(
                  item.content
                ).slice(
                  0,
                  4000
                )
            })
          )
      : [];


  /*
   * Buscamos propiedades relevantes antes
   * de llamar al modelo.
   */

  const properties =
    await fetchSearchProperties(
      env
    );


  const intent =
    detectIntent(
      message
    );


  /*
   * Boost semántico (Vectorize): cuando el
   * índice está poblado, las propiedades
   * similares al mensaje suben en el ranking
   * alfabético. Degrada a keyword si falla.
   */

  const semanticScores =
    await semanticPropertyScores(
      env,
      message
    );


  const relevant =
    rankProperties(
      message,
      properties
    )
      .map(
        property => ({
          property,
          boost:
            semanticScores?.get(
              property.id
            ) || 0
        })
      )
      .sort(
        (a,b) =>
          b.boost -
          a.boost
      )
      .slice(
        0,
        MAX_AI_PROPERTIES
      )
      .map(
        item =>
          item.property
      );


  const propertyContext =
    relevant
      .map(
        property =>
          JSON.stringify({
            id:
              property.id,
            title:
              property.title,
            type:
              property.property_type,
            province:
              property.province,
            city:
              property.city,
            neighborhood:
              property.neighborhood,
            bedrooms:
              property.bedrooms,
            bathrooms:
              property.bathrooms,
            square_meters:
              property.square_meters,
            price:
              property.price,
            description:
              property.description,
            status:
              property.status,
            verified:
              property.verified,
            placa_libre:
              property.placa_libre,
            gas_calle:
              property.gas_calle,
            agua_247:
              property.agua_247,
            pago_exterior:
              property.pago_exterior
          })
      )
      .join("\n");


  const context =
    body.context &&
    typeof body.context ===
      "object"
      ? JSON.stringify(
          sanitizeContext(
            body.context
          )
        )
      : "{}";


  const systemPrompt = `
Eres NEXO IA, el asistente inmobiliario
oficial de NEXO Inmueble.

Tu función es ayudar a encontrar propiedades
reales dentro del inventario disponible de NEXO.

REGLAS OBLIGATORIAS:

1. Nunca inventes propiedades.
2. Nunca inventes precios.
3. Nunca inventes características.
4. Utiliza exclusivamente los datos entregados
   en PROPERTY DATA.
5. Si no existe una propiedad adecuada,
   dilo claramente.
6. No reveles dirección exacta, teléfono,
   propietario, email ni notas administrativas.
7. No inventes coordenadas.
8. Si el usuario pide recomendaciones,
   explica brevemente por qué las propiedades
   encontradas pueden encajar.
9. Responde en español salvo que el usuario
   utilice claramente otro idioma.
10. Sé conciso y natural.
11. NEXO es una plataforma inmobiliaria de Cuba.
12. Si una propiedad aparece como disponible,
   puedes indicarla como disponible.
13. Si está reservada o vendida, indícalo.
14. Cuando sea útil, menciona ID de propiedad.
15. No afirmes que una propiedad existe si no
   aparece en PROPERTY DATA.
16. Las banderas de contexto cubano significan:
   placa_libre=1 (documentación en regla),
   gas_calle=1 (gas de la calle instalado),
   agua_247=1 (agua 24/7),
   pago_exterior=1 (acepta pago desde el exterior),
   verified=1 (sello ✓ Verificado).
   Menciónalas cuando sean relevantes.
17. Si el usuario pide COMPARAR, GUARDAR en
   favoritos, VER en el mapa o ABRIR una
   propiedad concreta, termina tu respuesta
   con una línea técnica exacta:
   ACTION:{"type":"compare"|"favorite"|"map"|"show_property","property_id":<id>}
   Solo una acción cuando el usuario la pida
   explícitamente. Es para la aplicación,
   no para el usuario.

MODO DE RESPUESTA (${intent}):

- search: presenta los resultados de PROPERTY DATA
  ordenados por relevancia, con datos concretos
  (tipo, zona, habitaciones, precio, ID).
- recommend: además de listar, explica brevemente
  por qué cada propiedad encaja con la petición
  del usuario y señala la mejor opción.
- compare: analiza las propiedades de PROPERTY DATA
  lado a lado: precio, habitaciones, metros,
  ubicación y estado. Termina con una conclusión
  de cuál ofrece mejor valor.

CLIENT CONTEXT:
${context}

PROPERTY DATA:
${propertyContext || "No hay propiedades relevantes."}
`;


  const messages = [

    {
      role:
        "system",
      content:
        systemPrompt
    },

    ...conversation,

    {
      role:
        "user",
      content:
        message
    }

  ];


  let result;


  try {

    result =
      await env.AI.run(
        AI_MODEL,
        {
          messages,

          max_tokens:
            700,

          temperature:
            0.2
        }
      );

  } catch (error) {

    console.error(
      "NEXO AI ERROR:",
      error
    );

    return json(
      {
        ok: false,
        error:
          "NEXO IA no pudo procesar la solicitud."
      },
      502,
      request
    );

  }


  const answer =
    extractAIAnswer(
      result
    );


  if (!answer) {

    return json(
      {
        ok: false,
        error:
          "NEXO IA no devolvió una respuesta válida."
      },
      502,
      request
    );

  }


  return json(
    {
      ok: true,
      success: true,
      answer,
      intent,
      properties:
        relevant.map(
          property =>
            normalizeProperty(
              property,
              false
            )
        )
    },
    200,
    request
  );

}


/* ============================================================
   FETCH SEARCH PROPERTIES
============================================================ */

/*
 * Score semántico Map<id,score> o null.
 * Se usa como boost opcional del ranking
 * clásico de keywords.
 */

async function semanticPropertyScores(
  env,
  message
) {

  if (
    !env.VECTOR_INDEX ||
    !env.AI
  ) {

    return null;

  }


  try {

    const vectors =
      await embedTexts(
        env,
        [message]
      );


    if (
      !Array.isArray(
        vectors[0]
      )
    ) {

      return null;

    }


    const matches =
      await env.VECTOR_INDEX.query(
        vectors[0],
        {
          topK: 8,
          returnMetadata: "none"
        }
      );


    const scores =
      new Map();


    for (
      const match of
      matches?.matches || []
    ) {

      const id =
        Number(
          String(match.id)
            .replace("prop-", "")
        );


      if (
        Number.isInteger(id)
      ) {

        scores.set(
          id,
          match.score || 0
        );

      }

    }


    return scores;

  } catch (error) {

    console.warn(
      "NEXO semantic boost:",
      error?.message ||
        error
    );

    return null;

  }

}


async function fetchSearchProperties(
  env
) {

  if (!env.DB) {

    return [];

  }


  try {

    const result =
      await env.DB
        .prepare(`
          SELECT
            id,
            property_type,
            title,
            province,
            city,
            neighborhood,
            latitude,
            longitude,
            bedrooms,
            bathrooms,
            square_meters,
            price,
            description,
            photos,
            status,
            verified,
            placa_libre,
            gas_calle,
            agua_247,
            pago_exterior,
            created_at
          FROM properties
          WHERE status != 'sold'
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .bind(
          MAX_PROPERTIES
        )
        .all();


    return result.results || [];

  } catch (error) {

    console.error(
      "NEXO property search:",
      error
    );

    return [];

  }

}


/* ============================================================
   PROPERTY RANKING
============================================================ */

function rankProperties(
  query,
  properties
) {

  const text =
    normalizeText(
      query
    );


  const budget =
    detectBudget(
      text
    );

  const bedrooms =
    detectBedrooms(
      text
    );

  const type =
    detectPropertyType(
      text
    );

  const city =
    detectCity(
      text
    );


  return properties
    .map(
      property => {

        let score = 0;

        const propertyText =
          normalizeText(
            [
              property.title,
              property.property_type,
              property.province,
              property.city,
              property.neighborhood,
              property.description
            ]
              .filter(Boolean)
              .join(" ")
          );


        if (
          type &&
          normalizeText(
            property.property_type
          ) === type
        ) {

          score += 30;

        }


        if (
          city &&
          propertyText.includes(city)
        ) {

          score += 25;

        }


        if (
          bedrooms !== null &&
          Number(
            property.bedrooms
          ) >= bedrooms
        ) {

          score += 20;

        }


        if (
          budget !== null &&
          Number(
            property.price
          ) <= budget
        ) {

          score += 20;

        }


        const terms =
          text
            .split(/\s+/)
            .filter(
              term =>
                term.length >= 3
            );


        for (
          const term of terms
        ) {

          if (
            propertyText.includes(
              term
            )
          ) {

            score += 2;

          }

        }


        return {
          property,
          score
        };

      }
    )
    .sort(
      (a,b) =>
        b.score - a.score
    )
    .map(
      item =>
        item.property
    );

}


/* ============================================================
   DETECTORS
============================================================ */

function detectPropertyType(
  text
) {

  const value =
    normalizeText(
      text
    );


  if (
    value.includes("apartamento")
  ) {

    return "apartamento";

  }


  if (
    value.includes("casa")
  ) {

    return "casa";

  }


  if (
    value.includes("villa") ||
    value.includes("vila")
  ) {

    return "villa";

  }


  if (
    value.includes("terreno")
  ) {

    return "terreno";

  }


  if (
    value.includes("local")
  ) {

    return "local";

  }


  if (
    value.includes("oficina")
  ) {

    return "oficina";

  }


  return null;

}


function detectBedrooms(
  text
) {

  const match =
    String(text)
      .match(
        /(\d+)\s*(?:habitaciones?|cuartos?|dormitorios?)/i
      );


  if (!match) {

    return null;

  }


  const value =
    Number(
      match[1]
    );


  return Number.isFinite(value)
    ? value
    : null;

}


function detectBudget(
  text
) {

  /*
   * Soporta "por $150k", "hasta 150.000",
   * "presupuesto 150 mil" y sufijos k/mil.
   */

  const value =
    String(text)
      .replace(
        /\./g,
        ""
      );


  const keywordMatch =
    value.match(
      /(?:menos de|hasta|maximo|max|máximo|presupuesto|por debajo de|por)\s*\$?\s*([\d,]+)\s*(k|mil)?/i
    );

  const dollarMatch =
    value.match(
      /\$\s*([\d,]+)\s*(k|mil)?/i
    );

  const match =
    keywordMatch ||
    dollarMatch;


  if (!match) {

    return null;

  }


  let number =
    Number(
      match[1]
        .replace(
          /,/g,
          ""
        )
    );


  if (
    match[2]
  ) {

    number *=
      match[2] === "k" ||
      match[2] === "mil"
        ? 1000
        : 1;

  }


  return Number.isFinite(number)
    ? number
    : null;

}


/* ============================================================
   INTENT (búsqueda / recomendación / comparación)
============================================================ */

function detectIntent(
  text
) {

  const value =
    normalizeText(
      text
    );


  if (
    /compar|comparacion|versus|\bvs\b|entre\s/
      .test(
        value
      )
  ) {

    return "compare";

  }


  if (
    /recomienda|recomendacion|sugiere|mejor opcion|me conviene|aconsej/
      .test(
        value
      )
  ) {

    return "recommend";

  }


  return "search";

}


function detectCity(
  text
) {

  const cities = [

    "la habana",
    "habana",
    "santiago de cuba",
    "varadero",
    "matanzas",
    "camaguey",
    "cienfuegos",
    "holguin",
    "trinidad",
    "pinar del rio",
    "pinar del río",
    "villa clara",
    "sancti spiritus",
    "las tunas",
    "granma",
    "guantanamo",
    "guantánamo",
    "ciego de avila",
    "cuba"

  ];


  const normalized =
    normalizeText(
      text
    );


  return (
    cities
      .map(
        city => ({
          original:city,
          normalized:
            normalizeText(
              city
            )
        })
      )
      .sort(
        (a,b) =>
          b.normalized.length -
          a.normalized.length
      )
      .find(
        city =>
          normalized.includes(
            city.normalized
          )
      )
      ?.normalized ||
    null
  );

}


/* ============================================================
   AI ANSWER
============================================================ */

function extractAIAnswer(
  result
) {

  if (
    typeof result === "string"
  ) {

    return result.trim();

  }


  if (
    result &&
    typeof result.response ===
      "string"
  ) {

    return result.response.trim();

  }


  if (
    result &&
    typeof result.output ===
      "string"
  ) {

    return result.output.trim();

  }


  if (
    result &&
    Array.isArray(
      result.result
    )
  ) {

    return result.result
      .map(
        item =>
          typeof item === "string"
            ? item
            : item?.text || ""
      )
      .join(" ")
      .trim();

  }


  return "";

}


/* ============================================================
   CONTEXT SANITIZATION
============================================================ */

function sanitizeContext(
  context
) {

  const property =
    context.property &&
    typeof context.property ===
      "object"
      ? {

          id:
            safeInteger(
              context.property.id
            ),

          title:
            cleanString(
              context.property.title
            ).slice(
              0,
              140
            ),

          property_type:
            cleanString(
              context.property
                .property_type
            ).slice(
              0,
              50
            ),

          price:
            safeNumber(
              context.property.price
            ),

          city:
            cleanString(
              context.property.city
            ).slice(
              0,
              80
            ),

          province:
            cleanString(
              context.property
                .province
            ).slice(
              0,
              80
            ),

          neighborhood:
            cleanString(
              context.property
                .neighborhood
            ).slice(
              0,
              80
            )

        }
      : null;


  return {

    city:
      cleanString(
        context.city
      ).slice(
        0,
        80
      ) || null,

    property_type:
      cleanString(
        context.property_type
      ).slice(
        0,
        50
      ) || null,

    bedrooms:
      safeInteger(
        context.bedrooms
      ),

    budget:
      safeNumber(
        context.budget
      ),

    questions:
      safeInteger(
        context.questions
      ),

    property

  };

}


/* ============================================================
   GEOCODING
============================================================ */

async function geocodeProperty(
  request,
  env,
  id
) {

  if (
    !(await requireAuth(
      request,
      env
    ))
  ) {

    return json(
      {
        ok: false,
        error:
          "No autorizado."
      },
      401,
      request
    );

  }


  try {

    const result =
      await geocodePropertyInternal(
        env,
        id
      );


    return json(
      {
        ok: true,
        success: true,
        geocode: result
      },
      200,
      request
    );

  } catch (error) {

    console.error(
      "NEXO geocode:",
      error
    );


    return json(
      {
        ok: false,
        error:
          error.message ||
          "No se pudo ubicar la propiedad."
      },
      500,
      request
    );

  }

}


/* ============================================================
   GEOCODE INTERNAL
============================================================ */

async function geocodePropertyInternal(
  env,
  id
) {

  if (!env.DB) {

    throw new Error(
      "Base de datos no configurada."
    );

  }


  const property =
    await env.DB
      .prepare(`
        SELECT
          id,
          address,
          neighborhood,
          city,
          province
        FROM properties
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();


  if (!property) {

    throw new Error(
      "Propiedad no encontrada."
    );

  }


  const parts = [

    property.address,

    property.neighborhood,

    property.city,

    property.province,

    "Cuba"

  ]
    .filter(Boolean);


  if (!parts.length) {

    return {
      found:false,
      reason:
        "No hay dirección suficiente."
    };

  }


  const query =
    parts.join(
      ", "
    );


  const endpoint =
    new URL(
      NOMINATIM_URL
    );


  endpoint.searchParams.set(
    "format",
    "jsonv2"
  );

  endpoint.searchParams.set(
    "limit",
    "1"
  );

  endpoint.searchParams.set(
    "countrycodes",
    "cu"
  );

  endpoint.searchParams.set(
    "q",
    query
  );


  const response =
    await fetch(
      endpoint.toString(),
      {
        method:"GET",
        headers:{
          "Accept":
            "application/json",
          "User-Agent":
            "NEXO-Inmueble/2.1"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `Servicio de geocodificación HTTP ${response.status}.`
    );

  }


  const results =
    await response.json();


  if (
    !Array.isArray(results) ||
    !results.length
  ) {

    return {
      found:false,
      query
    };

  }


  const first =
    results[0];


  const latitude =
    Number(
      first.lat
    );

  const longitude =
    Number(
      first.lon
    );


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {

    return {
      found:false,
      query
    };

  }


  await env.DB
    .prepare(`
      UPDATE properties
      SET
        latitude = ?,
        longitude = ?
      WHERE id = ?
    `)
    .bind(
      latitude,
      longitude,
      id
    )
    .run();


  return {

    found:true,

    latitude,

    longitude,

    display_name:
      first.display_name ||
      "",

    query

  };

}


/* ============================================================
   ADMIN LOGIN
============================================================ */

async function adminLogin(
  request,
  env
) {

  if (!env.ADMIN_PASSWORD) {

    return json(
      {
        ok: false,
        error:
          "ADMIN_PASSWORD no está configurado."
      },
      500,
      request
    );

  }


  const ip =
    request.headers.get(
      "CF-Connecting-IP"
    ) || "unknown";


  if (
    loginLimited(ip)
  ) {

    return json(
      {
        ok: false,
        error:
          "Demasiados intentos. Inténtalo más tarde."
      },
      429,
      request
    );

  }


  const body =
    await readJSON(
      request
    );


  const password =
    typeof body?.password ===
      "string"
      ? body.password
      : "";


  if (!password) {

    return json(
      {
        ok: false,
        error:
          "Contraseña requerida."
      },
      400,
      request
    );

  }


  const valid =
    await constantTimeEqual(
      password,
      env.ADMIN_PASSWORD
    );


  if (!valid) {

    return json(
      {
        ok: false,
        authenticated:false,
        error:
          "Contraseña incorrecta."
      },
      401,
      request
    );

  }


  const token =
    await createSessionToken(
      env.ADMIN_PASSWORD
    );


  /*
   * JWT para clientes API (Hito 4):
   * se emite además de la cookie.
   */

  const jwtSecret =
    env.JWT_SECRET ||
    env.ADMIN_PASSWORD;


  const jwt =
    await jwtSign(
      {
        sub: "admin",
        role: "admin"
      },
      jwtSecret,
      SESSION_MAX_AGE
    );


  return json(
    {
      ok: true,
      authenticated:true,
      token: jwt,
      token_type: "Bearer",
      expires_in:
        SESSION_MAX_AGE
    },
    200,
    request,
    {
      "Set-Cookie":
        buildSessionCookie(
          token
        )
    }
  );

}


/* ============================================================
   ADMIN SESSION
============================================================ */

async function adminSession(
  request,
  env
) {

  const authenticated =
    await requireAdmin(
      request,
      env
    );


  return json(
    {
      ok:true,
      authenticated
    },
    200,
    request
  );

}


/* ============================================================
   ADMIN LOGOUT
============================================================ */

async function adminLogout(
  request
) {

  return json(
    {
      ok:true,
      authenticated:false
    },
    200,
    request,
    {
      "Set-Cookie":
        `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    }
  );

}


/* ============================================================
   ADMIN AUTH
============================================================ */

async function requireAdmin(
  request,
  env
) {

  if (
    !env.ADMIN_PASSWORD
  ) {

    return false;

  }


  const cookies =
    parseCookies(
      request.headers.get(
        "Cookie"
      )
    );


  const token =
    cookies[
      SESSION_COOKIE
    ];


  if (!token) {

    return false;

  }


  return verifySessionToken(
    token,
    env.ADMIN_PASSWORD
  );

}


/* ============================================================
   JWT (Hito 4)
   HS256 con WebCrypto. Se acepta la cookie
   de sesión admin O un Bearer JWT válido.
   Secreto: env.JWT_SECRET (recomendado);
   fallback documentado: ADMIN_PASSWORD.
============================================================ */

function base64urlEncode(
  value
) {

  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);

  let binary = "";

  for (const byte of bytes) {

    binary += String.fromCharCode(byte);

  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

}


function base64urlDecode(
  value
) {

  const normalized =
    String(value)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const binary =
    atob(
      normalized +
      "=".repeat(
        (4 - (normalized.length % 4)) % 4
      )
    );

  return Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

}


async function jwtSign(
  payload,
  secret,
  ttlSeconds
) {

  const header =
    base64urlEncode(
      JSON.stringify({
        alg: "HS256",
        typ: "JWT"
      })
    );


  const body =
    base64urlEncode(
      JSON.stringify({
        ...payload,
        iat: Math.floor(
          Date.now() / 1000
        ),
        exp:
          Math.floor(
            Date.now() / 1000
          ) + ttlSeconds
      })
    );


  const signature =
    await hmacBinary(
      `${header}.${body}`,
      secret
    );


  return (
    `${header}.${body}.` +
    base64urlEncode(
      signature
    )
  );

}


async function jwtVerify(
  token,
  secret
) {

  try {

    const parts =
      String(token).split(".");


    if (parts.length !== 3) {

      return null;

    }


    const signature =
      base64urlDecode(
        parts[2]
      );


    const expected =
      await hmacBinary(
        `${parts[0]}.${parts[1]}`,
        secret
      );


    if (
      !constantTimeBytesEqual(
        signature,
        expected
      )
    ) {

      return null;

    }


    const payload =
      JSON.parse(
        new TextDecoder()
          .decode(
            base64urlDecode(
              parts[1]
            )
          )
      );


    const now =
      Math.floor(
        Date.now() / 1000
      );


    if (
      !payload ||
      typeof payload.exp !==
        "number" ||
      payload.exp < now - 60
    ) {

      return null;

    }


    return payload;

  } catch (_) {

    return null;

  }

}


async function hmacBinary(
  value,
  secret
) {

  const encoder =
    new TextEncoder();


  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        secret
      ),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );


  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        value
      )
    )
  );

}


function constantTimeBytesEqual(
  a,
  b
) {

  if (
    !(a instanceof Uint8Array) ||
    !(b instanceof Uint8Array) ||
    a.length !== b.length
  ) {

    return false;

  }


  let diff = 0;

  for (let i = 0; i < a.length; i++) {

    diff |= a[i] ^ b[i];

  }

  return diff === 0;

}


/*
 * Guardia única para mutaciones:
 * cookie de sesión admin O Bearer JWT.
 */

async function requireAuth(
  request,
  env
) {

  if (
    await requireAdmin(
      request,
      env
    )
  ) {

    return true;

  }


  const secret =
    env.JWT_SECRET ||
    env.ADMIN_PASSWORD;


  if (!secret) {

    return false;

  }


  const header =
    request.headers.get(
      "Authorization"
    ) || "";


  const match =
    header.match(
      /^Bearer\s+(.+)$/i
    );


  if (!match) {

    return false;

  }


  return (
    (await jwtVerify(
      match[1],
      secret
    )) !== null
  );

}


/* ============================================================
   SESSION TOKEN
============================================================ */

async function createSessionToken(
  secret
) {

  const timestamp =
    Date.now().toString();


  const signature =
    await hmac(
      timestamp,
      secret
    );


  return (
    timestamp +
    "." +
    signature
  );

}


async function verifySessionToken(
  token,
  secret
) {

  try {

    const parts =
      String(token)
        .split(".");


    if (
      parts.length !== 2
    ) {

      return false;

    }


    const timestamp =
      Number(
        parts[0]
      );


    if (
      !Number.isFinite(timestamp)
    ) {

      return false;

    }


    const age =
      Date.now() -
        timestamp;


    /*
     * Rechaza tokens expirados y tokens
     * con timestamp en el futuro (60s skew).
     */

    if (
      age >
        SESSION_MAX_AGE * 1000 ||
      age <
        -60 * 1000
    ) {

      return false;

    }


    const expected =
      await hmac(
        String(timestamp),
        secret
      );


    return constantTimeStringEqual(
      parts[1],
      expected
    );

  } catch (_) {

    return false;

  }

}


async function hmac(
  value,
  secret
) {

  const encoder =
    new TextEncoder();


  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        secret
      ),
      {
        name:
          "HMAC",
        hash:
          "SHA-256"
      },
      false,
      [
        "sign"
      ]
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        value
      )
    );


  return [...new Uint8Array(
    signature
  )]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2,"0")
    )
    .join("");

}


async function constantTimeEqual(
  a,
  b
) {

  return constantTimeStringEqual(
    String(a),
    String(b)
  );

}


function constantTimeStringEqual(
  a,
  b
) {

  if (
    a.length !==
    b.length
  ) {

    return false;

  }


  let result = 0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);

  }


  return result === 0;

}


/* ============================================================
   COOKIES
============================================================ */

function parseCookies(
  header
) {

  const cookies = {};


  if (!header) {

    return cookies;

  }


  header
    .split(";")
    .forEach(
      part => {

        const index =
          part.indexOf("=");


        if (
          index === -1
        ) {

          return;

        }


        const key =
          part
            .slice(
              0,
              index
            )
            .trim();


        const value =
          part
            .slice(
              index + 1
            )
            .trim();


        cookies[key] =
          value;

      }
    );


  return cookies;

}


function buildSessionCookie(
  token
) {

  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");

}


/* ============================================================
   JSON / HTTP
============================================================ */

async function readJSON(
  request
) {

  try {

    const text =
      await request.text();


    if (!text) {

      return null;

    }


    return JSON.parse(
      text
    );

  } catch (_) {

    return null;

  }

}


function json(
  data,
  status = 200,
  request = null,
  extraHeaders = {}
) {

  const headers = {

    "Content-Type":
      "application/json; charset=utf-8",

    "Cache-Control":
      "no-store",

    ...securityHeaders(),

    ...corsHeaders(
      request
    ),

    ...extraHeaders

  };


  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,
      headers
    }
  );

}


/*
 * Cabeceras de seguridad aplicables
 * a toda la plataforma.
 */

function securityHeaders() {

  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' https: data:",
    "font-src 'self' https: data:",
    "connect-src 'self' https://unpkg.com https://tiles.openfreemap.org https://*.basemaps.cartocdn.com",
    "worker-src 'self' blob:",
    "child-src blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");


  return {

    "X-Content-Type-Options":
      "nosniff",

    "Referrer-Policy":
      "strict-origin-when-cross-origin",

    "X-Frame-Options":
      "DENY",

    "Content-Security-Policy":
      policy,

    /*
     * HSTS: HTTPS obligatorio. Sin
     * includeSubDomains para no afectar
     * a futuros subdominios.
     */

    "Strict-Transport-Security":
      "max-age=15552000",

    /*
     * Restringe APIs del navegador:
     * cámara/micrófono deshabilitados;
     * geolocalización solo propia (la
     * usa el mapa para ubicar al usuario).
     */

    "Permissions-Policy":
      "camera=(), microphone=(), " +
      "geolocation=(self)"

  };

}


function corsResponse(
  data,
  status,
  request
) {

  if (
    data === null
  ) {

    return new Response(
      null,
      {
        status,
        headers:
          corsHeaders(
            request
          )
      }
    );

  }


  return json(
    data,
    status,
    request
  );

}


function corsHeaders(
  request
) {

  /*
   * NEXO funciona bajo el mismo dominio.
   *
   * Solo reflejamos el Origin cuando coincide
   * con el host de la propia petición.
   * Cualquier otro origen recibe una respuesta
   * sin cabeceras CORS y el navegador la bloquea.
   */

  const origin =
    request?.headers.get(
      "Origin"
    );


  if (
    !origin ||
    !request
  ) {

    return {};

  }


  let allowed =
    false;

  try {

    const originURL =
      new URL(origin);

    const requestURL =
      new URL(request.url);

    allowed =
      originURL.host ===
        requestURL.host;

  } catch (_){
    allowed = false;
  }


  if (!allowed) {

    return {};

  }


  return {

    "Access-Control-Allow-Origin":
      origin,

    "Access-Control-Allow-Credentials":
      "true",

    "Access-Control-Allow-Methods":
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Accept, X-NEXO-CLIENT, X-NEXO-SESSION"

  };

}


/* ============================================================
   HELPERS
============================================================ */

function cleanString(
  value
) {

  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      5000
    );

}


function nullableNumber(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;

}


function safeNumber(
  value
) {

  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;

}


function safeInteger(
  value
) {

  const number =
    Number(
      value
    );


  return Number.isInteger(
    number
  )
    ? number
    : null;

}


function clamp(
  value,
  min,
  max
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return min;

  }


  return Math.min(
    max,
    Math.max(
      min,
      Math.floor(value)
    )
  );

}


function normalizeText(
  value
) {

  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();

}