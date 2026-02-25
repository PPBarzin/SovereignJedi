# GQ-03 — Static Reviewer Gate

## Checklist & Proofs

| Requirement | State | Source Location / Proof |
| :--- | :--- | :--- |
| **MAX_ENTRIES (32)** | PASS | `programs/sj_registry_program/src/lib.rs:35` |
| **RegistryFull Error** | PASS | `programs/sj_registry_program/src/lib.rs:165` (check) and `305` (ErrorCode) |
| **sha256(vaultIdCanonical) Recalculation** | PASS | `programs/sj_registry_program/src/lib.rs:155` (canonicalize) and `160` (hash recalculation) |
| **Hash Verification (Argument vs Recalculated)** | PASS | `programs/sj_registry_program/src/lib.rs:161` (`require!(expected_hash == vault_id_hash, ...)`) |
| **regex/canonicalization** | PASS | `programs/sj_registry_program/src/lib.rs:245` (`validate_and_canonicalize_vault_id`) |
| **CID Strict Validation** | PASS | `programs/sj_registry_program/src/lib.rs:265` (`validate_cid_strict` supporting CIDv0 and CIDv1) |
| **DuplicateEntry Prevention** | PASS | `programs/sj_registry_program/src/lib.rs:175` (check) and `310` (ErrorCode) |
| **schemaVersion Strict (1)** | PASS | `programs/sj_registry_program/src/lib.rs:150` (init) and `170` (append) |

## Traceability Links

- **Commit**: `1382e6d` (Latest fix for dev environment stability)
- **File**: `programs/sj_registry_program/src/lib.rs`

### Code Snippets Summary

**VaultId Hash recatculation & verification:**
```rust
let canonical_id = validate_and_canonicalize_vault_id(vault_id)?;
let expected_hash = hash(canonical_id.as_bytes()).to_bytes();
require!(expected_hash == vault_id_hash, ErrorCode::InvalidVaultIdHash);
```

**CID Format Strictness:**
```rust
if cid.starts_with('b') { /* base32 CIDv1 check */ }
else if cid.starts_with("Qm") { /* base58 CIDv0 check */ }
else { return Err(ErrorCode::InvalidCidFormat); }
```
