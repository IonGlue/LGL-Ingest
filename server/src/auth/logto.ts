import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { UserClaims } from '../types.js'
import { AppError } from '../error.js'

const JWKS_URL = process.env.LOGTO_JWKS_URL ?? 'https://auth.lgl-os.com/oidc/jwks'
const ISSUER = process.env.LOGTO_ISSUER ?? 'https://auth.lgl-os.com/oidc'
const AUDIENCE = process.env.LOGTO_API_RESOURCE ?? 'https://api.orchestrate.lgl-os.com'

const ORCH_API_URL = process.env.ORCH_API_URL ?? ''
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? ''
const TENANT_SLUG = process.env.TENANT_SLUG ?? ''

// Lazily initialised so the module can be imported without a network call.
// The JWKS set caches keys internally and refreshes on key miss (rotation).
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJWKS() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(JWKS_URL))
  return _jwks
}

/**
 * Returns true when orchestrate has injected the integration env vars,
 * meaning we should validate tokens via Logto rather than the local HS256 secret.
 */
export function isLogtoMode(): boolean {
  return !!(ORCH_API_URL && INTERNAL_SECRET && TENANT_SLUG)
}

/**
 * Validate a Logto org-scoped JWT and resolve the user's role from orchestrate.
 * Throws AppError.unauthorized() / AppError.forbidden() on failure.
 */
export async function verifyLogtoToken(token: string): Promise<UserClaims> {
  let payload: Record<string, unknown>
  try {
    const { payload: p } = await jwtVerify(token, getJWKS(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['ES384'],
    })
    payload = p as Record<string, unknown>
  } catch {
    // Invalidate cached JWKS on verification failure so a key rotation is
    // picked up automatically on the next request.
    _jwks = null
    throw AppError.unauthorized()
  }

  if (!payload.organization_id) {
    throw AppError.forbidden()
  }

  // Resolve role and permissions from orchestrate internal API
  let res: Response | null = null
  try {
    res = await fetch(`${ORCH_API_URL}/api/internal/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        tenant_slug: TENANT_SLUG,
        logto_user_id: payload.sub,
      }),
    })
  } catch {
    throw AppError.unauthorized()
  }

  if (!res.ok) {
    throw AppError.unauthorized()
  }

  const user = await res.json() as { id: string; email: string; role: string; display_name?: string }
  return {
    sub: payload.sub as string,
    role: user.role,
    type: 'user',
    exp: payload.exp as number,
    iat: payload.iat as number,
    _logto: { id: user.id, email: user.email, display_name: user.display_name ?? '', role: user.role },
  }
}
