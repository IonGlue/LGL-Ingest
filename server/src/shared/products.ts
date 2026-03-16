/**
 * Product catalog for orchestrate-managed apps.
 *
 * Each entry describes a deployable product: its containers, ports, volumes,
 * and how to generate the per-tenant .env file.
 *
 * Matches the structure used by the orchestrate agent when provisioning a
 * tenant stack via docker-compose.
 */

export interface ProductService {
  /** Env-var name whose value is the Docker image tag (e.g. MYAPP_IMAGE). */
  imageKey: string
  /** Fallback image if the env var is not set on the agent host. */
  defaultImage: string
}

export interface Product {
  /** Human-readable name shown in the admin UI. */
  label: string
  /** One-line description. */
  description: string
  /** Service name in the docker-compose template that receives HTTP traffic. */
  entryService: string
  /** Port the entry service listens on inside the container. */
  entryPort: number
  /** Port allocations needed: 'api' | 'rtmp' | 'srt'. */
  ports: string[]
  /** Host subdirectories created under /data/tenants/{slug}/. */
  dirs: string[]
  /** Named Docker volumes declared in the template. */
  volumes: string[]
  /** Extra config file templates copied to the tenant directory. */
  extraTemplates: string[]
  /** Map of service name → image configuration. */
  services: Record<string, ProductService>
  /**
   * Whether this product is portal-only (no GPU, no heavy deploy steps).
   * Portal-only products are lightweight and do not trigger the full
   * provisioning flow used for GPU-dependent products.
   */
  portalOnly?: boolean
  /**
   * Generate the per-tenant .env content.
   * Values are NOT shell-escaped — safe for arbitrary strings such as bcrypt
   * hashes and base64 secrets.
   */
  renderEnv(tenant: TenantContext, config: ServerConfig): string
}

export interface TenantContext {
  slug: string
  jwt_secret: string
  cf_tunnel_token: string
  brand_logo_url?: string
  brand_accent_color?: string
}

export interface ServerConfig {
  CORE_INTERNAL_URL: string
  INTERNAL_SECRET: string
  BASE_DOMAIN: string
  DOCKER_NETWORK?: string
  NODE_CONTROLLER_IMAGE?: string
  ORCHESTRATE_URL?: string
  LOGTO_ENDPOINT?: string
  LOGTO_APP_ID?: string
  LOGTO_APP_SECRET?: string
  LOGTO_API_RESOURCE?: string
}

// ─── Product Catalog ──────────────────────────────────────────────────────────

export const PRODUCTS: Record<string, Product> = {
  node_controller: {
    label: 'Node Controller',
    description: 'Full control panel for assigned hardware nodes.',
    entryService: 'node-controller',
    entryPort: 3001,
    ports: ['api'],
    dirs: [],
    volumes: [],
    extraTemplates: [],
    portalOnly: true,
    services: {
      'node-controller': {
        imageKey: 'NODE_CONTROLLER_IMAGE',
        defaultImage: 'ghcr.io/ionglue/node-controller:latest',
      },
    },
    renderEnv(tenant, config) {
      const v = (val: string | undefined) => String(val ?? '')
      const lines = [
        `TENANT_SLUG=${v(tenant.slug)}`,
        `ORCHESTRATE_URL=${v(config.ORCHESTRATE_URL ?? config.CORE_INTERNAL_URL)}`,
        `LOGTO_ENDPOINT=${v(config.LOGTO_ENDPOINT) || 'https://auth.lgl-os.com'}`,
        `LOGTO_APP_ID=${v(config.LOGTO_APP_ID)}`,
        `LOGTO_APP_SECRET=${v(config.LOGTO_APP_SECRET)}`,
        `LOGTO_REDIRECT_URI=https://${v(tenant.slug)}.nodecontroller.${v(config.BASE_DOMAIN)}/auth/callback`,
        `LOGTO_API_RESOURCE=${v(config.LOGTO_API_RESOURCE) || 'https://api.orchestrate.lgl-os.com'}`,
        `SESSION_SECRET=${v(tenant.jwt_secret)}`,
        `CF_TUNNEL_TOKEN=${v(tenant.cf_tunnel_token)}`,
        `BASE_DOMAIN=${v(config.BASE_DOMAIN)}`,
        `CORS_ORIGIN=https://*.${v(config.BASE_DOMAIN)}`,
        `BRAND_LOGO_URL=${v(tenant.brand_logo_url)}`,
        `BRAND_ACCENT_COLOR=${v(tenant.brand_accent_color)}`,
      ]
      return lines.join('\n') + '\n'
    },
  },
}

/** Look up a product by key, throws if not found. */
export function getProduct(key: string): Product {
  const p = PRODUCTS[key]
  if (!p) throw new Error(`Unknown product: ${key}`)
  return p
}
