/**
 * Portal Nodes API — /api/portal/nodes
 *
 * Gives tenant users read/control access to their assigned hardware nodes via
 * the Node Controller product.  All device commands are proxied server-side so
 * the management_url is never exposed to the browser.
 *
 * Section → path prefix mapping mirrors the product plan:
 *   status     → /api/status, /api/system/info
 *   config     → /api/config, /api/restart
 *   display    → /api/mode, /api/display/*
 *   scope      → /api/scope/*
 *   decimator  → /api/decimator/*
 *   atem       → /api/atem/*
 *   system     → /api/system/reboot, /api/system/restart-service, /api/system/*
 *
 * "status" is always permitted regardless of allowed_sections.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types.js'
import { AppError } from '../error.js'
import { authMiddleware } from '../auth/middleware.js'

const STATUS_PATHS = ['/api/status', '/api/system/info']

/** Map a proxy path (e.g. "/api/mode") to the section name it belongs to. */
function sectionForPath(proxyPath: string): string {
  const p = proxyPath.startsWith('/') ? proxyPath : '/' + proxyPath

  // Order matters — more-specific checks first
  if (p === '/api/status' || p === '/api/system/info') return 'status'
  if (p === '/api/system/reboot' || p === '/api/system/restart-service') return 'system'
  if (p.startsWith('/api/system/')) return 'system'
  if (p.startsWith('/api/decimator/')) return 'decimator'
  if (p.startsWith('/api/scope/')) return 'scope'
  if (p.startsWith('/api/display/')) return 'display'
  if (p === '/api/mode') return 'display'
  if (p === '/api/config' || p === '/api/restart') return 'config'
  if (p.startsWith('/api/atem/')) return 'atem'

  // Fall back — require status at minimum (rejected below if not in list)
  return 'unknown'
}

const app = new Hono<AppEnv>()

app.use('*', authMiddleware)

// GET /api/portal/nodes — list all assigned nodes with allowed_sections
app.get('/', async (c) => {
  const { db } = c.var.state
  const nodes = await db`
    SELECT id, name, model, config, created_at, updated_at
    FROM node_assignments
    ORDER BY name ASC
  `
  return c.json(nodes)
})

// GET /api/portal/nodes/:nodeId/status — lightweight status shortcut (always allowed)
app.get('/:nodeId/status', async (c) => {
  const { db } = c.var.state
  const nodeId = c.req.param('nodeId')

  const [node] = await db`
    SELECT id, name, model, management_url
    FROM node_assignments WHERE id = ${nodeId}
  `
  if (!node) throw AppError.notFound()

  let deviceStatus: unknown = null
  try {
    const res = await fetch(`${node.management_url}/api/status`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) deviceStatus = await res.json()
  } catch {
    // Device unreachable — return null status; caller handles display
  }

  return c.json({ id: node.id, name: node.name, model: node.model, status: deviceStatus })
})

// ALL /api/portal/nodes/:nodeId/proxy/* — section-validated proxy to device
app.all('/:nodeId/proxy/*', async (c) => {
  const { db } = c.var.state
  const nodeId = c.req.param('nodeId')

  const [node] = await db`
    SELECT id, management_url, config
    FROM node_assignments WHERE id = ${nodeId}
  `
  if (!node) throw AppError.notFound()

  const allowedSections: string[] = (node.config as { allowed_sections?: string[] }).allowed_sections ?? ['status']

  // Extract the path after /proxy
  const fullPath = c.req.path
  const proxyMarker = `/proxy`
  const markerIdx = fullPath.indexOf(proxyMarker)
  const proxyPath = markerIdx >= 0 ? fullPath.slice(markerIdx + proxyMarker.length) : '/'

  const section = sectionForPath(proxyPath)

  // "status" is always permitted
  const isStatusPath = STATUS_PATHS.includes(proxyPath) || proxyPath === '/api/status'
  if (!isStatusPath && !allowedSections.includes(section)) {
    throw AppError.forbidden()
  }

  // Build target URL — preserve query string
  const url = new URL(c.req.url)
  const targetUrl = `${node.management_url}${proxyPath}${url.search}`

  // Forward the request
  const method = c.req.method
  let body: BodyInit | null = null
  if (!['GET', 'HEAD'].includes(method)) {
    body = await c.req.arrayBuffer()
  }

  const upstreamHeaders: Record<string, string> = {}
  const contentType = c.req.header('content-type')
  if (contentType) upstreamHeaders['content-type'] = contentType

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    return c.json({ error: 'device_unreachable' }, 502)
  }

  const responseBody = await upstream.arrayBuffer()
  const responseContentType = upstream.headers.get('content-type') ?? 'application/octet-stream'

  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'content-type': responseContentType },
  })
})

export default app
