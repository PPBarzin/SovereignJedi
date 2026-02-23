# Task 07: Decentralized Registry (STEEL Specifications)

## Design Decisions

### 1. Deterministic Restore (Tie-breaker)
When multiple manifests are found in the on-chain registry, the client MUST select the "latest" one. 
In case of identical `publishedAt` timestamps, a deterministic tie-breaker is applied:
- Rule: Sort by `manifestCid` in descending lexicographical order.
- Logic: `b.manifestCid.localeCompare(a.manifestCid)` (higher CID wins).
- Reason: Ensures all clients converge on the same "Head" without central coordination.

### 2. Strict CID Validation (On-chain)
The Solana program enforces strict format validation to prevent registry pollution:
- **CIDv1**: Must start with `b`. Remaining chars must be valid Base32 (RFC4648: `a-z2-7`).
- **CIDv0**: Must start with `Qm`. Remaining chars must be valid Base58btc.
- **Length**: Maximum 64 characters.
- **Error**: Throws `InvalidCidFormat` or `CidTooLong`.

### 3. Vault ID and Hash Integrity
The link between `vaultId` and its on-chain storage is protected by PDA seeds:
- **Seeds**: `[b"SJ_REGISTRY_V1", wallet_pubkey, sha256(vault_id)]`.
- **Mismatch manifestation**: Any attempt to initialize a registry with a `vaultId` hash that does not match the provided `vault_id` string will result in a `ConstraintSeeds` error.
- **Justification**: The Solana runtime validates account seeds before instruction execution; the seed barrier is the primary security gate.

### 3. Vault ID Canonicalization
- **Regex**: `[a-z0-9-_]{1,32}`.
- **Rules**: Lowercase only, no spaces, no special characters other than `-` and `_`.
- **Constraint**: On-chain hash verification ensures the PDA seeds match the canonicalized ID.

## Integrity Procedures

### IDL Provability
To ensure the TypeScript client and the Solana program are always in sync, a manual edit of the IDL is forbidden.
- **Generate**: `pnpm gen:idl` (Builds program and copies IDL to the package).
- **Verify**: `pnpm check:idl` (Builds and compares with the committed IDL, fails on diff).

## Hostile Test Suite
The following scenarios are covered in `packages/solana-registry/tests/registry.test.ts`:
- **RegistryFull**: Exactly 32 entries allowed, 33rd fails.
- **InvalidVaultId**: Rejects spaces, uppercase, and path traversal strings.
- **HashMismatch**: Rejects initialization if the provided hash doesn't match the canonical Vault ID.
- **CidValidation**: Validates multibase prefixes ('b', 'Qm') and charsets.
- **DuplicateEntry**: Prevents appending the same CID twice.

## Verification
```bash
# Build and check IDL integrity
pnpm gen:idl
pnpm check:idl

# Run hostile E2E tests
pnpm -F @sj/solana-registry test

# Run IPFS retry unit tests
pnpm -F apps/web test
```
