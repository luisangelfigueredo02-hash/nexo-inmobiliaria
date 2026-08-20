/**
 * NEXO Engine — Cloudflare Worker API & Static Asset Gate
 * Backend sólido con integración nativa a Cloudflare D1
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Verifica las credenciales administrativas de forma segura
function isAuthenticated(request, env) {
  const authHeader = request.headers.get('Authorization');
  const expectedPassword = env.ADMIN_PASSWORD || 'nexo2026';
  const expectedToken = 'Bearer ' + btoa(expectedPassword);
  return authHeader === expectedToken;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Manejo del preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // 1. ENDPOINT: Autenticación Administrativa
      if (path === '/api/admin/login' && request.method === 'POST') {
        const { password } = await request.json();
        const securePassword = env.ADMIN_PASSWORD || 'nexo2026';
        if (password === securePassword) {
          const token = btoa(securePassword);
          return new Response(JSON.stringify({ success: true, token }), {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            status: 200
          });
        }
        return new Response(JSON.stringify({ success: false, error: 'Credencial inválida' }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          status: 401
        });
      }

      // 2. ENDPOINT: Obtener Propiedades (Público - Sanitizado contra fugas de datos P0)
      if (path === '/api/properties' && request.method === 'GET') {
        let sql = `
          SELECT id, title, description, price, currency, location, type, status, 
                 bedrooms, bathrooms, area, images, featured, latitude, longitude, created_at 
          FROM properties 
          WHERE status != 'archived'
        `;
        const params = [];

        // Filtros dinámicos procesados con bindings seguros para evitar inyecciones SQL
        if (url.searchParams.has('type') && url.searchParams.get('type') !== '') {
          sql += ' AND type = ?';
          params.push(url.searchParams.get('type'));
        }
        if (url.searchParams.has('status') && url.searchParams.get('status') !== '') {
          sql += ' AND status = ?';
          params.push(url.searchParams.get('status'));
        }
        if (url.searchParams.has('search') && url.searchParams.get('search') !== '') {
          const searchVal = `%${url.searchParams.get('search')}%`;
          sql += ' AND (title LIKE ? OR description LIKE ? OR location LIKE ?)';
          params.push(searchVal, searchVal, searchVal);
        }

        sql += ' ORDER BY featured DESC, created_at DESC';

        const { results } = await env.DB.prepare(sql).bind(...params).all();

        // Limpieza y parseo estructurado de imágenes en formato JSON Array
        const formattedResults = results.map(row => {
          let parsedImages = [];
          try {
            parsedImages = JSON.parse(row.images || '[]');
          } catch {
            // Manejo de fallbacks si la cadena no es JSON directo (ej. separados por coma)
            if (row.images) {
              parsedImages = row.images.split(',').map(s => s.trim()).filter(Boolean);
            }
          }
          return { ...row, images: parsedImages };
        });

        return new Response(JSON.stringify(formattedResults), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 3. ENDPOINT: Obtener Propiedad Específica (Público)
      const propMatch = path.match(/^\/api\/properties\/(\d+)$/);
      if (propMatch && request.method === 'GET') {
        const id = propMatch[1];
        const row = await env.DB.prepare(`
          SELECT id, title, description, price, currency, location, type, status, 
                 bedrooms, bathrooms, area, images, featured, latitude, longitude, created_at 
          FROM properties 
          WHERE id = ? AND status != 'archived'
        `).bind(id).first();

        if (!row) {
          return new Response(JSON.stringify({ error: 'Propiedad no encontrada' }), {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            status: 404
          });
        }

        let parsedImages = [];
        try {
          parsedImages = JSON.parse(row.images || '[]');
        } catch {
          if (row.images) {
            parsedImages = row.images.split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        row.images = parsedImages;

        return new Response(JSON.stringify(row), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 4. ENDPOINT: Añadir Propiedad (Privado)
      if (path === '/api/admin/properties' && request.method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return new Response('No autorizado', { status: 401, headers: CORS_HEADERS });
        }

        const data = await request.json();
        const imagesStr = JSON.stringify(Array.isArray(data.images) ? data.images : []);

        const result = await env.DB.prepare(`
          INSERT INTO properties (title, description, price, currency, location, type, status, bedrooms, bathrooms, area, images, featured, latitude, longitude, owner_contact, owner_private_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          data.title,
          data.description || '',
          data.price || 0,
          data.currency || 'USD',
          data.location || '',
          data.type || 'casa',
          data.status || 'venta',
          data.bedrooms || 0,
          data.bathrooms || 0,
          data.area || 0,
          imagesStr,
          data.featured ? 1 : 0,
          data.latitude || null,
          data.longitude || null,
          data.owner_contact || '',
          data.owner_private_notes || ''
        ).run();

        return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 5. ENDPOINT: Actualizar Propiedad (Privado)
      const updateMatch = path.match(/^\/api\/admin\/properties\/(\d+)$/);
      if (updateMatch && request.method === 'PUT') {
        if (!isAuthenticated(request, env)) {
          return new Response('No autorizado', { status: 401, headers: CORS_HEADERS });
        }

        const id = updateMatch[1];
        const data = await request.json();
        const imagesStr = JSON.stringify(Array.isArray(data.images) ? data.images : []);

        await env.DB.prepare(`
          UPDATE properties 
          SET title = ?, description = ?, price = ?, currency = ?, location = ?, type = ?, status = ?, 
              bedrooms = ?, bathrooms = ?, area = ?, images = ?, featured = ?, latitude = ?, longitude = ?, 
              owner_contact = ?, owner_private_notes = ?
          WHERE id = ?
        `).bind(
          data.title,
          data.description || '',
          data.price || 0,
          data.currency || 'USD',
          data.location || '',
          data.type || 'casa',
          data.status || 'venta',
          data.bedrooms || 0,
          data.bathrooms || 0,
          data.area || 0,
          imagesStr,
          data.featured ? 1 : 0,
          data.latitude || null,
          data.longitude || null,
          data.owner_contact || '',
          data.owner_private_notes || '',
          id
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 6. ENDPOINT: Eliminar / Archivar Propiedad (Privado)
      const deleteMatch = path.match(/^\/api\/admin\/properties\/(\d+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        if (!isAuthenticated(request, env)) {
          return new Response('No autorizado', { status: 401, headers: CORS_HEADERS });
        }
        const id = deleteMatch[1];
        
        // En lugar de eliminación física destructiva, archivamos la propiedad para preservar historial
        await env.DB.prepare("UPDATE properties SET status = 'archived' WHERE id = ?").bind(id).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // Ruteador básico para entornos locales de pruebas o despliegues directos
      return new Response('Endpoint de API no encontrado o archivo estático fuera del alcance directo.', {
        status: 404,
        headers: CORS_HEADERS
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
  }
};