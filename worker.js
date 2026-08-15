export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const json = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          ...corsHeaders
        }
      });
    };

    // ==========================================
    // ESTADO DE LA API
    // ==========================================

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        success: true,
        name: "NEXO",
        message: "API de NEXO funcionando correctamente."
      });
    }

    // ==========================================
    // OBTENER PROPIEDADES PÚBLICAS
    // ==========================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "GET"
    ) {
      try {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              property_type,
              city,
              neighborhood,
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
            ORDER BY created_at DESC
          `)
          .all();

        return json({
          success: true,
          properties: result.results || []
        });

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error: "No se pudieron obtener las propiedades."
        }, 500);
      }
    }

    // ==========================================
    // CREAR PROPIEDAD
    // ==========================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const propertyType =
          typeof body.property_type === "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city === "string"
            ? body.city.trim()
            : "";

        const neighborhood =
          typeof body.neighborhood === "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address === "string"
            ? body.address.trim()
            : null;

        const description =
          typeof body.description === "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.owner_name === "string"
            ? body.owner_name.trim()
            : null;

        const ownerPhone =
          typeof body.owner_phone === "string"
            ? body.owner_phone.trim()
            : null;

        const notes =
          typeof body.notes === "string"
            ? body.notes.trim()
            : null;

        const status =
          typeof body.status === "string" &&
          body.status.trim()
            ? body.status.trim()
            : "available";

        const bedrooms =
          body.bedrooms === "" ||
          body.bedrooms === null ||
          body.bedrooms === undefined
            ? null
            : Number(body.bedrooms);

        const bathrooms =
          body.bathrooms === "" ||
          body.bathrooms === null ||
          body.bathrooms === undefined
            ? null
            : Number(body.bathrooms);

        const squareMeters =
          body.square_meters === "" ||
          body.square_meters === null ||
          body.square_meters === undefined
            ? null
            : Number(body.square_meters);

        const price =
          body.price === "" ||
          body.price === null ||
          body.price === undefined
            ? null
            : Number(body.price);

        if (!propertyType) {
          return json({
            success: false,
            error: "El tipo de propiedad es obligatorio."
          }, 400);
        }

        if (!city) {
          return json({
            success: false,
            error: "La ciudad es obligatoria."
          }, 400);
        }

        if (
          price !== null &&
          (!Number.isFinite(price) || price < 0)
        ) {
          return json({
            success: false,
            error: "El precio no es válido."
          }, 400);
        }

        if (
          bedrooms !== null &&
          (!Number.isFinite(bedrooms) || bedrooms < 0)
        ) {
          return json({
            success: false,
            error: "Las habitaciones no son válidas."
          }, 400);
        }

        if (
          bathrooms !== null &&
          (!Number.isFinite(bathrooms) || bathrooms < 0)
        ) {
          return json({
            success: false,
            error: "Los baños no son válidos."
          }, 400);
        }

        if (
          squareMeters !== null &&
          (!Number.isFinite(squareMeters) || squareMeters < 0)
        ) {
          return json({
            success: false,
            error: "Los metros cuadrados no son válidos."
          }, 400);
        }

        let photos = "[]";

        if (body.photos !== undefined && body.photos !== null) {
          photos =
            typeof body.photos === "string"
              ? body.photos
              : JSON.stringify(body.photos);
        }

        const result = await env.DB
          .prepare(`
            INSERT INTO properties (
              property_type,
              city,
              neighborhood,
              address,
              bedrooms,
              bathrooms,
              square_meters,
              price,
              description,
              photos,
              owner_name,
              owner_phone,
              notes,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            propertyType,
            city,
            neighborhood,
            address,
            bedrooms,
            bathrooms,
            squareMeters,
            price,
            description,
            photos,
            ownerName,
            ownerPhone,
            notes,
            status
          )
          .run();

        return json({
          success: true,
          message: "Propiedad creada correctamente.",
          id: result.meta?.last_row_id || null
        }, 201);

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error: "No se pudo crear la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // OBTENER UNA PROPIEDAD
    // ==========================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error: "ID de propiedad inválido."
        }, 400);
      }

      try {
        const property = await env.DB
          .prepare(`
            SELECT
              id,
              property_type,
              city,
              neighborhood,
              bedrooms,
              bathrooms,
              square_meters,
              price,
              description,
              photos,
              status,
              created_at
            FROM properties
            WHERE id = ?
              AND status = 'available'
          `)
          .bind(Number(id))
          .first();

        if (!property) {
          return json({
            success: false,
            error: "Propiedad no encontrada."
          }, 404);
        }

        return json({
          success: true,
          property
        });

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error: "Error al consultar la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // RUTA NO ENCONTRADA
    // ==========================================

    return json({
      success: false,
      error: "Ruta no encontrada."
    }, 404);
  }
};
