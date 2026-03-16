/**
 * Node Assignments admin API — /api/node-assignments
 *
 * Admin-only CRUD for hardware nodes assigned to this tenant.
 * management_url is stored server-side only; the portal nodes API proxies
 * commands through it without ever sending the URL to the browser.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types.js'
import { AppError } from '../error.js'
import { authMiddleware, requireAdmin } from '../auth/middleware.js'

const VALID_SECTIONS = ['status', 'config', 'display', 'scope', 'decimator', 'atem', 'system'] as const

const app = new Hono<AppEnv>()

app.use('*', authMiddleware)

// GET /api/node-assignments — list all (admin only)
app.get('/', async (c) => {
  requireAdmin(c.var.user)
  const nodes = await c.var.state.db`
    SELECT id, name, model, management_url, config, created_at, updated_at
    FROM node_assignments
    ORDER BY name ASC
  `
  return c.json(nodes)
})

// POST /api/node-assignments — create a node assignment
app.post('/', async (c) => {
  requireAdmin(c.var.user)
  const body = await c.req.json().catch(() => null)
  if (!body) throw AppError.validation('body required')

  const { name, model, management_url, allowed_sections } = body as Record<string, unknown>

  if (typeof name !== 'string' || !name.trim()) throw AppError.validation('name required')
  if (typeof management_url !== 'string' || !management_url.trim()) throw AppError.validation('management_url required')

  const sections: string[] = Array.isArray(allowed_sections)
    ? (allowed_sections as string[]).filter((s) => VALID_SECTIONS.includes(s as typeof VALID_SECTIONS[number]))
    : ['status']

  // "status" is always included
  if (!sections.includes('status')) sections.unshift('status')

  const config = { allowed_sections: sections }

  const [node] = await c.var.state.db`
    INSERT INTO node_assignments (name, model, management_url, config)
    VALUES (
      ${name.trim()},
      ${typeof model === 'string' ? model.trim() : ''},
      ${management_url.trim()},
      ${JSON.stringify(config)}
    )
    RETURNING id, name, model, management_url, config, created_at, updated_at
  `

  await c.var.state.db`
    INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id)
    VALUES ('user', ${c.var.user.sub}, 'node_assignment.create', 'node_assignment', ${node.id})
  `.catch(() => {})

  return c.json(node, 201)
})

// GET /api/node-assignments/:id
app.get('/:id', async (c) => {
  requireAdmin(c.var.user)
  const [node] = await c.var.state.db`
    SELECT id, name, model, management_url, config, created_at, updated_at
    FROM node_assignments WHERE id = ${c.req.param('id')}
  `
  if (!node) throw AppError.notFound()
  return c.json(node)
})

// PATCH /api/node-assignments/:id
app.patch('/:id', async (c) => {
  requireAdmin(c.var.user)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const { db } = c.var.state

  const [existing] = await db`SELECT id FROM node_assignments WHERE id = ${id}`
  if (!existing) throw AppError.notFound()

  if (body.name != null) {
    await db`UPDATE node_assignments SET name = ${String(body.name).trim()}, updated_at = now() WHERE id = ${id}`
  }
  if (body.model != null) {
    await db`UPDATE node_assignments SET model = ${String(body.model).trim()}, updated_at = now() WHERE id = ${id}`
  }
  if (body.management_url != null) {
    await db`UPDATE node_assignments SET management_url = ${String(body.management_url).trim()}, updated_at = now() WHERE id = ${id}`
  }
  if (Array.isArray(body.allowed_sections)) {
    const sections = (body.allowed_sections as string[])
      .filter((s) => VALID_SECTIONS.includes(s as typeof VALID_SECTIONS[number]))
    if (!sections.includes('status')) sections.unshift('status')
    const config = { allowed_sections: sections }
    await db`UPDATE node_assignments SET config = ${JSON.stringify(config)}, updated_at = now() WHERE id = ${id}`
  }

  const [updated] = await db`
    SELECT id, name, model, management_url, config, created_at, updated_at
    FROM node_assignments WHERE id = ${id}
  `

  await db`
    INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id)
    VALUES ('user', ${c.var.user.sub}, 'node_assignment.update', 'node_assignment', ${id})
  `.catch(() => {})

  return c.json(updated)
})

// DELETE /api/node-assignments/:id
app.delete('/:id', async (c) => {
  requireAdmin(c.var.user)
  const id = c.req.param('id')
  const { db } = c.var.state

  const [existing] = await db`SELECT id FROM node_assignments WHERE id = ${id}`
  if (!existing) throw AppError.notFound()

  await db`DELETE FROM node_assignments WHERE id = ${id}`

  await db`
    INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id)
    VALUES ('user', ${c.var.user.sub}, 'node_assignment.delete', 'node_assignment', ${id})
  `.catch(() => {})

  return c.json({ ok: true })
})

export default app
