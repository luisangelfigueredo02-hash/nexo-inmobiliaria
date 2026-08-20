// worker.js - NEXO Master API, SEO & AI Engine
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Configuración global de WhatsApp (Fallback si no está en env)
    const WHATSAPP_PHONE = env.WHATSAPP_PHONE || "+5350000000";

    // 12. CORS y Seguridad de Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper para verificar token de administración (Seguridad Web)
    const isAdmin = (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return false;
      const token = authHeader.replace("Bearer ", "");
      return token === env.ADMIN_TOKEN;
    };

    // Función de normalización de imágenes para evitar inconsistencias históricas
    const normalizeImages = (imagesStr) => {
      if (!imagesStr) return [];
      try {
        const parsed = JSON.parse(imagesStr);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") return [parsed];
        return [];
      } catch (e) {
        if (imagesStr.startsWith("http") || imagesStr.startsWith("/")) {
          return [imagesStr];
        }
        return [];
      }
    };

    // --- ENTRADA DE SEO INTERCEPTOR PARA DETALLES DE PROPIEDAD ---
    if (url.pathname === "/property.html" && method === "GET") {
      const id = url.searchParams.get("id");
      let htmlContent = await env.ASSETS.fetch(request).then(res => res.text()).catch(() => "");
      
      if (!htmlContent) {
        // En caso de que se use sin Pages Assets integrados, se puede retornar la plantilla fallback
        htmlContent = PROPERTY_HTML_TEMPLATE;
      }

      if (id) {
        try {
          const property = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(id).first();
          if (property) {
            const images = normalizeImages(property.images);
            const mainImage = images[0] || "https://nexo.estate/placeholder.jpg";
            
            const seoTags = `
              <title>${property.title} | NEXO Premium</title>
              <meta name="description" content="${property.description ? property.description.substring(0, 155) : 'Propiedad exclusiva en NEXO'}.">
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
          console.error("Error en generación de SEO dinámico:", err);
        }
      }
      return new Response(htmlContent, { headers: { "Content-Type": "text/html" } });
    }

    // --- ENDPOINTS DE LA API ---

    // Configuración global accesible para el cliente
    if (url.pathname === "/api/config" && method === "GET") {
      return new Response(JSON.stringify({ whatsapp_phone: WHATSAPP_PHONE }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Listar propiedades (Público)
    if (url.pathname === "/api/properties" && method === "GET") {
      try {
        const type = url.searchParams.get("type");
        const operation = url.searchParams.get("operation");
        const maxPrice = url.searchParams.get("maxPrice");
        const province = url.searchParams.get("province");
        const bedrooms = url.searchParams.get("bedrooms");

        let query = "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at FROM properties WHERE status = 'published'";
        const params = [];

        if (type) {
          query += " AND type = ?";
          params.push(type);
        }
        if (operation) {
          query += " AND operation = ?";
          params.push(operation);
        }
        if (maxPrice) {
          query += " AND price <= ?";
          params.push(parseFloat(maxPrice));
        }
        if (province) {
          query += " AND province = ?";
          params.push(province);
        }
        if (bedrooms) {
          query += " AND bedrooms >= ?";
          params.push(parseInt(bedrooms));
        }

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

    // Detalle de una propiedad (Público, filtra campos sensibles)
    if (url.pathname.startsWith("/api/properties/") && method === "GET") {
      const id = url.pathname.split("/").pop();
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

        const formatted = {
          ...row,
          images: normalizeImages(row.images)
        };

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

    // --- RUTAS ADMINISTRATIVAS PROTEGIDAS ---

    // Verificar login
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

    // Listado de propiedades administrativo (Completo, incluye privados)
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

    // Crear propiedad (Admin) + Vectorize Sync
    if (url.pathname === "/api/admin/properties" && method === "POST") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      try {
        const data = await request.json();

        // Autogenerar ID secuencial premium
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

        // 10. Actualizar Vectorize Index si está configurado
        if (env.AI && env.VECTORIZE && data.status === "published") {
          try {
            const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habitaciones, ${data.bathrooms} baños. ${data.description}`;
            const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
            const vector = embeddingResponse.data[0];

            await env.VECTORIZE.upsert([{
              id: generatedId,
              values: vector,
              metadata: { title: data.title, price: data.price, location: data.neighborhood }
            }]);
          } catch (vErr) {
            console.error("Vectorize sync failed during creation:", vErr);
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

    // Editar propiedad (Admin) + Vectorize Sync
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

        // Sincronizar actualización en Vectorize
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
              // Si pasa a borrador, se elimina del índice vectorial
              await env.VECTORIZE.deleteByIds([id]);
            }
          } catch (vErr) {
            console.error("Vectorize sync failed during update:", vErr);
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

    // Eliminar propiedad (Admin)
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

    // --- NEXO IA CHATBOT CON VECTORIZE & LLM ---
    if (url.pathname === "/api/chat" && method === "POST") {
      try {
        const { message } = await request.json();
        if (!message) {
          return new Response(JSON.stringify({ error: "Mensaje requerido" }), { status: 400, headers: corsHeaders });
        }

        let matchedProperties = [];

        // Búsqueda semántica híbrida estructurada
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
            console.error("Falla en recuperación de contexto vectorial, usando fallback de texto:", aiErr);
          }
        }

        // Fallback de texto si Vectorize falló o no devolvió resultados
        if (matchedProperties.length === 0) {
          const { results } = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' LIMIT 3"
          ).all();
          matchedProperties = results.map(row => ({
            ...row,
            images: normalizeImages(row.images)
          }));
        }

        // Construir contexto estructurado para el LLM
        const contextString = matchedProperties.map(p => 
          `ID: ${p.id}\nTítulo: ${p.title}\nTipo: ${p.type}\nOperación: ${p.operation}\nPrecio: ${p.price} USD\nUbicación: ${p.neighborhood}, ${p.city}, ${p.province}\nHabitaciones: ${p.bedrooms}, Baños: ${p.bathrooms}, Área: ${p.area} m²\nDescripción: ${p.description}\n---`
        ).join("\n");

        const systemPrompt = `Eres NEXO IA, el asistente virtual premium y sofisticado de NEXO, plataforma inmobiliaria de vanguardia en Cuba. Tu tono de voz debe ser profesional, minimalista, cortés y humilde. 
        Recomienda de forma exclusiva propiedades que formen parte del siguiente listado real. Bajo ninguna circunstancia inventes coordenadas, precios, características ni inmuebles fantasmas.
        Si consideras que ninguna propiedad es perfectamente adecuada para el usuario, acláralo elegantemente e invítalo a ajustar su búsqueda.
        
        Siempre que menciones o recomiendes un inmueble del contexto, escribe de manera explícita su ID entre corchetes, por ejemplo [${matchedProperties[0]?.id || 'N-001'}], para que el sistema pueda vincular la vista correspondiente en el frontend.
        
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

    return new Response("Not Found", { status: 404 });
  }
};

// Plantilla Fallback estática para inyección en tiempo de ejecución local
const PROPERTY_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <!-- SEO_TAGS -->
</head>
<body>
</body>
</html>`;