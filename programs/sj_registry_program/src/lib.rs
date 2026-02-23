use anchor_lang::prelude::*;
use solana_program::hash::hash;

declare_id!("D6qM1htB82ZSNYh2BUDeVPK44ECGqbstxY9jTLSfLQnz");

pub const MAX_ENTRIES: usize = 32;
pub const MAX_CID_LEN: usize = 64;
pub const MAX_VAULT_ID_LEN: usize = 32;

#[program]
pub mod sj_registry_program {
    use super::*;

    pub fn init_registry(
        ctx: Context<InitRegistry>,
        vault_id: String,
        vault_id_hash: [u8; 32],
        manifest_schema_version: u8,
    ) -> Result<()> {
        require!(manifest_schema_version == 1, ErrorCode::InvalidSchemaVersion);

        let canonical_id = validate_and_canonicalize_vault_id(&vault_id)?;
        
        let expected_hash = hash(canonical_id.as_bytes()).to_bytes();
        require!(expected_hash == vault_id_hash, ErrorCode::InvalidVaultIdHash);

        let registry = &mut ctx.accounts.registry;
        registry.registry_version = 1;
        registry.manifest_schema_version = manifest_schema_version;
        registry.wallet = ctx.accounts.wallet.key();
        registry.vault_id = canonical_id;
        registry.entries = Vec::new();
        registry.created_at = Clock::get()?.unix_timestamp;
        registry.updated_at = registry.created_at;

        Ok(())
    }

    pub fn append_manifest(
        ctx: Context<AppendManifest>,
        _vault_id_hash: [u8; 32],
        manifest_cid: String,
        manifest_schema_version: u8,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;

        require!(manifest_schema_version == 1, ErrorCode::InvalidSchemaVersion);
        require!(registry.entries.len() < MAX_ENTRIES, ErrorCode::RegistryFull);

        // CID Validation (STEEL)
        validate_cid_strict(&manifest_cid)?;

        // Hash consistency check
        let actual_hash = hash(registry.vault_id.as_bytes()).to_bytes();
        require!(actual_hash == _vault_id_hash, ErrorCode::InvalidVaultIdHash);

        // Uniqueness check
        for entry in &registry.entries {
            require!(entry.manifest_cid != manifest_cid, ErrorCode::DuplicateEntry);
        }

        let new_entry = RegistryEntry {
            manifest_cid: manifest_cid.clone(),
            manifest_cid_hash: hash(manifest_cid.as_bytes()).to_bytes(),
            published_at: Clock::get()?.unix_timestamp,
            publisher: ctx.accounts.wallet.key(),
            manifest_schema_version,
        };

        registry.entries.push(new_entry);
        registry.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

fn validate_and_canonicalize_vault_id(id: &str) -> Result<String> {
    let trimmed = id.trim();
    let lower = trimmed.to_lowercase();
    
    require!(!lower.is_empty() && lower.len() <= MAX_VAULT_ID_LEN, ErrorCode::InvalidVaultIdFormat);
    
    for c in lower.chars() {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' && c != '_' {
            return Err(error!(ErrorCode::InvalidVaultIdFormat));
        }
    }
    
    if id.contains(' ') || id.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(error!(ErrorCode::InvalidVaultIdFormat));
    }
    
    Ok(lower)
}

fn validate_cid_strict(cid: &str) -> Result<()> {
    require!(cid.len() <= MAX_CID_LEN, ErrorCode::CidTooLong);
    require!(!cid.is_empty(), ErrorCode::InvalidCidFormat);

    if cid.starts_with('b') {
        for c in cid.chars().skip(1) {
            if !matches!(c, 'a'..='z' | '2'..='7') {
                return Err(error!(ErrorCode::InvalidCidFormat));
            }
        }
    } else if cid.starts_with("Qm") {
        let base58_chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        for c in cid.chars() {
            if !base58_chars.contains(c) {
                return Err(error!(ErrorCode::InvalidCidFormat));
            }
        }
    } else {
        return Err(error!(ErrorCode::InvalidCidFormat));
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: String, vault_id_hash: [u8; 32], manifest_schema_version: u8)]
pub struct InitRegistry<'info> {
    #[account(
        init,
        payer = wallet,
        space = RegistryAccount::SPACE,
        seeds = [
            b"SJ_REGISTRY_V1",
            wallet.key().as_ref(),
            vault_id_hash.as_ref(),
        ],
        bump
    )]
    pub registry: Account<'info, RegistryAccount>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(vault_id_hash: [u8; 32])]
pub struct AppendManifest<'info> {
    #[account(
        mut,
        seeds = [
            b"SJ_REGISTRY_V1",
            wallet.key().as_ref(),
            vault_id_hash.as_ref(),
            ],
        bump,
        has_one = wallet
    )]
    pub registry: Account<'info, RegistryAccount>,
    pub wallet: Signer<'info>,
}

#[account]
pub struct RegistryAccount {
    pub registry_version: u8,
    pub manifest_schema_version: u8,
    pub wallet: Pubkey,
    pub vault_id: String,
    pub entries: Vec<RegistryEntry>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RegistryAccount {
    pub const SPACE: usize = 8 + 1 + 1 + 32 + (4 + MAX_VAULT_ID_LEN) + 4 + (MAX_ENTRIES * ( (4 + MAX_CID_LEN) + 32 + 8 + 32 + 1 )) + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct RegistryEntry {
    pub manifest_cid: String,
    pub manifest_cid_hash: [u8; 32],
    pub published_at: i64,
    pub publisher: Pubkey,
    pub manifest_schema_version: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Registry is full (max 32 entries).")]
    RegistryFull,
    #[msg("Invalid manifest schema version.")]
    InvalidSchemaVersion,
    #[msg("Manifest CID already published.")]
    DuplicateEntry,
    #[msg("Vault ID hash mismatch.")]
    InvalidVaultIdHash,
    #[msg("Invalid Vault ID format (must be alpha-numeric).")]
    InvalidVaultIdFormat,
    #[msg("Invalid CID format.")]
    InvalidCidFormat,
    #[msg("CID is too long.")]
    CidTooLong,
}
