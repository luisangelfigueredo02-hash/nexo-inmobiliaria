export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================================================
    // RESPUESTA JSON
    // =========================================================

    function json(data, status = 200, extraHeaders = {}) {

      return new Response(
        JSON.stringify(data),
        {
          status,
          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",
            ...corsHeaders,
            ...extraHeaders
          }
        }
      );
    }

    // =========================================================
    // AUTENTICACIÓN
    // =========================================================

    async function createAdminToken() {

      if (!env.ADMIN) {
        return null;
      }

      const encoder =
        new TextEncoder();

      const keyData =
        encoder.encode(env.ADMIN);

      const messageData =
        encoder.encode(
          "NEXO-ADMIN-SESSION"
        );

      const key =
        await crypto.subtle.importKey(
          "raw",
          keyData,
          {
            name: "HMAC",
            hash: "SHA-256"
          },
          false,
          ["sign"]
        );

      const signature =
        await crypto.subtle.sign(
          "HMAC",
          key,
          messageData
        );

      const bytes =
        new Uint8Array(signature);

      return btoa(
        String.fromCharCode(...bytes)
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }

    async function isAdminAuthenticated(
      request
    ) {

      if (!env.ADMIN) {
        return false;
      }

      const cookieHeader =
        request.headers.get("Cookie") || "";

      const match =
        cookieHeader.match(
          /(?:^|;\s*)nexo_admin=([^;]+)/
        );

      if (!match) {
        return false;
      }

      const expectedToken =
        await createAdminToken();

      return (
        match[1] === expectedToken
      );
    }

    // =========================================================
    // PÁGINA DE LOGIN
    // =========================================================

    const loginPage = `
<!DOCTYPE html>
<html lang="es">
<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>NEXO — Acceso</title>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {

  min-height: 100vh;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 20px;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background: #f5f5f3;
  color: #171717;
}

.login {

  width: 100%;
  max-width: 390px;

  background: #fff;

  border:
    1px solid #e7e7e7;

  border-radius: 24px;

  padding: 32px;

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.08);
}

.logo {

  font-size: 32px;

  font-weight: 800;

  letter-spacing: 5px;

  margin-bottom: 8px;
}

.subtitle {

  color: #777;

  margin-bottom: 30px;

  line-height: 1.5;
}

label {

  display: block;

  font-size: 14px;

  font-weight: 600;

  margin-bottom: 8px;
}

input {

  width: 100%;

  padding: 15px;

  border:
    1px solid #ddd;

  border-radius: 12px;

  font-size: 16px;

  outline: none;
}

button {

  width: 100%;

  margin-top: 16px;

  padding: 15px;

  border: 0;

  border-radius: 12px;

  background: #171717;

  color: white;

  font-size: 16px;

  font-weight: 700;
}

.error {

  margin-top: 15px;

  padding: 12px;

  border-radius: 10px;

  background: #fdeaea;

  color: #9b1c1c;

  display: none;
}

.error.show {
  display: block;
}

</style>

</head>

<body>

<div class="login">

  <div class="logo">
    NEXO
  </div>

  <div class="subtitle">
    Acceso al panel de administración
  </div>

  <form id="loginForm">

    <label for="password">
      Contraseña
    </label>

    <input
      id="password"
      type="password"
      autocomplete="current-password"
      placeholder="Introduce tu contraseña"
      required
    >

    <button
      id="loginButton"
      type="submit"
    >
      Entrar
    </button>

    <div
      id="error"
      class="error"
    ></div>

  </form>

</div>

<script>

const form =
  document.getElementById("loginForm");

const password =
  document.getElementById("password");

const button =
  document.getElementById("loginButton");

const error =
  document.getElementById("error");

form.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    error.classList.remove("show");

    button.disabled = true;

    button.textContent =
      "Comprobando...";

    try {

      const response =
        await fetch(
          "/api/admin/login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            credentials:
              "same-origin",

            body:
              JSON.stringify({
                password:
                  password.value
              })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.error ||
          "Contraseña incorrecta."
        );
      }

      window.location.href =
        "/admin.html";

    } catch (err) {

      error.textContent =
        err.message ||
        "No se pudo iniciar sesión.";

      error.classList.add("show");

      password.value = "";

      password.focus();

    } finally {

      button.disabled = false;

      button.textContent =
        "Entrar";
    }
  }
);

</script>

</body>
</html>
`;

    // =========================================================
    // LOGIN
    // =========================================================

    if (
      url.pathname ===
        "/api/admin/login" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const password =
          typeof body.password ===
          "string"
            ? body.password
            : "";

        if (!env.ADMIN) {

          return json(
            {
              success: false,
              error:
                "La contraseña de administrador no está configurada."
            },
            500
          );
        }

        if (
          password !== env.ADMIN
        ) {

          return json(
            {
              success: false,
              error:
                "Contraseña incorrecta."
            },
            401
          );
        }

        const token =
          await createAdminToken();

        return json(
          {
            success: true
          },
          200,
          {
            "Set-Cookie":
              `nexo_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
          }
        );

      } catch (error) {

        console.error(
          "NEXO LOGIN:",
          error
        );

        return json(
          {
            success: false,
            error:
              "Solicitud de inicio de sesión inválida."
          },
          400
        );
      }
    }

    // =========================================================
    // LOGOUT
    // =========================================================

    if (
      url.pathname ===
        "/api/admin/logout" &&
      request.method === "POST"
    ) {

      return json(
        {
          success: true
        },
        200,
        {
          "Set-Cookie":
            "nexo_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
        }
      );
    }

    // =========================================================
    // PROTEGER ADMIN
    // =========================================================

    if (
      url.pathname === "/admin" ||
      url.pathname === "/admin.html"
    ) {

      const authenticated =
        await isAdminAuthenticated(
          request
        );

      if (!authenticated) {

        return new Response(
          loginPage,
          {
            status: 200,
            headers: {
              "Content-Type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }
    }

    // =========================================================
    // PROTEGER ESCRITURA
    // =========================================================

    const isWriteOperation =
      [
        "POST",
        "PUT",
        "DELETE"
      ].includes(
        request.method
      );

    const isPropertyAPI =
      url.pathname ===
        "/api/properties" ||
      url.pathname.startsWith(
        "/api/properties/"
      );

    if (
      isWriteOperation &&
      isPropertyAPI
    ) {

      const authenticated =
        await isAdminAuthenticated(
          request
        );

      if (!authenticated) {

        return json(
          {
            success: false,
            error:
              "No autorizado."
          },
          401
        );
      }
    }

    // =========================================================
    // GEOCODIFICACIÓN AUTOMÁTICA
    // =========================================================

    async function geocodeAddress({
      city,
      neighborhood,
      address,
      province
    }) {

      const clean = value =>
        typeof value === "string"
          ? value.trim()
          : "";

      city =
        clean(city);

      neighborhood =
        clean(neighborhood);

      address =
        clean(address);

      province =
        clean(province);

      if (!address) {

        return {
          success: false,
          latitude: null,
          longitude: null,
          display_name: null
        };
      }

      /*
       * NEXO intenta varias formas de búsqueda.
       *
       * Esto es importante porque direcciones cubanas
       * pueden aparecer registradas de maneras diferentes.
       */

      const queries = [];

      const fullAddress = [
        address,
        neighborhood,
        city,
        province,
        "Cuba"
      ]
        .filter(Boolean)
        .join(", ");

      queries.push(fullAddress);

      if (neighborhood) {

        queries.push(
          [
            address,
            neighborhood,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      queries.push(
        [
          address,
          city,
          "Cuba"
        ]
          .filter(Boolean)
          .join(", ")
      );

      /*
       * Evitar búsquedas duplicadas.
       */

      const uniqueQueries =
        [...new Set(queries)];

      for (
        const query
        of uniqueQueries
      ) {

        try {

          const endpoint =
            "https://nominatim.openstreetmap.org/search" +
            "?format=jsonv2" +
            "&limit=1" +
            "&countrycodes=cu" +
            "&q=" +
            encodeURIComponent(query);

          const response =
            await fetch(
              endpoint,
              {
                headers: {
                  "User-Agent":
                    "NEXO-Inmueble/1.0",
                  "Accept":
                    "application/json"
                }
              }
            );

          if (!response.ok) {
            continue;
          }

          const results =
            await response.json();

          if (
            !Array.isArray(results) ||
            !results.length
          ) {
            continue;
          }

          const result =
            results[0];

          const latitude =
            Number(result.lat);

          const longitude =
            Number(result.lon);

          if (
            !Number.isFinite(
              latitude
            ) ||
            !Number.isFinite(
              longitude
            )
          ) {
            continue;
          }

          return {
            success: true,
            latitude,
            longitude,
            display_name:
              result.display_name ||
              null
          };

        } catch (error) {

          console.error(
            "NEXO GEOCODE QUERY:",
            error
          );
        }
      }

      return {
        success: false,
        latitude: null,
        longitude: null,
        display_name: null
      };
    }

    // =========================================================
    // OBTENER PROPIEDADES
    // =========================================================

    if (
      url.pathname ===
        "/api/properties" &&
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
          properties:
            result.results || []
        });

      } catch (error) {

        console.error(
          "NEXO GET:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudieron obtener las propiedades."
          },
          500
        );
      }
    }

    // =========================================================
    // CREAR PROPIEDAD
    // =========================================================

    if (
      url.pathname ===
        "/api/properties" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const propertyType =
          typeof body.property_type ===
          "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city ===
          "string"
            ? body.city.trim()
            : "";

        const province =
          typeof body.province ===
          "string"
            ? body.province.trim()
            : "";

        if (
          !propertyType ||
          !city
        ) {

          return json(
            {
              success: false,
              error:
                "El tipo de propiedad y la ciudad son obligatorios."
            },
            400
          );
        }

        const neighborhood =
          typeof body.neighborhood ===
          "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address ===
          "string"
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
            : Number(
                body.square_meters
              );

        const price =
          body.price === "" ||
          body.price === null ||
          body.price === undefined
            ? null
            : Number(body.price);

        const description =
          typeof body.description ===
          "string"
            ? body.description.trim()
            : null;

        /*
         * El panel utiliza contact_name/contact_phone.
         *
         * La base de datos utiliza
         * owner_name/owner_phone.
         */

        const ownerName =
          typeof body.contact_name ===
          "string"
            ? body.contact_name.trim()
            : (
                typeof body.owner_name ===
                "string"
                  ? body.owner_name.trim()
                  : null
              );

        const ownerPhone =
          typeof body.contact_phone ===
          "string"
            ? body.contact_phone.trim()
            : (
                typeof body.owner_phone ===
                "string"
                  ? body.owner_phone.trim()
                  : null
              );

        const notes =
          typeof body.notes ===
          "string"
            ? body.notes.trim()
            : null;

        const status =
          typeof body.status ===
          "string" &&
          body.status.trim()
            ? body.status.trim()
            : "available";

        let photos = "[]";

        if (
          body.photos !==
            undefined &&
          body.photos !== null
        ) {

          photos =
            typeof body.photos ===
            "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
        }

        // =====================================================
        // BUSCAR COORDENADAS AUTOMÁTICAMENTE
        // =====================================================

        const geo =
          await geocodeAddress({
            city,
            neighborhood,
            address,
            province
          });

        const latitude =
          geo.success
            ? geo.latitude
            : null;

        const longitude =
          geo.success
            ? geo.longitude
            : null;

        // =====================================================
        // GUARDAR
        // =====================================================

        const result =
          await env.DB
            .prepare(`
              INSERT INTO properties (
                property_type,
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
                notes,
                status
              )
              VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?
              )
            `)
            .bind(
              propertyType,
              city,
              neighborhood,
              address,
              latitude,
              longitude,
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

        return json(
          {
            success: true,

            message:
              "Propiedad creada correctamente.",

            id:
              result.meta?.last_row_id ||
              null,

            geocoded:
              geo.success,

            latitude,
            longitude,

            location:
              geo.display_name
          },
          201
        );

      } catch (error) {

        console.error(
          "NEXO CREATE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo crear la propiedad.",
            detail:
              error?.message || null
          },
          500
        );
      }
    }

    // =========================================================
    // RE-GEOCODIFICAR UNA PROPIEDAD
    // =========================================================

    const geocodeMatch =
      url.pathname.match(
        /^\/api\/properties\/(\d+)\/geocode$/
      );

    if (
      geocodeMatch &&
      request.method === "POST"
    ) {

      const id =
        Number(
          geocodeMatch[1]
        );

      try {

        const property =
          await env.DB
            .prepare(`
              SELECT
                id,
                city,
                neighborhood,
                address
              FROM properties
              WHERE id = ?
            `)
            .bind(id)
            .first();

        if (!property) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        const geo =
          await geocodeAddress({
            city:
              property.city,
            neighborhood:
              property.neighborhood,
            address:
              property.address,
            province: ""
          });

        if (!geo.success) {

          return json(
            {
              success: false,
              error:
                "No se pudo localizar automáticamente esta dirección.",
              latitude: null,
              longitude: null
            },
            422
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
            geo.latitude,
            geo.longitude,
            id
          )
          .run();

        return json({
          success: true,
          id,
          latitude:
            geo.latitude,
          longitude:
            geo.longitude,
          location:
            geo.display_name
        });

      } catch (error) {

        console.error(
          "NEXO REGEOCODE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo geocodificar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // EDITAR PROPIEDAD
    // =========================================================

    const editMatch =
      url.pathname.match(
        /^\/api\/properties\/(\d+)$/
      );

    if (
      editMatch &&
      request.method === "PUT"
    ) {

      const id =
        Number(
          editMatch[1]
        );

      try {

        const body =
          await request.json();

        const propertyType =
          typeof body.property_type ===
          "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city ===
          "string"
            ? body.city.trim()
            : "";

        const province =
          typeof body.province ===
          "string"
            ? body.province.trim()
            : "";

        if (
          !propertyType ||
          !city
        ) {

          return json(
            {
              success: false,
              error:
                "El tipo de propiedad y la ciudad son obligatorios."
            },
            400
          );
        }

        const neighborhood =
          typeof body.neighborhood ===
          "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address ===
          "string"
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
            : Number(
                body.square_meters
              );

        const price =
          body.price === "" ||
          body.price === null ||
          body.price === undefined
            ? null
            : Number(body.price);

        const description =
          typeof body.description ===
          "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.contact_name ===
          "string"
            ? body.contact_name.trim()
            : (
                typeof body.owner_name ===
                "string"
                  ? body.owner_name.trim()
                  : null
              );

        const ownerPhone =
          typeof body.contact_phone ===
          "string"
            ? body.contact_phone.trim()
            : (
                typeof body.owner_phone ===
                "string"
                  ? body.owner_phone.trim()
                  : null
              );

        const notes =
          typeof body.notes ===
          "string"
            ? body.notes.trim()
            : null;

        const status =
          typeof body.status ===
          "string" &&
          body.status.trim()
            ? body.status.trim()
            : "available";

        let photos = "[]";

        if (
          body.photos !==
            undefined &&
          body.photos !== null
        ) {

          photos =
            typeof body.photos ===
            "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
        }

        // =====================================================
        // VOLVER A BUSCAR COORDENADAS
        // =====================================================

        const geo =
          await geocodeAddress({
            city,
            neighborhood,
            address,
            province
          });

        const latitude =
          geo.success
            ? geo.latitude
            : null;

        const longitude =
          geo.success
            ? geo.longitude
            : null;

        const result =
          await env.DB
            .prepare(`
              UPDATE properties
              SET
                property_type = ?,
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
                notes = ?,
                status = ?
              WHERE id = ?
            `)
            .bind(
              propertyType,
              city,
              neighborhood,
              address,
              latitude,
              longitude,
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
              id
            )
            .run();

        if (!result.meta?.changes) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success: true,
          message:
            "Propiedad actualizada correctamente.",
          geocoded:
            geo.success,
          latitude,
          longitude
        });

      } catch (error) {

        console.error(
          "NEXO UPDATE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo actualizar la propiedad.",
            detail:
              error?.message || null
          },
          500
        );
      }
    }

    // =========================================================
    // ELIMINAR PROPIEDAD
    // =========================================================

    if (
      editMatch &&
      request.method === "DELETE"
    ) {

      const id =
        Number(
          editMatch[1]
        );

      try {

        const result =
          await env.DB
            .prepare(`
              DELETE FROM properties
              WHERE id = ?
            `)
            .bind(id)
            .run();

        if (!result.meta?.changes) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success: true,
          message:
            "Propiedad eliminada correctamente."
        });

      } catch (error) {

        console.error(
          "NEXO DELETE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo eliminar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // PROPIEDAD INDIVIDUAL
    // =========================================================

    if (
      editMatch &&
      request.method === "GET"
    ) {

      const id =
        Number(
          editMatch[1]
        );

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
                notes,
                status,
                created_at
              FROM properties
              WHERE id = ?
                AND status = 'available'
            `)
            .bind(id)
            .first();

        if (!property) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success: true,
          property
        });

      } catch (error) {

        console.error(
          "NEXO PROPERTY:",
          error
        );

        return json(
          {
            success: false,
            error:
              "Error al consultar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // FRONTEND / ASSETS
    // =========================================================

    return env.ASSETS.fetch(
      request
    );
  }
};