export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    // Prueba de funcionamiento del Worker
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        success: true,
        name: "NEXO",
        message: "NEXO API funcionando correctamente."
      });
    }

    // Obtener propiedades públicas
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
        return json({
          success: false,
          error: "No se pudieron obtener las propiedades."
        }, 500);
      }
    }

    // Obtener una propiedad específica
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
        return json({
          success: false,
          error: "Error al consultar la propiedad."
        }, 500);
      }
    }

    return json({
      success: false,
      error: "Ruta no encontrada."
    }, 404);
  }
};