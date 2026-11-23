#![no_std]
//! Slim API price registry (#257, ADR 0006).
//!
//! The gateway only anchors API prices on-chain: the server calls `register`
//! and `set_price` (provider-signed) and reads `get`. This contract keeps
//! exactly that surface — same function names, argument order and error
//! codes as `vault-registry` — without the vault feature set (leases,
//! disputes, royalties, moderation, receipts).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

/// Largest accepted price, in USDC base units (7 decimals). Same as vault-registry.
pub const MAX_PRICE: i128 = 1_000_000_000_000_000_000;
/// Resource ids are 1-24 lowercase ASCII letters or digits. Same as vault-registry.
pub const MAX_RESOURCE_ID_LEN: u32 = 24;
/// Listing metadata cap, in bytes. Same as vault-registry's metadata pointer.
pub const MAX_METADATA_LEN: u32 = 512;

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Error codes match vault-registry so existing clients map them unchanged.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyRegistered = 1,
    NotFound = 2,
    InvalidPrice = 3,
    MetadataTooLong = 4,
    InvalidTag = 5,
    InvalidResourceId = 11,
    EmptyMetadata = 13,
    ReservedId = 16,
    PriceExceedsMax = 17,
    CountOverflow = 36,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Resource(String),
    Count,
}

/// An anchored API listing.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Resource {
    pub id: String,
    pub creator: Address,
    /// Price in USDC base units (7 decimals).
    pub price: i128,
    pub metadata: String,
    pub created_at: u32,
    pub updated_at: u32,
}

/// Data of the `setprice` event (same shape as vault-registry's).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceUpdated {
    pub id: String,
    pub old_price: i128,
    pub new_price: i128,
    pub updater: Address,
}

#[contract]
pub struct ApiRegistry;

#[contractimpl]
impl ApiRegistry {
    /// Anchor an API listing. Requires the creator's authorization.
    /// `tags` is accepted for call compatibility with vault-registry and must
    /// be empty: this registry does not store discovery tags.
    pub fn register(
        env: Env,
        creator: Address,
        id: String,
        price: i128,
        metadata: String,
        tags: Vec<String>,
    ) -> Result<(), Error> {
        creator.require_auth();
        validate_id(&id)?;
        if !tags.is_empty() {
            return Err(Error::InvalidTag);
        }
        validate_price(price)?;
        validate_metadata(&metadata)?;
        let key = DataKey::Resource(id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyRegistered);
        }
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let count = count.checked_add(1).ok_or(Error::CountOverflow)?;

        let now = env.ledger().sequence();
        let resource = Resource {
            id: id.clone(),
            creator: creator.clone(),
            price,
            metadata,
            created_at: now,
            updated_at: now,
        };
        env.storage().persistent().set(&key, &resource);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        env.storage().instance().set(&DataKey::Count, &count);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        env.events()
            .publish((symbol_short!("register"), id), (creator, price));
        Ok(())
    }

    /// Change a listing's price. Only its creator may call this. Setting the
    /// current price again succeeds without writing or emitting an event.
    pub fn set_price(env: Env, id: String, new_price: i128) -> Result<(), Error> {
        validate_id(&id)?;
        validate_price(new_price)?;
        let key = DataKey::Resource(id.clone());
        let mut resource: Resource = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        resource.creator.require_auth();
        if resource.price == new_price {
            return Ok(());
        }
        let old_price = resource.price;
        resource.price = new_price;
        resource.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&key, &resource);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        env.events().publish(
            (symbol_short!("setprice"),),
            PriceUpdated {
                id,
                old_price,
                new_price,
                updater: resource.creator,
            },
        );
        Ok(())
    }

    /// Read a listing.
    pub fn get(env: Env, id: String) -> Result<Resource, Error> {
        let key = DataKey::Resource(id);
        let resource: Resource = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        Ok(resource)
    }

    /// Whether `id` is registered.
    pub fn exists(env: Env, id: String) -> bool {
        env.storage().persistent().has(&DataKey::Resource(id))
    }

    /// Number of listings ever registered.
    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}

fn validate_price(price: i128) -> Result<(), Error> {
    if price <= 0 {
        return Err(Error::InvalidPrice);
    }
    if price > MAX_PRICE {
        return Err(Error::PriceExceedsMax);
    }
    Ok(())
}

fn validate_metadata(metadata: &String) -> Result<(), Error> {
    if metadata.len() == 0 {
        return Err(Error::EmptyMetadata);
    }
    if metadata.len() > MAX_METADATA_LEN {
        return Err(Error::MetadataTooLong);
    }
    Ok(())
}

fn validate_id(id: &String) -> Result<(), Error> {
    let len = id.len();
    if len == 0 || len > MAX_RESOURCE_ID_LEN {
        return Err(Error::InvalidResourceId);
    }
    let mut buf = [0u8; MAX_RESOURCE_ID_LEN as usize];
    let bytes = &mut buf[..len as usize];
    id.copy_into_slice(bytes);
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return Err(Error::InvalidResourceId);
    }
    const RESERVED: [&[u8]; 7] = [
        b"admin",
        b"null",
        b"registry",
        b"api",
        b"index",
        b"root",
        b"system",
    ];
    if RESERVED.iter().any(|r| *r == &*bytes) {
        return Err(Error::ReservedId);
    }
    Ok(())
}

#[cfg(test)]
mod test;
