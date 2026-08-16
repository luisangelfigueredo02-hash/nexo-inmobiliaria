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
    // JSON
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
    // ADMIN TOKEN
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

    async function isAdminAuthenticated(request) {

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
    // LOGIN PAGE
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

  border: 1px solid #e7e7e7;
  border-radius: 24px;

  padding: 32px;

  box-shadow:
    0 20px 60px rgba(0,0,0,.08);
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

  border: 1px solid #ddd;
  border-radius: 12px;

  font-size: 16px;

  outline: none;
}

input:focus {

  border-color: #171717;
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

  cursor: pointer;
}

button:disabled {

  opacity: .6;

  cursor: not-allowed;
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
  document.getElementById(
    "loginForm"
  );

const password =
  document.getElementById(
    "password"
  );

const button =
  document.getElementById(
    "loginButton"
  );

const error =
  document.getElementById(
    "error"
  );

form.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    error.classList.remove(
      "show"
    );

    error.textContent = "";

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

      error.classList.add(
        "show"
      );

      password.value = "";

      password.focus();

    } finally {

      button.disabled = false;

      button.textContent =
        "Entrar";
    }

  });

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

          return json({
            success: false,
            error:
              "La contraseña de administrador no está configurada."
          }, 500);
        }

        if (
          password !== env.ADMIN
        ) {

          return json({
            success: false,
            error:
              "Contraseña incorrecta."
          }, 401);
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

        return json({
          success: false,
          error:
            "Solicitud de inicio de sesión inválida."
        }, 400);
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

    const isPropertyApi =
      url.pathname ===
        "/api/properties" ||
      url.pathname.startsWith(
        "/api/properties/"
      );

    if (
      isWriteOperation &&
      isPropertyApi
    ) {

      const authenticated =
        await isAdminAuthenticated(
          request
        );

      if (!authenticated) {

        return json({
          success: false,
          error:
            "No autorizado."
        }, 401);
      }
    }

    // =========================================================
    // GEOCODIFICACIÓN
    // =========================================================

    async function geocodeProperty(
      property
    ) {

      const address =
        typeof property.address ===
        "string"
          ? property.address.trim()
          : "";

      const neighborhood =
        typeof property.neighborhood ===
        "string"
          ? property.neighborhood.trim()
          : "";

      const city =
        typeof property.city ===
        "string"
          ? property.city.trim()
          : "";

      const province =
        typeof property.province ===
        "string"
          ? property.province.trim()
          : "";

      if (
        !address &&
        !neighborhood &&
        !city
      ) {

        return {
          success: false,
          latitude: null,
          longitude: null,
          reason:
            "No hay suficiente información de ubicación."
        };
      }

      /*
       * IMPORTANTE:
       * No enviamos datos privados del propietario.
       */

      const parts = [
        address,
        neighborhood,
        city,
        province,
        "Cuba"
      ].filter(Boolean);

      const query =
        parts.join(", ");

      const searchURL =
        new URL(
          "https://nominatim.openstreetmap.org/search"
        );

      searchURL.searchParams.set(
        "q",
        query
      );

      searchURL.searchParams.set(
        "format",
        "jsonv2"
      );

      searchURL.searchParams.set(
        "limit",
        "1"
      );

      searchURL.searchParams.set(
        "addressdetails",
        "1"
      );

      searchURL.searchParams.set(
        "countrycodes",
        "cu"
      );

      try {

        const response =
          await fetch(
            searchURL.toString(),
            {
              method: "GET",

              headers: {
                "Accept":
                  "application/json",

                "User-Agent":
                  "NEXO-Inmobiliaria/1.0"
              }
            }
          );

        if (!response.ok) {

          console.error(
            "NEXO GEOCODE HTTP:",
            response.status
          );

          return {
            success: false,
            latitude: null,
            longitude: null,
            reason:
              "El servicio de ubicación no respondió correctamente."
          };
        }

        const results =
          await response.json();

        if (
          !Array.isArray(results) ||
          !results.length
        ) {

          return {
            success: false,
            latitude: null,
            longitude: null,
            reason:
              "No se encontró una ubicación suficientemente precisa."
          };
        }

        const result =
          results[0];

        const latitude =
          Number(result.lat);

        const longitude =
          Number(result.lon);

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {

          return {
            success: false,
            latitude: null,
            longitude: null,
            reason:
              "La ubicación encontrada no tiene coordenadas válidas."
          };
        }

        return {
          success: true,
          latitude,
          longitude,
          display_name:
            result.display_name || null
        };

      } catch (error) {

        console.error(
          "NEXO GEOCODE:",
          error
        );

        return {
          success: false,
          latitude: null,
          longitude: null,
          reason:
            "No fue posible consultar el servicio de ubicación."
        };
      }
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

        return json({
          success: false,
          error:
            "No se pudieron obtener las propiedades."
        }, 500);
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

        if (
          !propertyType ||
          !city
        ) {

          return json({
            success: false,
            error:
              "El tipo de propiedad y la ciudad son obligatorios."
          }, 400);
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

        const province =
          typeof body.province ===
          "string"
            ? body.province.trim()
            : "";

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
          typeof body.description ===
          "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.owner_name ===
          "string"
            ? body.owner_name.trim()
            : (
                typeof body.contact_name ===
                "string"
                  ? body.contact_name.trim()
                  : null
              );

        const ownerPhone =
          typeof body.owner_phone ===
          "string"
            ? body.owner_phone.trim()
            : (
                typeof body.contact_phone ===
                "string"
                  ? body.contact_phone.trim()
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

        // -----------------------------------------------------
        // FOTOGRAFÍAS
        // -----------------------------------------------------

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {

          if (
            Array.isArray(
              body.photos
            )
          ) {

            photos =
              JSON.stringify(
                body.photos
              );

          } else if (
            typeof body.photos ===
            "string"
          ) {

            try {

              const parsed =
                JSON.parse(
                  body.photos
                );

              photos =
                Array.isArray(parsed)
                  ? JSON.stringify(parsed)
                  : JSON.stringify(
                      body.photos
                    );

            } catch {

              photos =
                JSON.stringify(
                  body.photos
                    .split(/\n|,/)
                    .map(
                      item =>
                        item.trim()
                    )
                    .filter(Boolean)
                );
            }

          }
        }

        // -----------------------------------------------------
        // GEOCODIFICAR
        // -----------------------------------------------------

        let latitude = null;
        let longitude = null;

        const geo =
          await geocodeProperty({
            address,
            neighborhood,
            city,
            province
          });

        if (geo.success) {

          latitude =
            geo.latitude;

          longitude =
            geo.longitude;
        }

        // -----------------------------------------------------
        // GUARDAR
        // -----------------------------------------------------

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

        return json({
          success: true,

          message:
            "Propiedad creada correctamente.",

          id:
            result.meta?.last_row_id ||
            null,

          location: {
            latitude,
            longitude,

            found:
              geo.success,

            message:
              geo.success
                ? "Ubicación encontrada automáticamente."
                : (
                    geo.reason ||
                    "No se pudo determinar la ubicación."
                  )
          }
        }, 201);

      } catch (error) {

        console.error(
          "NEXO CREATE:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo crear la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // REUBICAR / GEOCODIFICAR PROPIEDAD EXISTENTE
    // =========================================================

    if (
      url.pathname.match(
        /^\\/api\\/properties\\/\\d+\\/geocode$/
      ) &&
      request.method === "POST"
    ) {

      const parts =
        url.pathname.split("/");

      const id =
        parts[3];

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

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
                city,
                neighborhood,
                address,
                latitude,
                longitude
              FROM properties
              WHERE id = ?
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

        const geo =
          await geocodeProperty({
            address:
              property.address,
            neighborhood:
              property.neighborhood,
            city:
              property.city,
            province: ""
          });

        if (!geo.success) {

          return json({
            success: false,

            error:
              geo.reason ||
              "No se encontró la ubicación.",

            latitude: null,
            longitude: null
          }, 422);
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
            Number(id)
          )
          .run();

        return json({
          success: true,

          message:
            "Ubicación actualizada correctamente.",

          property_id:
            Number(id),

          latitude:
            geo.latitude,

          longitude:
            geo.longitude,

          display_name:
            geo.display_name || null
        });

      } catch (error) {

        console.error(
          "NEXO GEOCODE EXISTING:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo actualizar la ubicación."
        }, 500);
      }
    }

    // =========================================================
    // EDITAR PROPIEDAD
    // =========================================================

    if (
      url.pathname.match(
        /^\\/api\\/properties\\/\\d+$/
      ) &&
      request.method === "PUT"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

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
          typeof body.property_type ===
          "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city ===
          "string"
            ? body.city.trim()
            : "";

        if (
          !propertyType ||
          !city
        ) {

          return json({
            success: false,
            error:
              "El tipo de propiedad y la ciudad son obligatorios."
          }, 400);
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

        const province =
          typeof body.province ===
          "string"
            ? body.province.trim()
            : "";

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
          typeof body.description ===
          "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.owner_name ===
          "string"
            ? body.owner_name.trim()
            : (
                typeof body.contact_name ===
                "string"
                  ? body.contact_name.trim()
                  : null
              );

        const ownerPhone =
          typeof body.owner_phone ===
          "string"
            ? body.owner_phone.trim()
            : (
                typeof body.contact_phone ===
                "string"
                  ? body.contact_phone.trim()
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
          body.photos !== undefined &&
          body.photos !== null
        ) {

          if (
            Array.isArray(
              body.photos
            )
          ) {

            photos =
              JSON.stringify(
                body.photos
              );

          } else if (
            typeof body.photos ===
            "string"
          ) {

            try {

              const parsed =
                JSON.parse(
                  body.photos
                );

              photos =
                Array.isArray(parsed)
                  ? JSON.stringify(parsed)
                  : JSON.stringify(
                      body.photos
                    );

            } catch {

              photos =
                JSON.stringify(
                  body.photos
                    .split(/\n|,/)
                    .map(
                      item =>
                        item.trim()
                    )
                    .filter(Boolean)
                );
            }
          }
        }

        // -----------------------------------------------------
        // GEOCODIFICAR NUEVAMENTE
        // -----------------------------------------------------

        let latitude = null;
        let longitude = null;

        const geo =
          await geocodeProperty({
            address,
            neighborhood,
            city,
            province
          });

        if (geo.success) {

          latitude =
            geo.latitude;

          longitude =
            geo.longitude;
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
              Number(id)
            )
            .run();

        if (
          !result.meta?.changes
        ) {

          return json({
            success: false,
            error:
              "Propiedad no encontrada."
          }, 404);
        }

        return json({
          success: true,

          message:
            "Propiedad actualizada correctamente.",

          location: {
            latitude,
            longitude,

            found:
              geo.success,

            message:
              geo.success
                ? "Ubicación actualizada automáticamente."
                : (
                    geo.reason ||
                    "No se pudo determinar la ubicación."
                  )
          }
        });

      } catch (error) {

        console.error(
          "NEXO UPDATE:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo actualizar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // ELIMINAR PROPIEDAD
    // =========================================================

    if (
      url.pathname.match(
        /^\\/api\\/properties\\/\\d+$/
      ) &&
      request.method === "DELETE"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

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
            .bind(
              Number(id)
            )
            .run();

        if (
          !result.meta?.changes
        ) {

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
          "NEXO DELETE:",
          error
        );

        return json({
          success: false,
          error:
            "No se pudo eliminar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // PROPIEDAD INDIVIDUAL
    // =========================================================

    if (
      url.pathname.match(
        /^\\/api\\/properties\\/\\d+$/
      ) &&
      request.method === "GET"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

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
            .bind(
              Number(id)
            )
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
          "NEXO PROPERTY:",
          error
        );

        return json({
          success: false,
          error:
            "Error al consultar la propiedad."
        }, 500);
      }
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    return env.ASSETS.fetch(
      request
    );
  }
};