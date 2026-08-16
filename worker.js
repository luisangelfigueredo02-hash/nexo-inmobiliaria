export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const json = (data, status = 200, extraHeaders = {}) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          ...corsHeaders,
          ...extraHeaders
        }
      });
    };

    // =========================================================
    // AUTENTICACIÓN DE ADMINISTRADOR
    // =========================================================

    const getCookie = (name) => {
      const cookieHeader = request.headers.get("Cookie") || "";

      const cookies = cookieHeader.split(";");

      for (const cookie of cookies) {
        const [key, ...valueParts] = cookie.trim().split("=");

        if (key === name) {
          return valueParts.join("=");
        }
      }

      return null;
    };

    const isAdmin = () => {
      const session = getCookie("NEXO_ADMIN");

      return session === env.ADMIN;
    };

    // =========================================================
    // LOGIN
    // =========================================================

    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const password =
          typeof body.password === "string"
            ? body.password
            : "";

        if (!password) {
          return json({
            success: false,
            error: "Introduce la contraseña."
          }, 400);
        }

        if (!env.ADMIN) {
          return json({
            success: false,
            error: "La variable ADMIN no está configurada en Cloudflare."
          }, 500);
        }

        if (password !== env.ADMIN) {
          return json({
            success: false,
            error: "Contraseña incorrecta."
          }, 401);
        }

        return json(
          {
            success: true,
            authenticated: true
          },
          200,
          {
            "Set-Cookie":
              `NEXO_ADMIN=${encodeURIComponent(env.ADMIN)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
          }
        );

      } catch (error) {
        console.error("NEXO LOGIN:", error);

        return json({
          success: false,
          error: "Solicitud de inicio de sesión inválida."
        }, 400);
      }
    }

    // =========================================================
    // COMPROBAR SESIÓN
    // =========================================================

    if (
      url.pathname === "/api/admin/session" &&
      request.method === "GET"
    ) {
      return json({
        authenticated: isAdmin()
      });
    }

    // =========================================================
    // CERRAR SESIÓN
    // =========================================================

    if (
      url.pathname === "/api/admin/logout" &&
      request.method === "POST"
    ) {
      return json(
        {
          success: true
        },
        200,
        {
          "Set-Cookie":
            "NEXO_ADMIN=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
        }
      );
    }

    // =========================================================
    // API: OBTENER TODAS LAS PROPIEDADES
    // PÚBLICO
    // =========================================================

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
        console.error("NEXO GET PROPERTIES:", error);

        return json({
          success: false,
          error: "No se pudieron obtener las propiedades."
        }, 500);
      }
    }

    // =========================================================
    // CREAR PROPIEDAD
    // SOLO ADMIN
    // =========================================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "POST"
    ) {
      if (!isAdmin()) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

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

        if (!propertyType || !city) {
          return json({
            success: false,
            error: "El tipo de propiedad y la ciudad son obligatorios."
          }, 400);
        }

        const neighborhood =
          typeof body.neighborhood === "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address === "string"
            ? body.address.trim()
            : null;

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

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {
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
        console.error("NEXO CREATE:", error);

        return json({
          success: false,
          error: "No se pudo crear la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // EDITAR PROPIEDAD
    // SOLO ADMIN
    // =========================================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "PUT"
    ) {
      if (!isAdmin()) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

      const id = url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error: "ID de propiedad inválido."
        }, 400);
      }

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

        if (!propertyType || !city) {
          return json({
            success: false,
            error: "El tipo de propiedad y la ciudad son obligatorios."
          }, 400);
        }

        const neighborhood =
          typeof body.neighborhood === "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address === "string"
            ? body.address.trim()
            : null;

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

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {
          photos =
            typeof body.photos === "string"
              ? body.photos
              : JSON.stringify(body.photos);
        }

        const result = await env.DB
          .prepare(`
            UPDATE properties
            SET
              property_type = ?,
              city = ?,
              neighborhood = ?,
              address = ?,
              bedrooms = ?,
              bathrooms = ?,
              square_meters = ?,
              price = ?,
              description = ?,
              photos = ?,
              owner_name = ?,
              owner_phone = ?,
              notes = ?,
              status = ?
            WHERE id = ?
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
            status,
            Number(id)
          )
          .run();

        return json({
          success: true,
          message: "Propiedad actualizada correctamente.",
          changes: result.meta?.changes || 0
        });

      } catch (error) {
        console.error("NEXO UPDATE:", error);

        return json({
          success: false,
          error: "No se pudo actualizar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // ELIMINAR PROPIEDAD
    // SOLO ADMIN
    // =========================================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "DELETE"
    ) {
      if (!isAdmin()) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

      const id = url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error: "ID de propiedad inválido."
        }, 400);
      }

      try {
        const result = await env.DB
          .prepare(`
            DELETE FROM properties
            WHERE id = ?
          `)
          .bind(Number(id))
          .run();

        if (!result.meta?.changes) {
          return json({
            success: false,
            error: "Propiedad no encontrada."
          }, 404);
        }

        return json({
          success: true,
          message: "Propiedad eliminada correctamente."
        });

      } catch (error) {
        console.error("NEXO DELETE:", error);

        return json({
          success: false,
          error: "No se pudo eliminar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // PROPIEDAD INDIVIDUAL
    // PÚBLICO
    // =========================================================

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
              address,
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
        console.error("NEXO PROPERTY:", error);

        return json({
          success: false,
          error: "Error al consultar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    return env.ASSETS.fetch(request);
  }
};