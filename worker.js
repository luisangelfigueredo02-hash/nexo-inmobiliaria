/**
 * ============================================================
 * NEXO 2.0 — CLOUDFLARE WORKER
 * ============================================================
 *
 * Arquitectura:
 *   /api/properties
 *   /api/properties/:id
 *   /api/properties/:id/geocode
 *   /api/search
 *   /api/ia
 *   /api/health
 *   /api/admin/login
 *   /api/admin/logout
 *
 * Bindings esperados:
 *
 *   DB      -> D1 nexo-db
 *   AI      -> Workers AI
 *   ASSETS  -> ./public
 *
 * ============================================================
 */

const AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct";

const SESSION_COOKIE =
  "NEXO_ADMIN_SESSION";

const AI_SESSION_HEADER =
  "X-NEXO-SESSION";

const MAX_AI_PROPERTIES = 12;
const MAX_CONVERSATION = 20;

/* ============================================================
   FETCH
   ============================================================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      /*
       * CORS / OPTIONS
       */
      if (request.method === "OPTIONS") {
        return corsResponse(
          null,
          204,
          request
        );
      }

      /*
       * API
       */
      if (url.pathname.startsWith("/api/")) {
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
        return env.ASSETS.fetch(request);
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
        "NEXO WORKER ERROR",
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

  /*
   * HEALTH
   */

  if (
    path === "/api/health" &&
    request.method === "GET"
  ) {
    return json(
      {
        ok: true,
        service: "NEXO",
        version: "2.0",
        database: !!env.DB,
        ai: !!env.AI,
        timestamp:
          new Date().toISOString()
      },
      200,
      request
    );
  }


  /*
   * PROPIEDADES
   */

  if (
    path === "/api/properties" &&
    request.method === "GET"
  ) {
    return getProperties(
      request,
      env,
      url
    );
  }


  /*
   * CREAR PROPIEDAD
   */

  if (
    path === "/api/properties" &&
    request.method === "POST"
  ) {
    return createProperty(
      request,
      env
    );
  }


  /*
   * BÚSQUEDA INTELIGENTE
   */

  if (
    path === "/api/search" &&
    request.method === "POST"
  ) {
    return intelligentSearch(
      request,
      env
    );
  }


  /*
   * NEXO IA
   */

  if (
    path === "/api/ia" &&
    request.method === "POST"
  ) {
    return nexAI(
      request,
      env
    );
  }


  /*
   * LOGIN ADMIN
   */

  if (
    path === "/api/admin/login" &&
    request.method === "POST"
  ) {
    return adminLogin(
      request,
      env
    );
  }


  /*
   * LOGOUT
   */

  if (
    path === "/api/admin/logout" &&
    request.method === "POST"
  ) {
    return adminLogout(
      request
    );
  }


  /*
   * SESIÓN ADMIN
   */

  if (
    path === "/api/admin/session" &&
    request.method === "GET"
  ) {
    return adminSession(
      request
    );
  }


  /*
   * PROPERTY ID
   */

  const match =
    path.match(
      /^\/api\/properties\/([^/]+)$/
    );

  if (match) {

    const id =
      Number(match[1]);

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


  /*
   * GEOCODIFICACIÓN
   */

  const geoMatch =
    path.match(
      /^\/api\/properties\/([^/]+)\/geocode$/
    );

  if (
    geoMatch &&
    request.method === "POST"
  ) {

    const id =
      Number(geoMatch[1]);

    return geocodeProperty(
      request,
      env,
      id
    );
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
   PROPIEDADES — GET
   ============================================================ */

async function getProperties(
  request,
  env,
  url
) {

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
      200
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

    bindings.push(status);
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
      .map(normalizeProperty);


  return json(
    {
      ok: true,
      properties,
      count:
        properties.length
    },
    200,
    request
  );
}


/* ============================================================
   PROPERTY — GET
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
   * No exponemos datos privados
   * en la API pública.
   */

  return json(
    {
      ok: true,
      property:
        normalizeProperty(result)
    },
    200,
    request
  );
}


/* ============================================================
   CREATE
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
    await readJSON(request);


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
    propertyInput(body);


  if (
    !data.property_type ||
    !data.price
  ) {
    return json(
      {
        ok: false,
        error:
          "Tipo de propiedad y precio son obligatorios."
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


  return json(
    {
      ok: true,
      id:
        result.meta?.last_row_id
    },
    201,
    request
  );
}


/* ============================================================
   UPDATE
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
    await readJSON(request);


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
    propertyInput(body);


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
   DELETE
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


  await env.DB
    .prepare(`
      DELETE FROM properties
      WHERE id = ?
    `)
    .bind(id)
    .run();


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
   BÚSQUEDA INTELIGENTE
   ============================================================ */

async function intelligentSearch(
  request,
  env
) {

  const body =
    await readJSON(request);


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
        properties: []
      },
      200,
      request
    );
  }


  const criteria =
    extractSearchCriteria(
      query
    );


  const {
    sql,
    bindings
  } =
    buildPropertySearch(
      criteria
    );


  const result =
    await env.DB
      .prepare(sql)
      .bind(...bindings)
      .all();


  const properties =
    (result.results || [])
      .map(normalizeProperty);


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
    await readJSON(request);


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


  /*
   * Conversación recibida por app.js.
   */

  let conversation =
    Array.isArray(
      body?.conversation
    )
      ? body.conversation
      : [];


  conversation =
    conversation
      .filter(item =>
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


  /*
   * PRIMER PASO:
   * buscar propiedades según
   * la intención real.
   */

  const criteria =
    extractSearchCriteria(
      message
    );


  const search =
    buildPropertySearch(
      criteria
    );


  const result =
    await env.DB
      .prepare(search.sql)
      .bind(...search.bindings)
      .all();


  const properties =
    (result.results || [])
      .map(normalizeProperty)
      .slice(
        0,
        MAX_AI_PROPERTIES
      );


  /*
   * Creamos un contexto compacto.
   */

  const propertyContext =
    properties.length
      ? properties
          .map((p, index) => {

            return [
              `${index + 1}.`,
              p.title ||
                p.property_type,
              `Precio: ${formatMoney(p.price)}`,
              `Tipo: ${p.property_type}`,
              `Provincia: ${p.province}`,
              `Ciudad: ${p.city}`,
              `Zona: ${p.neighborhood}`,
              `Habitaciones: ${p.bedrooms ?? "N/D"}`,
              `Baños: ${p.bathrooms ?? "N/D"}`,
              `m²: ${p.square_meters ?? "N/D"}`,
              `Descripción: ${truncate(
                p.description,
                350
              )}`
            ].join(" | ");

          })
          .join("\n")
      : "No se encontraron propiedades que coincidan con la búsqueda.";


  /*
   * Prompt principal.
   */

  const system =
    `
Eres NEXO IA, el asistente inmobiliario
de NEXO para Cuba.

Tu trabajo es ayudar al usuario a encontrar,
comparar y entender propiedades.

REGLAS IMPORTANTES:

1. SOLO puedes afirmar datos de propiedades
   que estén presentes en el contexto recibido.

2. NO inventes propiedades, precios,
   direcciones, habitaciones ni características.

3. Si no hay coincidencias, dilo claramente.

4. Si el usuario pide propiedades,
   utiliza las propiedades encontradas
   en la búsqueda.

5. Si el usuario pregunta algo general,
   responde de manera natural sin inventar
   información inmobiliaria.

6. Puedes comparar propiedades utilizando
   exclusivamente los datos disponibles.

7. No muestres nombre privado del propietario,
   teléfono privado, email privado ni notas
   administrativas.

8. Sé breve, elegante y útil.

9. NEXO debe sentirse premium:
   claro, sofisticado y humano.

PROPIEDADES ENCONTRADAS:

${propertyContext}
`;


  const messages = [
    {
      role: "system",
      content: system
    },

    ...conversation,

    {
      role: "user",
      content: message
    }
  ];


  /*
   * Workers AI
   */

  let answer;


  if (env.AI) {

    const aiResult =
      await env.AI.run(
        AI_MODEL,
        {
          messages,

          max_tokens: 700,

          temperature: 0.25
        }
      );


    answer =
      aiResult?.response ||
      aiResult?.result?.response ||
      "";
  }


  /*
   * Si AI falla/no está disponible,
   * usamos una respuesta segura.
   */

  if (!answer) {

    if (properties.length) {

      answer =
        `Encontré ${properties.length} ${
          properties.length === 1
            ? "propiedad"
            : "propiedades"
        } que pueden encajar con tu búsqueda.`;

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
   CRITERIOS DE BÚSQUEDA
   ============================================================ */

function extractSearchCriteria(
  text
) {

  const q =
    normalize(text);


  const criteria = {
    property_type: null,
    province: null,
    city: null,
    neighborhood: null,
    bedrooms_min: null,
    bedrooms_max: null,
    bathrooms_min: null,
    price_max: null,
    price_min: null,
    area_min: null,
    area_max: null
  };


  /*
   * TIPO
   */

  if (
    /\b(casa|casas|vivienda|villa|chalet)\b/
      .test(q)
  ) {
    criteria.property_type =
      "casa";
  }

  else if (
    /\b(apartamento|apartamentos|piso)\b/
      .test(q)
  ) {
    criteria.property_type =
      "apartamento";
  }

  else if (
    /\b(local|locales|comercial)\b/
      .test(q)
  ) {
    criteria.property_type =
      "local";
  }

  else if (
    /\b(terreno|terrenos|solar)\b/
      .test(q)
  ) {
    criteria.property_type =
      "terreno";
  }


  /*
   * PROVINCIAS
   */

  const provinces = [
    "la habana",
    "artemisa",
    "mayabeque",
    "pinar del rio",
    "matanzas",
    "villa clara",
    "cienfuegos",
    "sancti spiritus",
    "ciego de avila",
    "camaguey",
    "las tunas",
    "holguin",
    "granma",
    "santiago de cuba",
    "guantanamo",
    "isla de la juventud"
  ];


  for (
    const province of provinces
  ) {

    if (
      q.includes(province)
    ) {

      criteria.province =
        province;

      break;
    }
  }


  /*
   * ZONAS DE LA HABANA
   */

  const neighborhoods = [
    "playa",
    "vedado",
    "miramar",
    "siboney",
    "kohly",
    "la coronela",
    "habana vieja",
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
      q.includes(zone)
    ) {

      criteria.neighborhood =
        zone;

      if (
        !criteria.province
      ) {
        criteria.province =
          "la habana";
      }

      break;
    }
  }


  /*
   * HABITACIONES
   */

  let match =
    q.match(
      /(\d+)\s*(?:habitaciones|habitacion|dormitorios|dormitorio|cuartos|cuarto)/
    );


  if (match) {

    criteria.bedrooms_min =
      Number(match[1]);

  } else {

    match =
      q.match(
        /(\d+)\s*(?:hab|habs)\b/
      );

    if (match) {

      criteria.bedrooms_min =
        Number(match[1]);
    }
  }


  /*
   * BAÑOS
   */

  match =
    q.match(
      /(\d+)\s*(?:baños|banos|baño|bano)/
    );


  if (match) {

    criteria.bathrooms_min =
      Number(match[1]);
  }


  /*
   * PRECIO MÁXIMO
   */

  match =
    q.match(
      /(?:menos de|hasta|maximo|max|por debajo de|menos)\s*\$?\s*([\d.,]+)\s*(k|mil|m)?/
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


  /*
   * PRECIO MÍNIMO
   */

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


  /*
   * METROS
   */

  match =
    q.match(
      /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros cuadrados)/
    );


  if (match) {

    criteria.area_min =
      Number(
        match[1]
          .replace(",", ".")
      );
  }


  return criteria;
}


/* ============================================================
   BUILD SEARCH
   ============================================================ */

function buildPropertySearch(
  criteria
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


  /*
   * TIPO
   */

  if (
    criteria.property_type
  ) {

    sql += `
      AND LOWER(property_type)
      LIKE ?
    `;

    bindings.push(
      `%${criteria.property_type}%`
    );
  }


  /*
   * PROVINCIA
   */

  if (
    criteria.province
  ) {

    sql += `
      AND LOWER(
        COALESCE(province,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${criteria.province}%`
    );
  }


  /*
   * CIUDAD
   */

  if (
    criteria.city
  ) {

    sql += `
      AND LOWER(
        COALESCE(city,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${criteria.city}%`
    );
  }


  /*
   * ZONA
   */

  if (
    criteria.neighborhood
  ) {

    sql += `
      AND LOWER(
        COALESCE(neighborhood,'')
      ) LIKE ?
    `;

    bindings.push(
      `%${criteria.neighborhood}%`
    );
  }


  /*
   * HABITACIONES
   */

  if (
    Number.isFinite(
      criteria.bedrooms_min
    )
  ) {

    sql += `
      AND COALESCE(
        bedrooms,0
      ) >= ?
    `;

    bindings.push(
      criteria.bedrooms_min
    );
  }


  /*
   * BAÑOS
   */

  if (
    Number.isFinite(
      criteria.bathrooms_min
    )
  ) {

    sql += `
      AND COALESCE(
        bathrooms,0
      ) >= ?
    `;

    bindings.push(
      criteria.bathrooms_min
    );
  }


  /*
   * PRECIO MÁXIMO
   */

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


  /*
   * PRECIO MÍNIMO
   */

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


  /*
   * ÁREA
   */

  if (
    Number.isFinite(
      criteria.area_min
    )
  ) {

    sql += `
      AND COALESCE(
        square_meters,0
      ) >= ?
    `;

    bindings.push(
      criteria.area_min
    );
  }


  /*
   * ORDENAMIENTO
   *
   * Cuando hay precio máximo:
   * las más económicas primero.
   *
   * Si no:
   * propiedades recientes.
   */

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
    MAX_AI_PROPERTIES
  );


  return {
    sql,
    bindings
  };
}


/* ============================================================
   GEOCODIFICACIÓN
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


  const property =
    await env.DB
      .prepare(`
        SELECT
          id,
          province,
          city,
          neighborhood,
          address
        FROM properties
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();


  if (!property) {
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


  const address =
    [
      property.address,
      property.neighborhood,
      property.city,
      property.province,
      "Cuba"
    ]
      .filter(Boolean)
      .join(", ");


  if (!address) {
    return json(
      {
        ok: false,
        error:
          "La propiedad no tiene una ubicación suficiente."
      },
      400,
      request
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


  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          "No se pudo consultar el servicio de geocodificación."
      },
      502,
      request
    );
  }


  const results =
    await response.json();


  if (
    !Array.isArray(results) ||
    !results.length
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


  const latitude =
    Number(
      results[0].lat
    );

  const longitude =
    Number(
      results[0].lon
    );


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return json(
      {
        ok: false,
        found: false
      },
      404,
      request
    );
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


  return json(
    {
      ok: true,
      found: true,
      latitude,
      longitude,
      display_name:
        results[0].display_name ||
        address
    },
    200,
    request
  );
}


/* ============================================================
   ADMIN LOGIN
   ============================================================ */

async function adminLogin(
  request,
  env
) {

  const body =
    await readJSON(request);


  const password =
    String(
      body?.password || ""
    );


  /*
   * Recomendado:
   *
   * wrangler secret put ADMIN_PASSWORD
   */

  const expected =
    env.ADMIN_PASSWORD ||
    "";


  if (
    !expected ||
    password !== expected
  ) {

    return json(
      {
        ok: false,
        error:
          "Credenciales incorrectas."
      },
      401,
      request
    );
  }


  const session =
    crypto.randomUUID();


  const cookie =
    await createSignedSession(
      session,
      env
    );


  return new Response(
    JSON.stringify({
      ok: true,
      authenticated: true
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Set-Cookie":
          `${SESSION_COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
      }
    }
  );
}


/* ============================================================
   ADMIN LOGOUT
   ============================================================ */

async function adminLogout(
  request
) {

  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Set-Cookie":
          `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
      }
    }
  );
}


/* ============================================================
   ADMIN SESSION
   ============================================================ */

async function adminSession(
  request
) {

  const authenticated =
    await hasAdminSession(
      request
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
   ADMIN AUTH
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
   SESSION FIRMA
   ============================================================ */

async function createSignedSession(
  session,
  env
) {

  const secret =
    env.ADMIN_PASSWORD ||
    "NEXO_CHANGE_THIS_SECRET";


  const signature =
    await hmac(
      session,
      secret
    );


  return (
    btoa(session) +
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
      atob(parts[0]);


    const expected =
      await hmac(
        session,
        env.ADMIN_PASSWORD ||
          "NEXO_CHANGE_THIS_SECRET"
      );


    return (
      parts[1] ===
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
      ["sign"]
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
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
          .padStart(2, "0")
    )
    .join("");
}


/* ============================================================
   NORMALIZACIÓN
   ============================================================ */

function normalizeProperty(
  p
) {

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
     * Dirección exacta:
     * deliberadamente NO se expone
     * al frontend público.
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
      normalizePhotos(
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
   INPUT PROPERTY
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
        .map(x =>
          String(x).trim()
        )
        .filter(Boolean)
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
        JSON.parse(text);


      if (
        Array.isArray(parsed)
      ) {

        return JSON.stringify(
          parsed
            .map(x =>
              String(x).trim()
            )
            .filter(Boolean)
        );
      }

    } catch (_) {}


    return JSON.stringify(
      text
        .split(/[\n,|]+/)
        .map(x =>
          x.trim()
        )
        .filter(Boolean)
    );
  }


  return "[]";
}


/* ============================================================
   HELPERS
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


  /*
   * Para NEXO mismo origen.
   */

  const origin =
    request?.headers.get(
      "Origin"
    );


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


function clean(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  return String(value)
    .trim()
    .slice(0, 10000);
}


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


  const number =
    Number(
      String(value)
        .replace(/[$,\s]/g, "")
        .replace(",", ".")
    );


  return Number.isFinite(
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
    !Number.isFinite(value)
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


function normalize(
  value
) {

  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}


function parsePrice(
  number,
  unit
) {

  let value =
    Number(
      String(number)
        .replace(/\./g, "")
        .replace(",", ".")
    );


  if (
    !Number.isFinite(value)
  ) {
    return null;
  }


  const u =
    normalize(unit);


  if (
    u === "k" ||
    u === "mil"
  ) {

    value *= 1000;
  }


  if (
    u === "m"
  ) {

    value *= 1000000;
  }


  return value;
}


function formatMoney(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return "Precio no disponible";
  }


  return "$" +
    Number(value)
      .toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 0
        }
      );
}


function truncate(
  value,
  length
) {

  const text =
    String(value || "");


  if (
    text.length <= length
  ) {
    return text;
  }


  return (
    text.slice(
      0,
      length - 1
    ) + "…"
  );
}