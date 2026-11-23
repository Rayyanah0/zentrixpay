use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{vec, Env, String};

fn setup() -> (Env, ApiRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ApiRegistry, ());
    let client = ApiRegistryClient::new(&env, &id);
    let creator = Address::generate(&env);
    (env, client, creator)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

#[test]
fn register_then_get_returns_price_and_creator() {
    let (env, client, creator) = setup();
    env.ledger().set_sequence_number(42);
    client.register(
        &creator,
        &s(&env, "weather1"),
        &5_000_000,
        &s(&env, "{}"),
        &vec![&env],
    );

    let r = client.get(&s(&env, "weather1"));
    assert_eq!(r.creator, creator);
    assert_eq!(r.price, 5_000_000);
    assert_eq!(r.created_at, 42);
    assert!(client.exists(&s(&env, "weather1")));
    assert_eq!(client.count(), 1);
}

#[test]
fn duplicate_and_invalid_registrations_are_rejected() {
    let (env, client, creator) = setup();
    let none = vec![&env];
    let meta = s(&env, "{}");
    client.register(&creator, &s(&env, "a1"), &1, &meta, &none);

    let reg = |id: &str, price: i128, meta: &String, tags: &Vec<String>| {
        client.try_register(&creator, &s(&env, id), &price, meta, tags)
    };
    assert_eq!(
        reg("a1", 1, &meta, &none),
        Err(Ok(Error::AlreadyRegistered))
    );
    assert_eq!(reg("b1", 0, &meta, &none), Err(Ok(Error::InvalidPrice)));
    assert_eq!(
        reg("b1", MAX_PRICE + 1, &meta, &none),
        Err(Ok(Error::PriceExceedsMax))
    );
    assert_eq!(
        reg("Bad-Id", 1, &meta, &none),
        Err(Ok(Error::InvalidResourceId))
    );
    assert_eq!(reg("admin", 1, &meta, &none), Err(Ok(Error::ReservedId)));
    assert_eq!(
        reg("b1", 1, &s(&env, ""), &none),
        Err(Ok(Error::EmptyMetadata))
    );
    let long = String::from_bytes(&env, &[b'x'; MAX_METADATA_LEN as usize + 1]);
    assert_eq!(reg("b1", 1, &long, &none), Err(Ok(Error::MetadataTooLong)));
    assert_eq!(
        reg("b1", 1, &meta, &vec![&env, s(&env, "tag")]),
        Err(Ok(Error::InvalidTag))
    );
    assert_eq!(client.count(), 1);
}

#[test]
fn set_price_updates_and_requires_the_creator() {
    let (env, client, creator) = setup();
    client.register(&creator, &s(&env, "a1"), &10, &s(&env, "{}"), &vec![&env]);
    env.ledger().set_sequence_number(100);
    client.set_price(&s(&env, "a1"), &20);
    // The creator, not the caller, authorised the change.
    assert_eq!(env.auths()[0].0, creator);

    let r = client.get(&s(&env, "a1"));
    assert_eq!(r.price, 20);
    assert_eq!(r.updated_at, 100);

    assert_eq!(
        client.try_set_price(&s(&env, "nope"), &5),
        Err(Ok(Error::NotFound))
    );
    assert_eq!(
        client.try_set_price(&s(&env, "a1"), &0),
        Err(Ok(Error::InvalidPrice))
    );
}

#[test]
fn get_unknown_id_is_not_found() {
    let (env, client, _) = setup();
    assert_eq!(
        client.try_get(&s(&env, "missing")),
        Err(Ok(Error::NotFound))
    );
    assert!(!client.exists(&s(&env, "missing")));
    assert_eq!(client.count(), 0);
}
