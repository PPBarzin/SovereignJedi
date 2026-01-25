
/**
 * Helpers to enforce vault action guards across UI and handlers.
 *
 * Rule (product): A vault action is allowed ONLY if:
 *  - IdentityVerified === true (proof-of-control present and not expired)
 *  - AND VaultUnlocked === true (session in-memory unlock)
 *
 * These helpers centralize that logic so UI and server/handlers call the same checks.
 */

import { session } from './SessionManager'
import { Identity, loadIdentity, isVerified } from '../../components/wallet/types'

/**
 * Check whether the given identity object is currently verified.
 * Uses the same `isVerified` logic as the wallet components (TTL, shape checks).
 *
 * @param identity optional Identity object (if omitted, will try to load persisted identity)
 */
export function hasIdentityVerified(identity?: Identity | null): boolean {
  try {
    const id = identity ?? loadIdentity()
    return isVerified(id)
  } catch {
    return false
  }
}

/**
 * Return whether the current session reports the vault as unlocked.
 * This reads the SessionManager singleton (memory-only).
 */
export function isVaultUnlocked(): boolean {
  try {
    return session.isVaultUnlocked()
  } catch {
    return false
  }
}

/**
 * Combined guard: both identity verified AND vault unlocked.
 *
 * @param identity optional Identity object (if omitted, persisted identity is used)
 */
export function canPerformVaultActions(identity?: Identity | null): boolean {
  return hasIdentityVerified(identity) && isVaultUnlocked()
}

/**
 * Throw an Error with an actionable message if the guard fails.
 *
 * This is suitable for use in handler code paths where throwing an error
 * will be caught and rendered to the user; messages are intentionally user-facing
 * and avoid leaking sensitive details.
 *
 * @param identity optional Identity object (if omitted, persisted identity is used)
 */
export function assertCanPerformVaultActions(identity?: Identity | null): void {
  if (!hasIdentityVerified(identity)) {
    throw new Error('Identity not verified — please perform "Sign to Verify" first.')
  }
  if (!isVaultUnlocked()) {
    throw new Error('Vault locked — please click "Unlock Vault (required to upload)" and approve the signature to unlock for this session.')
  }
}

/**
 * Utility: return a small diagnostic object describing current gate state.
 * Useful for UI status lines or tests.
 */
export function vaultGuardStatus(identity?: Identity | null): { identityVerified: boolean; vaultUnlocked: boolean } {
  return {
    identityVerified: hasIdentityVerified(identity),
    vaultUnlocked: isVaultUnlocked(),
  }
}

export default {
  hasIdentityVerified,
  isVaultUnlocked,
  canPerformVaultActions,
  assertCanPerformVaultActions,
  vaultGuardStatus,
}
