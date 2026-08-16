export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

    // ==========================================
    // AUTENTICACIÓN DE ADMINISTRADOR
    // ==========================================

    const COOKIE_NAME = "nexo_admin_session";

    async function createSignature(value) {
      const encoder = new TextEncoder();

      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(env.ADMIN_PASSWORD),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(value)
      );

      return Array.from(new Uint8Array(signature))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    async function createSession() {
      const timestamp = Date.now().toString();
      const signature = await createSignature(timestamp);

      return `${timestamp}.${signature}`;
    }

    async function verifySession(request) {
      const cookieHeader = request.headers.get("Cookie") || "";

      const cookies = Object.fromEntries(
        cookieHeader
          .split(";")
          .map(cookie => cookie.trim())
          .filter(Boolean)
          .map(cookie => {
            const index = cookie.indexOf("=");

            if (index === -1) {
              return [cookie, ""];
            }

            return [
              cookie.slice(0, index),
              cookie.slice(index + 1)
            ];
          })
      );

      const session = cookies[COOKIE_NAME];

      if (!session) {
        return false;
      }

      const parts = session.split(".");

      if (parts.length !== 2) {
        return false;
      }

      const timestamp = parts[0];
      const providedSignature = parts[1];

      const timestampNumber = Number(timestamp);

      if (!Number.isFinite(timestampNumber)) {
        return false;
      }

      // Sesión válida durante 7 días
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      if (Date.now() - timestampNumber > sevenDays) {
        return false;
      }

      const expectedSignature =
        await createSignature(timestamp);

      return providedSignature === expectedSignature;
    }

    // ==========================================
    // LOGIN ADMINISTRADOR
    // ==========================================

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

        if (!env.ADMIN_PASSWORD) {
          return json({
            success: false,
            error: "ADMIN_PASSWORD no está configurado en Cloudflare."
          }, 500);
        }

        if (!password) {
          return json({
            success: false,
            error: "Introduce la contraseña."
          }, 400);
        }

        if (password !== env.ADMIN_PASSWORD) {
          return json({
            success: false,
            error: "Contraseña incorrecta."
          }, 401);
        }

        const session = await createSession();

        return json(
          {
            success: true,
            message: "Acceso autorizado."
          },
          200,
          {
            "Set-Cookie":
              `${COOKIE_NAME}=${session}; ` +
              "Path=/; " +
              "HttpOnly; " +
              "Secure; " +
              "SameSite=Strict; " +
              "Max-Age=604800"
          }
        );

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error: "No se pudo iniciar sesión."
        }, 500);
      }
    }

    // ==========================================
    // COMPROBAR SESIÓN
    // ==========================================

    if (
      url.pathname === "/api/admin/session" &&
      request.method === "GET"
    ) {
      const authenticated =
        await verifySession(request);

      return json({
        success: true,
        authenticated
      });
    }

    // ==========================================
    // CERRAR SESIÓN
    // ==========================================

    if (
      url.pathname === "/api/admin/logout" &&
      request.method === "POST"
    ) {
      return json(
        {
          success: true,
          message: "Sesión cerrada."
        },
        200,
        {
          "Set-Cookie":
            `${COOKIE_NAME}=; ` +
            "Path=/; " +
            "HttpOnly; " +
            "Secure; " +
            "SameSite=Strict; " +
            "Max-Age=0"
        }
      );
    }

    // ==========================================
    // VERIFICAR ADMIN PARA OPERACIONES PRIVADAS
    // ==========================================

    const privateMethod =
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "DELETE";

    const isPropertyApi =
      url.pathname === "/api/properties" ||
      url.pathname.startsWith("/api/properties/");

    if (privateMethod && isPropertyApi) {
      const authenticated =
        await verifySession(request);

      if (!authenticated) {
        return json({
          success: false,
          error: "No autorizado. Inicia sesión como administrador."
        }, 401);
      }
    }

    // ==========================================
    // API: OBTENER TODAS LAS PROPIEDADES
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
        console.error(error);

        return json({
          success: false,
          error: "No se pudieron obtener las propiedades."
        }, 500);
      }
    }

    // ==========================================
    // API: CREAR PROPIEDAD
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

        if (!propertyType || !city) {
          return json({
            success: false,
            error:
              "El tipo de propiedad y la ciudad son obligatorios."
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
        console.error(error);

        return json({
          success: false,
          error: "No se pudo crear la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // API: EDITAR PROPIEDAD
    // ==========================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "PUT"
    ) {
      const id =
        url.pathname.split("/").pop();

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
            error:
              "El tipo de propiedad y la ciudad son obligatorios."
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
          message:
            "Propiedad actualizada correctamente.",
          changes:
            result.meta?.changes || 0
        });

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error:
            "No se pudo actualizar la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // API: ELIMINAR PROPIEDAD
    // ==========================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "DELETE"
    ) {
      const id =
        url.pathname.split("/").pop();

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
          message:
            "Propiedad eliminada correctamente."
        });

      } catch (error) {
        console.error(error);

        return json({
          success: false,
          error:
            "No se pudo eliminar la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // API: PROPIEDAD INDIVIDUAL
    // ==========================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "GET"
    ) {
      const id =
        url.pathname.split("/").pop();

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
              owner_name,
              owner_phone,
              notes,
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
          error:
            "Error al consultar la propiedad."
        }, 500);
      }
    }

    // ==========================================
    // FRONTEND
    // ==========================================

    return env.ASSETS.fetch(request);
  }
};