// worker.js - NEXO Master API, SEO & AI Engine

// Cliente Sentry mínimo (sin dependencias) para capturar errores no controlados
function reportError(env, ctx, error, requestUrl) {
  if (!env.SENTRY_DSN) return;
  const dsn = env.SENTRY_DSN;
  const match = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return;
  const [, protocol, key, host, projectId] = match;
  const payload = {
    message: error.message || String(error),
    level: "error",
    platform: "javascript",
    server_name: "nexo-inmueble",
    tags: { url: requestUrl },
    extra: { stack: error.stack },
    timestamp: (Date.now() / 1000),
  };
  ctx.waitUntil(
    fetch(`${protocol}://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {})
  );
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await this.route(request, env, ctx);
    } catch (error) {
      reportError(env, ctx, error, request.url);
      return new Response("Internal Error", { status: 500 });
    }
  },

  async route(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Configuración global de WhatsApp
    const WHATSAPP_PHONE = env.WHATSAPP_PHONE || "+5350000000";

    // Cabeceras de seguridad y CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper de autenticación administrativa
    const isAdmin = (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return false;
      const token = authHeader.replace("Bearer ", "");
      return token === env.ADMIN_TOKEN || token === env.ADMIN_PASSWORD;
    };

    // Normalizador de imágenes para prevenir inconsistencias de formato
    const normalizeImages = (imagesStr) => {
      if (!imagesStr) return [];
      try {
        const parsed = JSON.parse(imagesStr);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") return [parsed];
        return [];
      } catch (e) {
        if (imagesStr.startsWith("http") || imagesStr.startsWith("/")) return [imagesStr];
        return [];
      }
    };

    // --- HEALTH CHECK ---
    if (url.pathname === "/api/health" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // --- SEO INTERCEPTOR PARA DETALLES DE PROPIEDAD ---
    if (url.pathname === "/property.html" && method === "GET") {
      const id = url.searchParams.get("id");
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/property";
      assetUrl.search = "";
      assetUrl.hash = "";
      const assetRes = await env.ASSETS.fetch(new Request(assetUrl)).catch(() => null);
      let htmlContent = assetRes && assetRes.ok ? await assetRes.text() : PROPERTY_HTML_TEMPLATE;

      if (id) {
        try {
          const property = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(id).first();
          if (property) {
            const images = normalizeImages(property.images);
            const mainImage = images[0] || "https://nexo.estate/placeholder.jpg";
            
            const seoTags = `
              <title>${property.title} | NEXO</title>
              <meta name="description" content="${property.description ? property.description.substring(0, 155) : 'Propiedad en Cuba'}.">
              <meta property="og:title" content="${property.title} - NEXO">
              <meta property="og:description" content="${property.description ? property.description.substring(0, 155) : ''}">
              <meta property="og:image" content="${mainImage}">
              <meta property="og:type" content="website">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="${property.title}">
              <meta name="twitter:description" content="${property.description ? property.description.substring(0, 155) : ''}">
              <meta name="twitter:image" content="${mainImage}">
              <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "RealEstateListing",
                "name": "${property.title}",
                "description": "${property.description}",
                "price": "${property.price}",
                "priceCurrency": "USD",
                "address": {
                  "@type": "PostalAddress",
                  "addressLocality": "${property.city}",
                  "addressRegion": "${property.province}"
                }
              }
              </script>
            `;
            htmlContent = htmlContent.replace("<!-- SEO_TAGS -->", seoTags);
          }
        } catch (err) {
          console.error("Error en SEO dinámico:", err);
        }
      }
      return new Response(htmlContent, { headers: { "Content-Type": "text/html" } });
    }

    // --- SERVIR FOTOS DESDE R2 (MEDIA) con negociación de formato ---
    if (url.pathname.startsWith("/media/") && env.BUCKET_IMAGENES && (method === "GET" || method === "HEAD")) {
      let key = decodeURIComponent(url.pathname.slice("/media/".length));
      const accept = request.headers.get("accept") || "";

      // Negociación WebP/AVIF: el bucket guarda variantes *.webp junto al JPG original
      let format = key.match(/\.(jpe?g|png)$/i) && accept.includes("image/webp") ? "webp" : null;
      let object = null;
      if (format) {
        const webpKey = key.replace(/\.(jpe?g|png)$/i, "-w1200.webp");
        object = method === "HEAD" ? await env.BUCKET_IMAGENES.head(webpKey) : await env.BUCKET_IMAGENES.get(webpKey);
        if (!object) format = null; // fallback al original si no hay variante optimizada
      }
      if (!object) {
        object = method === "HEAD" ? await env.BUCKET_IMAGENES.head(key) : await env.BUCKET_IMAGENES.get(key);
      }
      if (!object) return new Response("Not Found", { status: 404, headers: corsHeaders });

      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      if (format) headers.set("Vary", "Accept");
      return new Response(method === "HEAD" ? null : object.body, { headers });
    }

    // --- CONFIGURACIÓN PÚBLICA ---
    if (url.pathname === "/api/config" && method === "GET") {
      return new Response(JSON.stringify({ whatsapp_phone: WHATSAPP_PHONE }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // --- CATÁLOGO PÚBLICO DE PROPIEDADES ---
    if (url.pathname === "/api/properties" && method === "GET") {
      try {
        const type = url.searchParams.get("type");
        const operation = url.searchParams.get("operation");
        const maxPrice = url.searchParams.get("maxPrice");
        const province = url.searchParams.get("province");
        const bedrooms = url.searchParams.get("bedrooms");

        let query = "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at FROM properties WHERE status = 'published'";
        const params = [];

        // Comparación case-insensitive: la BD mezcla valores capitalizados
        // (p.ej. 'Apartamento') y el frontend envía minúsculas ('apartamento')
        if (type) { query += " AND LOWER(type) = LOWER(?)"; params.push(type); }
        if (operation) { query += " AND LOWER(operation) = LOWER(?)"; params.push(operation); }
        if (maxPrice) { query += " AND price <= ?"; params.push(parseFloat(maxPrice)); }
        if (province) { query += " AND province = ?"; params.push(province); }
        if (bedrooms) { query += " AND bedrooms >= ?"; params.push(parseInt(bedrooms)); }

        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();

        const formatted = results.map(row => ({
          ...row,
          images: normalizeImages(row.images)
        }));

        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // --- PROPIEDADES SIMILARES PÚBLICAS (±30% PRECIO) ---
    const similarMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)\/similar$/);
    if (similarMatch && method === "GET") {
      const id = similarMatch[1];
      try {
        const row = await env.DB.prepare("SELECT price, city, province FROM properties WHERE id = ? AND status = 'published'").bind(id).first();
        if (!row) {
          return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const minPrice = row.price * 0.7;
        const maxPrice = row.price * 1.3;

        let { results } = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND city = ? AND price BETWEEN ? AND ? LIMIT 4"
        ).bind(id, row.city, minPrice, maxPrice).all();

        if (results.length === 0) {
          const provRes = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND province = ? AND price BETWEEN ? AND ? LIMIT 4"
          ).bind(id, row.province, minPrice, maxPrice).all();
          results = provRes.results;
        }

        const formatted = results.map(r => ({ ...r, images: normalizeImages(r.images) }));
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // --- DETALLE PÚBLICO DE PROPIEDAD ---
    const detailMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)$/);
    if (detailMatch && method === "GET") {
      const id = detailMatch[1];
      try {
        const row = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude FROM properties WHERE id = ? AND status = 'published'"
        ).bind(id).first();

        if (!row) {
          return new Response(JSON.stringify({ error: "Propiedad no encontrada o inactiva" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const formatted = { ...row, images: normalizeImages(row.images) };
        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // =========================================================================
    // RUTAS ADMINISTRATIVAS PROTEGIDAS (RESTAURADAS AL 100%)
    // =========================================================================

    // 1. Verificar Login
    if (url.pathname === "/api/admin/verify" && method === "POST") {
      if (isAdmin(request)) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ error: "Credenciales inválidas" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 2. Listado Completo Admin (Incluye datos privados)
    if (url.pathname === "/api/admin/properties" && method === "GET") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      try {
        const { results } = await env.DB.prepare("SELECT * FROM properties ORDER BY created_at DESC").all();
        const formatted = results.map(row => ({
          ...row,
          images: normalizeImages(row.images)
        }));
        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 3. Crear Propiedad (Admin) + Vectorize Sync
    if (url.pathname === "/api/admin/properties" && method === "POST") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      try {
        const data = await request.json();

        // Autogenerar ID secuencial premium N-001, N-002...
        const lastRow = await env.DB.prepare("SELECT id FROM properties ORDER BY created_at DESC LIMIT 1").first();
        let nextNum = 1;
        if (lastRow && lastRow.id && lastRow.id.startsWith("N-")) {
          const lastNum = parseInt(lastRow.id.replace("N-", ""), 10);
          if (!isNaN(lastNum)) nextNum = lastNum + 1;
        }
        const generatedId = `N-${String(nextNum).padStart(3, "0")}`;
        const imagesStr = JSON.stringify(data.images || []);

        await env.DB.prepare(`
          INSERT INTO properties (id, title, type, operation, price, province, city, neighborhood, address, bedrooms, bathrooms, area, description, images, latitude, longitude, status, owner_name, owner_phone, internal_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          generatedId, data.title, data.type, data.operation, parseFloat(data.price),
          data.province, data.city, data.neighborhood, data.address || "",
          parseInt(data.bedrooms || 0), parseInt(data.bathrooms || 0), parseFloat(data.area || 0),
          data.description || "", imagesStr, parseFloat(data.latitude || 0), parseFloat(data.longitude || 0),
          data.status || "published", data.owner_name || "", data.owner_phone || "", data.internal_notes || ""
        ).run();

        // Sincronizar con Vectorize si el binding existe
        if (env.AI && env.VECTORIZE && (data.status || "published") === "published") {
          try {
            const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
            const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
            const vector = embeddingResponse.data[0];

            await env.VECTORIZE.upsert([{
              id: generatedId,
              values: vector,
              metadata: { title: data.title, price: data.price, location: data.neighborhood }
            }]);
          } catch (vErr) {
            console.error("Vectorize sync failed on creation:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true, id: generatedId }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 4. Editar Propiedad (Admin) + Vectorize Sync
    if (url.pathname.startsWith("/api/admin/properties/") && method === "PUT") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      const id = url.pathname.split("/").pop();
      try {
        const data = await request.json();
        const imagesStr = JSON.stringify(data.images || []);

        await env.DB.prepare(`
          UPDATE properties SET 
            title = ?, type = ?, operation = ?, price = ?, province = ?, city = ?, neighborhood = ?, address = ?, 
            bedrooms = ?, bathrooms = ?, area = ?, description = ?, images = ?, latitude = ?, longitude = ?, 
            status = ?, owner_name = ?, owner_phone = ?, internal_notes = ?
          WHERE id = ?
        `).bind(
          data.title, data.type, data.operation, parseFloat(data.price), data.province, data.city, data.neighborhood,
          data.address || "", parseInt(data.bedrooms || 0), parseInt(data.bathrooms || 0), parseFloat(data.area || 0),
          data.description || "", imagesStr, parseFloat(data.latitude || 0), parseFloat(data.longitude || 0),
          data.status, data.owner_name || "", data.owner_phone || "", data.internal_notes || "", id
        ).run();

        // Actualizar o remover del índice vectorial según el estado
        if (env.AI && env.VECTORIZE) {
          try {
            if (data.status === "published") {
              const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
              const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
              const vector = embeddingResponse.data[0];

              await env.VECTORIZE.upsert([{
                id: id,
                values: vector,
                metadata: { title: data.title, price: data.price, location: data.neighborhood }
              }]);
            } else {
              await env.VECTORIZE.deleteByIds([id]);
            }
          } catch (vErr) {
            console.error("Vectorize sync failed on update:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 5. Eliminar Propiedad (Admin)
    if (url.pathname.startsWith("/api/admin/properties/") && method === "DELETE") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      const id = url.pathname.split("/").pop();
      try {
        await env.DB.prepare("DELETE FROM properties WHERE id = ?").bind(id).run();

        if (env.VECTORIZE) {
          try {
            await env.VECTORIZE.deleteByIds([id]);
          } catch (vErr) {
            console.error("No se pudo eliminar de Vectorize:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // =========================================================================
    // NEXO IA CHATBOT CON VECTORIZE & LLM
    // =========================================================================
    if (url.pathname === "/api/chat" && method === "POST") {
      try {
        const { message } = await request.json();
        if (!message) {
          return new Response(JSON.stringify({ error: "Mensaje requerido" }), { status: 400, headers: corsHeaders });
        }

        let matchedProperties = [];

        // Búsqueda semántica híbrida con Vectorize
        if (env.AI && env.VECTORIZE) {
          try {
            const queryEmbeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [message] });
            const queryVector = queryEmbeddingResponse.data[0];

            const vecResults = await env.VECTORIZE.query(queryVector, { topK: 4 });
            if (vecResults.matches && vecResults.matches.length > 0) {
              const matchedIds = vecResults.matches.map(match => match.id);
              const placeholders = matchedIds.map(() => "?").join(",");
              
              const { results } = await env.DB.prepare(
                `SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE id IN (${placeholders}) AND status = 'published'`
              ).bind(...matchedIds).all();
              
              matchedProperties = results.map(row => ({
                ...row,
                images: normalizeImages(row.images)
              }));
            }
          } catch (aiErr) {
            console.error("Falla en contexto vectorial, usando fallback de texto:", aiErr);
          }
        }

        // Fallback de texto si Vectorize no devolvió resultados
        if (matchedProperties.length === 0) {
          const { results } = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' LIMIT 3"
          ).all();
          matchedProperties = results.map(row => ({
            ...row,
            images: normalizeImages(row.images)
          }));
        }

        // Contexto estructurado para el LLM
        const contextString = matchedProperties.map(p => 
          `ID: ${p.id}\nTítulo: ${p.title}\nTipo: ${p.type}\nOperación: ${p.operation}\nPrecio: ${p.price} USD\nUbicación: ${p.neighborhood}, ${p.city}, ${p.province}\nHabitaciones: ${p.bedrooms}, Baños: ${p.bathrooms}, Área: ${p.area} m²\nDescripción: ${p.description}\n---`
        ).join("\n");

        const systemPrompt = `Eres NEXO IA, el asesor virtual premium y sofisticado de NEXO en Cuba. Tu tono es profesional, minimalista y educado.
        Recomienda exclusivamente propiedades del siguiente contexto real. Jamás inventes propiedades, ubicaciones o precios.
        Siempre que menciones o recomiendes un inmueble, cita explícitamente su ID entre corchetes, por ejemplo [${matchedProperties[0]?.id || 'N-001'}].
        
        Propiedades disponibles reales:
        ${contextString}`;

        const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        });

        return new Response(JSON.stringify({
          response: aiResponse.response,
          properties: matchedProperties
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // Servir estáticos de Cloudflare Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};

const PROPERTY_HTML_TEMPLATE = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><!-- SEO_TAGS --></head><body></body></html>`;