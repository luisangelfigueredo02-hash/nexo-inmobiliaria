/**
 * ============================================================
 * NEXO 2.0 — CLOUDFLARE WORKER
 * ============================================================
 *
 * NEXO Inmueble
 *
 * API:
 *   GET    /api/health
 *   GET    /api/properties
 *   POST   /api/properties
 *   GET    /api/properties/:id
 *   PUT    /api/properties/:id
 *   PATCH  /api/properties/:id
 *   DELETE /api/properties/:id
 *   POST   /api/properties/:id/geocode
 *   POST   /api/search
 *   POST   /api/ia
 *
 * ADMIN:
 *   POST   /api/admin/login
 *   POST   /api/admin/logout
 *   GET    /api/admin/session
 *
 * Bindings:
 *   DB      -> D1 nexo-db
 *   AI      -> Workers AI
 *   ASSETS  -> ./public
 *
 * Secret:
 *   ADMIN_PASSWORD
 *
 * ============================================================
 */

const AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct";

const SESSION_COOKIE =
  "NEXO_ADMIN_SESSION";

const AI_SESSION_HEADER =
  "X-NEXO-SESSION";

const MAX_PROPERTIES =
  200;

const MAX_AI_PROPERTIES =
  12;

const MAX_CONVERSATION =
  20;


/* ============================================================
   FETCH PRINCIPAL
   ============================================================ */

export default {
  async fetch(request, env) {

    const url =
      new URL(request.url);

    try {

      /*
       * CORS / PREFLIGHT
       */

      if (
        request.method === "OPTIONS"
      ) {

        return corsResponse(
          null,
          204,
          request
        );
      }


      /*
       * API
       */

      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {

        return handleAPI(
          request,
          env,
          url
        );
      }


      /*
       * ARCHIVOS PÚBLICOS
       */

      if (env.ASSETS) {

        return env.ASSETS.fetch(
          request
        );
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
   ROUTER
   ============================================================ */

async function handleAPI(
  request,
  env,
  url
) {

  const path =
    url.pathname;


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
        version: "2.0",
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
     GEOCODIFICACIÓN
     
     IMPORTANTE:
     Esta ruta debe evaluarse ANTES de /properties/:id.
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
     PROPIEDADES — COLECCIÓN
  ---------------------------------------------------------- */

  if (
    path === "/api/properties"
  ) {

    if (
      request.method === "GET"
    ) {

      return getProperties(
        request,
        env,
        url
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
     BÚSQUEDA
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
     PROPIEDAD INDIVIDUAL
  ---------------------------------------------------------- */

  const match =
    path.match(
      /^\/api\/properties\/([^/]+)$/
    );

  if (match) {

    const id =
      Number(
        match[1]
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

      return getProperty(
        request,
        env,
        id
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


  /* ----------------------------------------------------------
     ENDPOINT NO ENCONTRADO
  ---------------------------------------------------------- */

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


  const status =
    params.get("status") ||
    "available";


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
      description,
      photos,
      status,
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


  sql += `
    ORDER BY
      created_at DESC
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
        normalizeProperty
      );


  return json(
    {
      ok: true,
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
          description,
          photos,
          owner_name,
          owner_phone,
          contact_email,
          notes,
          status,
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


  /*
   * normalizeProperty elimina
   * automáticamente los datos privados.
   */

  return json(
    {
      ok: true,
      property:
        normalizeProperty(
          result
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


  if (
    !data.property_type
  ) {

    return json(
      {
        ok: false,
        error:
          "El tipo de propiedad es obligatorio."
      },
      400,
      request
    );
  }


  if (
    data.price === null ||
    data.price < 0
  ) {

    return json(
      {
        ok: false,
        error:
          "El precio es obligatorio y debe ser válido."
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
          description,
          photos,
          owner_name,
          owner_phone,
          contact_email,
          notes,
          status,
          created_at
        )
        VALUES (
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
        data.description,
        data.photos,
        data.owner_name,
        data.owner_phone,
        data.contact_email,
        data.notes,
        data.status
      )
      .run();


  const id =
    result.meta?.last_row_id;


  /*
   * Intentamos geocodificar automáticamente.
   *
   * Si falla, la propiedad igualmente queda creada.
   */

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
          Number(id)
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


  if (
    !data.property_type
  ) {

    return json(
      {
        ok: false,
        error:
          "El tipo de propiedad es obligatorio."
      },
      400,
      request
    );
  }


  if (
    data.price === null ||
    data.price < 0
  ) {

    return json(
      {
        ok: false,
        error:
          "El precio es obligatorio y debe ser válido."
      },
      400,
      request
    );
  }


  const result =
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
          description = ?,
          photos = ?,
          owner_name = ?,
          owner_phone = ?,
          contact_email = ?,
          notes = ?,
          status = ?
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
        data.description,
        data.photos,
        data.owner_name,
        data.owner_phone,
        data.contact_email,
        data.notes,
        data.status,
        id
      )
      .run();


  if (
    !result.success
  ) {

    return json(
      {
        ok: false,
        error:
          "No se pudo actualizar la propiedad."
      },
      500,
      request
    );
  }


  /*
   * Si la dirección cambió o no existen
   * coordenadas, intentamos geocodificar.
   */

  let geocode =
    null;


  if (
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
        "NEXO update geocode:",
        error
      );
    }
  }


  return json(
    {
      ok: true,
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
    result.meta?.changes === 0
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
      id
    },
    200,
    request
  );
}


/* ============================================================
   SEARCH
   ============================================================ */

async function intelligentSearch(
  request,
  env
) {

  const body =
    await readJSON(
      request
    );


  const query =
    String(
      body?.query ||
      body?.message ||
      ""
    ).trim();


  if (!query) {

    return json(
      {
        ok: true,
        query: "",
        criteria: {},
        properties: [],
        count: 0
      },
      200,
      request
    );
  }


  const criteria =
    extractSearchCriteria(
      query
    );


  const search =
    buildPropertySearch(
      criteria,
      query,
      50
    );


  const result =
    await env.DB
      .prepare(
        search.sql
      )
      .bind(
        ...search.bindings
      )
      .all();


  const properties =
    (result.results || [])
      .map(
        normalizeProperty
      );


  return json(
    {
      ok: true,
      query,
      criteria,
      properties,
      count:
        properties.length
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

  const body =
    await readJSON(
      request
    );


  const message =
    String(
      body?.message ||
      body?.query ||
      ""
    ).trim();


  if (!message) {

    return json(
      {
        ok: false,
        error:
          "Escribe una pregunta."
      },
      400,
      request
    );
  }


  let conversation =
    Array.isArray(
      body?.conversation
    )
      ? body.conversation
      : [];


  conversation =
    conversation
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
      );


  const criteria =
    extractSearchCriteria(
      message
    );


  const search =
    buildPropertySearch(
      criteria,
      message,
      MAX_AI_PROPERTIES
    );


  const result =
    await env.DB
      .prepare(
        search.sql
      )
      .bind(
        ...search.bindings
      )
      .all();


  const properties =
    (result.results || [])
      .map(
        normalizeProperty
      )
      .slice(
        0,
        MAX_AI_PROPERTIES
      );


  const propertyContext =
    properties.length
      ? properties
          .map(
            (p, index) =>
              [
                `${index + 1}.`,
                `Título: ${
                  p.title ||
                  p.property_type
                }`,
                `Precio: ${
                  formatMoney(
                    p.price
                  )
                }`,
                `Tipo: ${
                  p.property_type
                }`,
                `Provincia: ${
                  p.province ||
                  "N/D"
                }`,
                `Ciudad: ${
                  p.city ||
                  "N/D"
                }`,
                `Zona: ${
                  p.neighborhood ||
                  "N/D"
                }`,
                `Habitaciones: ${
                  p.bedrooms ??
                  "N/D"
                }`,
                `Baños: ${
                  p.bathrooms ??
                  "N/D"
                }`,
                `m²: ${
                  p.square_meters ??
                  "N/D"
                }`,
                `Descripción: ${
                  truncate(
                    p.description,
                    350
                  )
                }`
              ].join(" | ")
          )
          .join("\n")
      : "No se encontraron propiedades que coincidan con la búsqueda.";


  const system =
`
Eres NEXO IA, el asistente inmobiliario
oficial de NEXO Inmueble para Cuba.

Tu objetivo es ayudar al usuario a:
- encontrar propiedades;
- comparar propiedades;
- entender características;
- navegar la oferta inmobiliaria.

REGLAS:

1. Nunca inventes propiedades.

2. Nunca inventes precios,
   habitaciones, baños, metros,
   ubicaciones o características.

3. Solo utiliza datos presentes
   en el contexto de propiedades.

4. Nunca reveles:
   - owner_name
   - owner_phone
   - contact_email
   - notes
   - dirección exacta privada

5. Si no existen resultados,
   dilo claramente.

6. Si el usuario pregunta algo general,
   responde de forma natural.

7. Puedes comparar propiedades,
   pero solamente utilizando
   los datos disponibles.

8. No afirmes que una propiedad
   está disponible si no aparece
   como disponible.

9. Sé breve, elegante,
   claro y útil.

10. NEXO debe sentirse premium,
    moderno y humano.

PROPIEDADES ENCONTRADAS:

${propertyContext}
`;


  const messages = [
    {
      role:
        "system",
      content:
        system
    },

    ...conversation,

    {
      role:
        "user",
      content:
        message
    }
  ];


  let answer =
    "";


  if (env.AI) {

    try {

      const aiResult =
        await env.AI.run(
          AI_MODEL,
          {
            messages,
            max_tokens:
              700,
            temperature:
              0.25
          }
        );


      answer =
        aiResult?.response ||
        aiResult?.result?.response ||
        "";

    } catch (error) {

      console.error(
        "NEXO AI ERROR:",
        error
      );
    }
  }


  if (!answer) {

    if (
      properties.length === 1
    ) {

      const p =
        properties[0];

      answer =
        `Encontré una propiedad que puede encajar con tu búsqueda: ${
          p.title ||
          p.property_type
        }, por ${
          formatMoney(
            p.price
          )
        }.`;

    } else if (
      properties.length > 1
    ) {

      answer =
        `Encontré ${
          properties.length
        } propiedades que pueden encajar con tu búsqueda.`;

    } else {

      answer =
        "No encontré propiedades que coincidan con esa búsqueda.";
    }
  }


  return json(
    {
      ok: true,
      answer,
      response:
        answer,
      properties,
      criteria,
      session:
        request.headers.get(
          AI_SESSION_HEADER
        ) || null
    },
    200,
    request
  );
}


/* ============================================================
   SEARCH CRITERIA
   ============================================================ */

function extractSearchCriteria(
  text
) {

  const q =
    normalize(text);


  const criteria = {

    property_type:
      null,

    province:
      null,

    city:
      null,

    neighborhood:
      null,

    bedrooms_min:
      null,

    bedrooms_max:
      null,

    bathrooms_min:
      null,

    price_max:
      null,

    price_min:
      null,

    area_min:
      null,

    area_max:
      null
  };


  /* ----------------------------------------------------------
     PROPERTY TYPE
  ---------------------------------------------------------- */

  if (
    /\b(casa|casas|vivienda|villa|chalet)\b/
      .test(q)
  ) {

    criteria.property_type =
      "casa";

  } else if (
    /\b(apartamento|apartamentos|piso)\b/
      .test(q)
  ) {

    criteria.property_type =
      "apartamento";

  } else if (
    /\b(local|locales|comercial)\b/
      .test(q)
  ) {

    criteria.property_type =
      "local";

  } else if (
    /\b(terreno|terrenos|solar)\b/
      .test(q)
  ) {

    criteria.property_type =
      "terreno";

  } else if (
    /\b(oficina|oficinas)\b/
      .test(q)
  ) {

    criteria.property_type =
      "oficina";
  }


  /* ----------------------------------------------------------
     PROVINCES
  ---------------------------------------------------------- */

  const provinces = [
    "la habana",
    "artemisa",
    "mayabeque",
    "pinar del rio",
    "pinar del río",
    "matanzas",
    "villa clara",
    "cienfuegos",
    "sancti spiritus",
    "sancti spíritus",
    "ciego de avila",
    "ciego de ávila",
    "camaguey",
    "camagüey",
    "las tunas",
    "holguin",
    "holguín",
    "granma",
    "santiago de cuba",
    "guantanamo",
    "guantánamo",
    "isla de la juventud"
  ];


  for (
    const province of provinces
  ) {

    if (
      q.includes(
        normalize(province)
      )
    ) {

      criteria.province =
        normalize(
          province
        );

      break;
    }
  }


  /* ----------------------------------------------------------
     NEIGHBORHOODS / ZONES
  ---------------------------------------------------------- */

  const neighborhoods = [
    "playa",
    "vedado",
    "miramar",
    "siboney",
    "kohly",
    "la coronela",
    "habana vieja",
    "la habana vieja",
    "centro habana",
    "plaza",
    "cerro",
    "10 de octubre",
    "boyeros",
    "la lisa",
    "marianao",
    "guanabacoa",
    "regla",
    "arroyo naranjo",
    "cotorro",
    "habana del este"
  ];


  for (
    const zone of neighborhoods
  ) {

    if (
      q.includes(
        normalize(zone)
      )
    ) {

      criteria.neighborhood =
        normalize(zone);


      if (
        !criteria.province
      ) {

        criteria.province =
          "la habana";
      }

      break;
    }
  }


  /* ----------------------------------------------------------
     BEDROOMS
  ---------------------------------------------------------- */

  let match =
    q.match(
      /(\d+)\s*(?:habitaciones|habitacion|dormitorios|dormitorio|cuartos|cuarto)/
    );


  if (!match) {

    match =
      q.match(
        /(\d+)\s*(?:hab|habs)\b/
      );
  }


  if (match) {

    criteria.bedrooms_min =
      Number(
        match[1]
      );
  }


  /* ----------------------------------------------------------
     BATHROOMS
  ---------------------------------------------------------- */

  match =
    q.match(
      /(\d+)\s*(?:baños|banos|baño|bano)/
    );


  if (match) {

    criteria.bathrooms_min =
      Number(
        match[1]
      );
  }


  /* ----------------------------------------------------------
     PRICE MAX
  ---------------------------------------------------------- */

  match =
    q.match(
      /(?:menos de|hasta|maximo|max|por debajo de|menos de)\s*\$?\s*([\d.,]+)\s*(k|mil|m)?/
    );


  if (match) {

    criteria.price_max =
      parsePrice(
        match[1],
        match[2]
      );

  } else {

    match =
      q.match(
        /\$?\s*([\d.,]+)\s*(k|mil|m)?\s*(?:o menos|como maximo|maximo)/
      );


    if (match) {

      criteria.price_max =
        parsePrice(
          match[1],
          match[2]
        );
    }
  }


  /* ----------------------------------------------------------
     PRICE MIN
  ---------------------------------------------------------- */

  match =
    q.match(
      /(?:mas de|más de|desde|minimo|mínimo)\s*\$?\s*([\d.,]+)\s*(k|mil|m)?/
    );


  if (match) {

    criteria.price_min =
      parsePrice(
        match[1],
        match[2]
      );
  }


  /* ----------------------------------------------------------
     AREA
  ---------------------------------------------------------- */

  match =
    q.match(
      /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros cuadrados)/
    );


  if (match) {

    criteria.area_min =
      Number(
        match[1]
          .replace(
            ",",
            "."
          )
      );
  }


  return criteria;
}


/* ============================================================
   BUILD PROPERTY SEARCH
   ============================================================ */

function buildPropertySearch(
  criteria,
  originalQuery = "",
  limit = MAX_AI_PROPERTIES
) {

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
      description,
      photos,
      status,
      created_at
    FROM properties
    WHERE status = 'available'
  `;


  const bindings = [];


  /* ----------------------------------------------------------
     TYPE
  ---------------------------------------------------------- */

  if (
    criteria.property_type
  ) {

    sql += `
      AND LOWER(
        COALESCE(property_type,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${
        criteria.property_type
      }%`
    );
  }


  /* ----------------------------------------------------------
     PROVINCE
  ---------------------------------------------------------- */

  if (
    criteria.province
  ) {

    sql += `
      AND LOWER(
        COALESCE(province,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${
        criteria.province
      }%`
    );
  }


  /* ----------------------------------------------------------
     CITY
  ---------------------------------------------------------- */

  if (
    criteria.city
  ) {

    sql += `
      AND LOWER(
        COALESCE(city,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${
        criteria.city
      }%`
    );
  }


  /* ----------------------------------------------------------
     NEIGHBORHOOD
  ---------------------------------------------------------- */

  if (
    criteria.neighborhood
  ) {

    sql += `
      AND LOWER(
        COALESCE(neighborhood,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${
        criteria.neighborhood
      }%`
    );
  }


  /* ----------------------------------------------------------
     BEDROOMS
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.bedrooms_min
    )
  ) {

    sql += `
      AND COALESCE(
        bedrooms,
        0
      ) >= ?
    `;

    bindings.push(
      criteria.bedrooms_min
    );
  }


  /* ----------------------------------------------------------
     BATHROOMS
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.bathrooms_min
    )
  ) {

    sql += `
      AND COALESCE(
        bathrooms,
        0
      ) >= ?
    `;

    bindings.push(
      criteria.bathrooms_min
    );
  }


  /* ----------------------------------------------------------
     PRICE MAX
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.price_max
    )
  ) {

    sql += `
      AND CAST(
        price AS REAL
      ) <= ?
    `;

    bindings.push(
      criteria.price_max
    );
  }


  /* ----------------------------------------------------------
     PRICE MIN
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.price_min
    )
  ) {

    sql += `
      AND CAST(
        price AS REAL
      ) >= ?
    `;

    bindings.push(
      criteria.price_min
    );
  }


  /* ----------------------------------------------------------
     AREA MIN
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.area_min
    )
  ) {

    sql += `
      AND COALESCE(
        square_meters,
        0
      ) >= ?
    `;

    bindings.push(
      criteria.area_min
    );
  }


  /* ----------------------------------------------------------
     TEXTO LIBRE
     
     Solo lo usamos cuando no hay criterios
     estructurados suficientes.
  ---------------------------------------------------------- */

  const normalizedQuery =
    normalize(
      originalQuery
    );


  const hasStructuredCriteria =
    !!(
      criteria.property_type ||
      criteria.province ||
      criteria.city ||
      criteria.neighborhood ||
      Number.isFinite(
        criteria.bedrooms_min
      ) ||
      Number.isFinite(
        criteria.bathrooms_min
      ) ||
      Number.isFinite(
        criteria.price_max
      ) ||
      Number.isFinite(
        criteria.price_min
      ) ||
      Number.isFinite(
        criteria.area_min
      )
    );


  /*
   * Para consultas como:
   *
   * "miramar casa"
   *
   * los criterios anteriores ya son suficientes.
   *
   * Para consultas puramente textuales:
   *
   * "casa con piscina"
   *
   * buscamos también en título y descripción.
   */

  if (
    normalizedQuery &&
    !hasStructuredCriteria
  ) {

    const words =
      normalizedQuery
        .split(/\s+/)
        .filter(
          word =>
            word.length >= 3
        )
        .slice(
          0,
          5
        );


    if (words.length) {

      const textConditions =
        words.map(
          () => `
            (
              LOWER(
                COALESCE(title,'')
              ) LIKE ?
              OR LOWER(
                COALESCE(description,'')
              ) LIKE ?
              OR LOWER(
                COALESCE(property_type,'')
              ) LIKE ?
              OR LOWER(
                COALESCE(city,'')
              ) LIKE ?
              OR LOWER(
                COALESCE(neighborhood,'')
              ) LIKE ?
            )
          `
        );


      sql += `
        AND (
          ${textConditions.join(
            " OR "
          )}
        )
      `;


      for (
        const word of words
      ) {

        const pattern =
          `%${word}%`;

        bindings.push(
          pattern,
          pattern,
          pattern,
          pattern,
          pattern
        );
      }
    }
  }


  /* ----------------------------------------------------------
     ORDER
  ---------------------------------------------------------- */

  if (
    Number.isFinite(
      criteria.price_max
    )
  ) {

    sql += `
      ORDER BY
        CAST(price AS REAL) ASC,
        created_at DESC
      LIMIT ?
    `;

  } else {

    sql += `
      ORDER BY
        created_at DESC
      LIMIT ?
    `;
  }


  bindings.push(
    clamp(
      Number(limit),
      1,
      MAX_PROPERTIES
    )
  );


  return {
    sql,
    bindings
  };
}


/* ============================================================
   GEOCODE — PUBLIC ADMIN ENDPOINT
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


    if (
      !result?.found
    ) {

      return json(
        {
          ok: false,
          found: false,
          error:
            "No encontramos coordenadas para esta dirección."
        },
        404,
        request
      );
    }


    return json(
      result,
      200,
      request
    );

  } catch (error) {

    console.error(
      "NEXO GEOCODE:",
      error
    );


    return json(
      {
        ok: false,
        error:
          error?.message ||
          "No se pudo geocodificar la propiedad."
      },
      502,
      request
    );
  }
}


/* ============================================================
   GEOCODE — INTERNAL
   ============================================================ */

async function geocodePropertyInternal(
  env,
  id
) {

  const property =
    await env.DB
      .prepare(`
        SELECT
          id,
          province,
          city,
          neighborhood,
          address,
          latitude,
          longitude
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


  const address =
    [
      property.address,
      property.neighborhood,
      property.city,
      property.province,
      "Cuba"
    ]
      .filter(
        Boolean
      )
      .join(", ");


  if (!address) {

    throw new Error(
      "La propiedad no tiene una ubicación suficiente."
    );
  }


  const encoded =
    encodeURIComponent(
      address
    );


  const response =
    await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cu&q=${encoded}`,
      {
        headers: {
          "User-Agent":
            "NEXO-Inmueble/2.0"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      "El servicio de geocodificación no respondió correctamente."
    );
  }


  const results =
    await response.json();


  if (
    !Array.isArray(results) ||
    !results.length
  ) {

    return {
      ok: true,
      found: false
    };
  }


  const latitude =
    Number(
      results[0].lat
    );


  const longitude =
    Number(
      results[0].lon
    );


  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {

    return {
      ok: true,
      found: false
    };
  }


  /*
   * Protección adicional:
   * NEXO solo acepta coordenadas
   * razonables para Cuba.
   */

  if (
    latitude < 19 ||
    latitude > 24.5 ||
    longitude < -86 ||
    longitude > -73
  ) {

    console.warn(
      "NEXO rejected out-of-Cuba coordinates:",
      latitude,
      longitude
    );


    return {
      ok: true,
      found: false
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
    ok: true,
    found: true,
    latitude,
    longitude,
    display_name:
      results[0]
        .display_name ||
      address
  };
}


/* ============================================================
   ADMIN LOGIN
   ============================================================ */

async function adminLogin(
  request,
  env
) {

  const body =
    await readJSON(
      request
    );


  const password =
    String(
      body?.password ||
      ""
    );


  const expected =
    String(
      env.ADMIN_PASSWORD ||
      ""
    );


  if (
    !expected ||
    !password ||
    password !== expected
  ) {

    return json(
      {
        ok: false,
        authenticated:
          false,
        error:
          "Credenciales incorrectas."
      },
      401,
      request
    );
  }


  const session =
    crypto.randomUUID();


  const signedToken =
    await createSignedSession(
      session,
      env
    );


  const response =
    json(
      {
        ok: true,
        authenticated:
          true
      },
      200,
      request
    );


  /*
   * Añadimos cookie de sesión
   * a la respuesta existente.
   */

  response.headers.set(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${signedToken}`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=86400"
    ].join("; ")
  );


  return response;
}


/* ============================================================
   ADMIN LOGOUT
   ============================================================ */

async function adminLogout(
  request
) {

  const response =
    json(
      {
        ok: true,
        authenticated:
          false
      },
      200,
      request
    );


  response.headers.set(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=0"
    ].join("; ")
  );


  return response;
}


/* ============================================================
   ADMIN SESSION
   ============================================================ */

async function adminSession(
  request,
  env
) {

  const authenticated =
    await hasAdminSession(
      request,
      env
    );


  return json(
    {
      ok: true,
      authenticated
    },
    200,
    request
  );
}


/* ============================================================
   REQUIRE ADMIN
   ============================================================ */

async function requireAdmin(
  request,
  env
) {

  return hasAdminSession(
    request,
    env
  );
}


async function hasAdminSession(
  request,
  env
) {

  if (
    !env.ADMIN_PASSWORD
  ) {

    return false;
  }


  const cookie =
    request.headers.get(
      "Cookie"
    ) || "";


  const match =
    cookie.match(
      new RegExp(
        `${SESSION_COOKIE}=([^;]+)`
      )
    );


  if (!match) {

    return false;
  }


  const token =
    match[1];


  return verifySignedSession(
    token,
    env
  );
}


/* ============================================================
   SIGNED SESSION
   ============================================================ */

async function createSignedSession(
  session,
  env
) {

  const secret =
    String(
      env.ADMIN_PASSWORD ||
      ""
    );


  const signature =
    await hmac(
      session,
      secret
    );


  return (
    base64UrlEncode(
      session
    ) +
    "." +
    signature
  );
}


async function verifySignedSession(
  token,
  env
) {

  try {

    const parts =
      token.split(".");


    if (
      parts.length !== 2
    ) {

      return false;
    }


    const session =
      base64UrlDecode(
        parts[0]
      );


    if (!session) {

      return false;
    }


    const expected =
      await hmac(
        session,
        String(
          env.ADMIN_PASSWORD ||
          ""
        )
      );


    /*
     * Comparación constante.
     */

    return safeEqual(
      parts[1],
      expected
    );

  } catch (_) {

    return false;
  }
}


/* ============================================================
   HMAC
   ============================================================ */

async function hmac(
  value,
  secret
) {

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
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
      new TextEncoder().encode(
        value
      )
    );


  return [
    ...new Uint8Array(
      signature
    )
  ]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


/* ============================================================
   BASE64 URL SAFE
   ============================================================ */

function base64UrlEncode(
  value
) {

  const bytes =
    new TextEncoder().encode(
      value
    );


  let binary =
    "";


  for (
    const byte of bytes
  ) {

    binary +=
      String.fromCharCode(
        byte
      );
  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/,
      ""
    );
}


function base64UrlDecode(
  value
) {

  try {

    let base64 =
      value
        .replace(
          /-/g,
          "+"
        )
        .replace(
          /_/g,
          "/"
        );


    while (
      base64.length % 4
    ) {

      base64 += "=";
    }


    const binary =
      atob(
        base64
      );


    const bytes =
      Uint8Array.from(
        binary,
        char =>
          char.charCodeAt(0)
      );


    return new TextDecoder()
      .decode(
        bytes
      );

  } catch (_) {

    return "";
  }
}


/* ============================================================
   SAFE EQUAL
   ============================================================ */

function safeEqual(
  a,
  b
) {

  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length
  ) {

    return false;
  }


  let result =
    0;


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
   NORMALIZE PROPERTY
   ============================================================ */

function normalizeProperty(
  p
) {

  if (!p) {
    return null;
  }


  return {

    id:
      p.id,

    property_type:
      p.property_type ||
      "Propiedad",

    title:
      p.title ||
      p.property_type ||
      "Propiedad",

    province:
      p.province ||
      "",

    city:
      p.city ||
      "",

    neighborhood:
      p.neighborhood ||
      "",

    /*
     * IMPORTANTE:
     *
     * address NO se devuelve.
     *
     * owner_name NO se devuelve.
     * owner_phone NO se devuelve.
     * contact_email NO se devuelve.
     * notes NO se devuelve.
     */

    latitude:
      numberOrNull(
        p.latitude
      ),

    longitude:
      numberOrNull(
        p.longitude
      ),

    bedrooms:
      numberOrNull(
        p.bedrooms
      ),

    bathrooms:
      numberOrNull(
        p.bathrooms
      ),

    square_meters:
      numberOrNull(
        p.square_meters
      ),

    price:
      numberOrNull(
        p.price
      ),

    description:
      p.description ||
      "",

    photos:
      parsePhotos(
        p.photos
      ),

    status:
      p.status ||
      "available",

    created_at:
      p.created_at ||
      null
  };
}


/* ============================================================
   PROPERTY INPUT
   ============================================================ */

function propertyInput(
  body
) {

  return {

    property_type:
      clean(
        body.property_type ||
        body.type
      ),

    title:
      clean(
        body.title ||
        body.name
      ),

    province:
      clean(
        body.province
      ),

    city:
      clean(
        body.city
      ),

    neighborhood:
      clean(
        body.neighborhood
      ),

    address:
      clean(
        body.address
      ),

    latitude:
      numberOrNull(
        body.latitude
      ),

    longitude:
      numberOrNull(
        body.longitude
      ),

    bedrooms:
      numberOrNull(
        body.bedrooms
      ),

    bathrooms:
      numberOrNull(
        body.bathrooms
      ),

    square_meters:
      numberOrNull(
        body.square_meters
      ),

    price:
      numberOrNull(
        body.price
      ),

    description:
      clean(
        body.description
      ),

    photos:
      normalizePhotos(
        body.photos
      ),

    owner_name:
      clean(
        body.owner_name ||
        body.contact_name
      ),

    owner_phone:
      clean(
        body.owner_phone ||
        body.contact_phone
      ),

    contact_email:
      clean(
        body.contact_email ||
        body.email
      ),

    notes:
      clean(
        body.notes
      ),

    status:
      clean(
        body.status
      ) ||
      "available"
  };
}


/* ============================================================
   PHOTOS
   ============================================================ */

function normalizePhotos(
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
              item
            ).trim()
        )
        .filter(
          Boolean
        )
    );
  }


  if (
    typeof value ===
    "string"
  ) {

    const text =
      value.trim();


    if (!text) {

      return "[]";
    }


    try {

      const parsed =
        JSON.parse(
          text
        );


      if (
        Array.isArray(
          parsed
        )
      ) {

        return JSON.stringify(
          parsed
            .map(
              item =>
                String(
                  item
                ).trim()
            )
            .filter(
              Boolean
            )
        );
      }

    } catch (_) {}


    return JSON.stringify(
      text
        .split(
          /[\n,|]+/
        )
        .map(
          item =>
            item.trim()
        )
        .filter(
          Boolean
        )
    );
  }


  return "[]";
}


/* ============================================================
   PARSE PHOTOS
   ============================================================ */

function parsePhotos(
  value
) {

  if (
    Array.isArray(
      value
    )
  ) {

    return value
      .map(
        item =>
          String(
            item
          ).trim()
      )
      .filter(
        Boolean
      );
  }


  if (
    typeof value !==
    "string"
  ) {

    return [];
  }


  const text =
    value.trim();


  if (!text) {

    return [];
  }


  try {

    const parsed =
      JSON.parse(
        text
      );


    if (
      Array.isArray(
        parsed
      )
    ) {

      return parsed
        .map(
          item =>
            String(
              item
            ).trim()
        )
        .filter(
          Boolean
        );
    }

  } catch (_) {}


  return text
    .split(
      /[\n,|]+/
    )
    .map(
      item =>
        item.trim()
    )
    .filter(
      Boolean
    );
}


/* ============================================================
   READ JSON
   ============================================================ */

async function readJSON(
  request
) {

  try {

    return await request.json();

  } catch (_) {

    return null;
  }
}


/* ============================================================
   JSON RESPONSE
   ============================================================ */

function json(
  data,
  status = 200,
  request = null
) {

  return corsResponse(
    JSON.stringify(
      data
    ),
    status,
    request
  );
}


/* ============================================================
   CORS
   ============================================================ */

function corsResponse(
  body,
  status,
  request
) {

  const headers =
    new Headers();


  headers.set(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  headers.set(
    "Cache-Control",
    "no-store"
  );


  const origin =
    request?.headers.get(
      "Origin"
    );


  /*
   * Si la petición viene del propio dominio,
   * permitimos credenciales.
   */

  if (origin) {

    headers.set(
      "Access-Control-Allow-Origin",
      origin
    );

    headers.set(
      "Access-Control-Allow-Credentials",
      "true"
    );

  } else {

    headers.set(
      "Access-Control-Allow-Origin",
      "*"
    );
  }


  headers.set(
    "Vary",
    "Origin"
  );


  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );


  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-NEXO-SESSION"
  );


  return new Response(
    body,
    {
      status,
      headers
    }
  );
}


/* ============================================================
   CLEAN
   ============================================================ */

function clean(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;
  }


  return String(
    value
  )
    .trim()
    .slice(
      0,
      10000
    );
}


/* ============================================================
   NUMBER
   ============================================================ */

function numberOrNull(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;
  }


  let text =
    String(
      value
    )
      .trim()
      .replace(
        /[$\s]/g,
        ""
      );


  /*
   * Manejo de formatos:
   *
   * 150000
   * 150,000
   * 150.000
   * 150000.50
   */

  if (
    text.includes(",") &&
    text.includes(".")
  ) {

    /*
     * 150,000.50
     */

    if (
      text.lastIndexOf(".") >
      text.lastIndexOf(",")
    ) {

      text =
        text.replace(
          /,/g,
          ""
        );

    } else {

      /*
       * 150.000,50
       */

      text =
        text
          .replace(
            /\./g,
            ""
          )
          .replace(
            ",",
            "."
          );
    }

  } else if (
    text.includes(",")
  ) {

    const parts =
      text.split(",");


    /*
     * 10,50 -> decimal
     * 150,000 -> miles
     */

    if (
      parts[1]?.length === 2
    ) {

      text =
        text.replace(
          ",",
          "."
        );

    } else {

      text =
        text.replace(
          /,/g,
          ""
        );
    }

  } else if (
    text.includes(".")
  ) {

    const parts =
      text.split(".");


    /*
     * 150.000 -> miles
     * 150.50 -> decimal
     */

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {

      text =
        text.replace(
          ".",
          ""
        );
    }
  }


  const number =
    Number(
      text
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


/* ============================================================
   CLAMP
   ============================================================ */

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
      value
    )
  );
}


/* ============================================================
   NORMALIZE TEXT
   ============================================================ */

function normalize(
  value
) {

  return String(
    value || ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}


/* ============================================================
   PARSE PRICE
   ============================================================ */

function parsePrice(
  number,
  unit
) {

  let value =
    Number(
      String(
        number
      )
        .replace(
          /\./g,
          ""
        )
        .replace(
          ",",
          "."
        )
    );


  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;
  }


  const u =
    normalize(
      unit
    );


  if (
    u === "k" ||
    u === "mil"
  ) {

    value *=
      1000;
  }


  if (
    u === "m"
  ) {

    value *=
      1000000;
  }


  return value;
}


/* ============================================================
   MONEY
   ============================================================ */

function formatMoney(
  value
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {

    return "Precio no disponible";
  }


  return "$" +
    Number(
      value
    ).toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          0
      }
    );
}


/* ============================================================
   TRUNCATE
   ============================================================ */

function truncate(
  value,
  length
) {

  const text =
    String(
      value || ""
    );


  if (
    text.length <= length
  ) {

    return text;
  }


  return (
    text.slice(
      0,
      length - 1
    ) +
    "…"
  );
}