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

        return await handleAPI(
          request,
          env,
          url,
          ctx
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

      console.error(
        "NEXO WORKER ERROR:",
        error
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


  return json(
    {
      ok: true,
      property:
        normalizeProperty(
          result,
          admin
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
    !(await requireAdmin(
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
    !(await requireAdmin(
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
    !(await requireAdmin(
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


  const relevant =
    rankProperties(
      message,
      properties
    )
      .slice(
        0,
        MAX_AI_PROPERTIES
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
      )

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
    !(await requireAdmin(
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


  return json(
    {
      ok: true,
      authenticated:true
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