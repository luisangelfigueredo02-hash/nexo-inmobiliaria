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

    const json = (data, status = 200, extra = {}) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          ...corsHeaders,
          ...extra
        }
      });
    };

    // =====================================================
    // SESIÓN DE ADMINISTRADOR
    // =====================================================

    function getCookie(name) {
      const cookies = request.headers.get("Cookie") || "";

      for (const item of cookies.split(";")) {
        const parts = item.trim().split("=");

        if (parts[0] === name) {
          return decodeURIComponent(parts.slice(1).join("="));
        }
      }

      return null;
    }

    async function createSessionToken() {
      const secret = env.ADMIN_SESSION_SECRET;

      if (!secret) {
        throw new Error("ADMIN_SESSION_SECRET no configurado.");
      }

      const encoder = new TextEncoder();

      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const timestamp = Date.now().toString();

      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(timestamp)
      );

      const bytes = new Uint8Array(signature);

      let binary = "";

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      const token =
        btoa(timestamp + "." + binary);

      return token;
    }

    async function verifySessionToken(token) {
      if (!token || !env.ADMIN_SESSION_SECRET) {
        return false;
      }

      try {
        const decoded = atob(token);

        const separator = decoded.indexOf(".");

        if (separator === -1) {
          return false;
        }

        const timestamp =
          decoded.substring(0, separator);

        const binary =
          decoded.substring(separator + 1);

        const time = Number(timestamp);

        if (!Number.isFinite(time)) {
          return false;
        }

        // Sesión válida durante 24 horas
        if (Date.now() - time > 86400000) {
          return false;
        }

        const signatureBytes =
          new Uint8Array(
            [...binary].map(char =>
              char.charCodeAt(0)
            )
          );

        const encoder = new TextEncoder();

        const key =
          await crypto.subtle.importKey(
            "raw",
            encoder.encode(
              env.ADMIN_SESSION_SECRET
            ),
            {
              name: "HMAC",
              hash: "SHA-256"
            },
            false,
            ["verify"]
          );

        return await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBytes,
          encoder.encode(timestamp)
        );

      } catch (error) {
        console.error(
          "SESSION VERIFY:",
          error
        );

        return false;
      }
    }

    async function isAdmin() {
      const token =
        getCookie("NEXO_ADMIN");

      return await verifySessionToken(token);
    }

    // =====================================================
    // LOGIN
    // =====================================================

    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

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
            error:
              "La variable ADMIN no está configurada."
          }, 500);
        }

        if (!env.ADMIN_SESSION_SECRET) {
          return json({
            success: false,
            error:
              "La variable ADMIN_SESSION_SECRET no está configurada."
          }, 500);
        }

        if (password !== env.ADMIN) {
          return json({
            success: false,
            error: "Contraseña incorrecta."
          }, 401);
        }

        const token =
          await createSessionToken();

        return json(
          {
            success: true,
            authenticated: true
          },
          200,
          {
            "Set-Cookie":
              `NEXO_ADMIN=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
          }
        );

      } catch (error) {
        console.error(
          "LOGIN ERROR:",
          error
        );

        return json({
          success: false,
          error:
            "Solicitud de inicio de sesión inválida."
        }, 400);
      }
    }

    // =====================================================
    // COMPROBAR SESIÓN
    // =====================================================

    if (
      url.pathname === "/api/admin/session" &&
      request.method === "GET"
    ) {
      return json({
        authenticated:
          await isAdmin()
      });
    }

    // =====================================================
    // CERRAR SESIÓN
    // =====================================================

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

    // =====================================================
    // OBTENER PROPIEDADES
    // PÚBLICO
    // =====================================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
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
              WHERE status = 'available'
              ORDER BY created_at DESC
            `)
            .all();

        return json({
          success: true,
          properties:
            result.results || []
        });

      } catch (error) {
        console.error(
          "GET PROPERTIES:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudieron obtener las propiedades."
        }, 500);
      }
    }

    // =====================================================
    // CREAR PROPIEDAD
    // SOLO ADMIN
    // =====================================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "POST"
    ) {
      if (!(await isAdmin())) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

      try {
        const body =
          await request.json();

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

        const result =
          await env.DB
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
          message:
            "Propiedad creada correctamente.",
          id:
            result.meta?.last_row_id || null
        }, 201);

      } catch (error) {
        console.error(
          "CREATE PROPERTY:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo crear la propiedad."
        }, 500);
      }
    }

    // =====================================================
    // EDITAR PROPIEDAD
    // SOLO ADMIN
    // =====================================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "PUT"
    ) {
      if (!(await isAdmin())) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

      const id =
        url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error:
            "ID de propiedad inválido."
        }, 400);
      }

      try {
        const body =
          await request.json();

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

        const result =
          await env.DB
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
        console.error(
          "UPDATE PROPERTY:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo actualizar la propiedad."
        }, 500);
      }
    }

    // =====================================================
    // ELIMINAR PROPIEDAD
    // SOLO ADMIN
    // =====================================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "DELETE"
    ) {
      if (!(await isAdmin())) {
        return json({
          success: false,
          error: "No autorizado."
        }, 401);
      }

      const id =
        url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error:
            "ID de propiedad inválido."
        }, 400);
      }

      try {
        const result =
          await env.DB
            .prepare(`
              DELETE FROM properties
              WHERE id = ?
            `)
            .bind(Number(id))
            .run();

        if (!result.meta?.changes) {
          return json({
            success: false,
            error:
              "Propiedad no encontrada."
          }, 404);
        }

        return json({
          success: true,
          message:
            "Propiedad eliminada correctamente."
        });

      } catch (error) {
        console.error(
          "DELETE PROPERTY:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo eliminar la propiedad."
        }, 500);
      }
    }

    // =====================================================
    // PROPIEDAD INDIVIDUAL
    // PÚBLICO
    // =====================================================

    if (
      url.pathname.startsWith("/api/properties/") &&
      request.method === "GET"
    ) {
      const id =
        url.pathname.split("/").pop();

      if (!id || !/^\d+$/.test(id)) {
        return json({
          success: false,
          error:
            "ID de propiedad inválido."
        }, 400);
      }

      try {
        const property =
          await env.DB
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
            error:
              "Propiedad no encontrada."
          }, 404);
        }

        return json({
          success: true,
          property
        });

      } catch (error) {
        console.error(
          "GET PROPERTY:",
          error
        );

        return json({
          success: false,
          error:
            "Error al consultar la propiedad."
        }, 500);
      }
    }

    // =====================================================
    // FRONTEND
    // =====================================================

    return env.ASSETS.fetch(request);
  }
};