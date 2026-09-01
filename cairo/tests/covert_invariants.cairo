#[feature("safe_dispatcher")]
mod audits {
    use core::poseidon::poseidon_hash_span;
    use snforge_std::{
        ContractClassTrait, DeclareResultTrait, declare,
        start_cheat_block_timestamp, start_cheat_block_timestamp_global, start_cheat_caller_address,
        stop_cheat_block_timestamp, stop_cheat_block_timestamp_global, stop_cheat_caller_address,
    };
    use starknet::ContractAddress;
use covert::covert_policy::{
    ICovertPolicyDispatcher, ICovertPolicyDispatcherTrait,
    ICovertPolicySafeDispatcher, ICovertPolicySafeDispatcherTrait,
};
use covert::covert_anonymizer::{
    ICovertAnonymizerDispatcher, ICovertAnonymizerDispatcherTrait,
    ICovertAnonymizerSafeDispatcher, ICovertAnonymizerSafeDispatcherTrait,
    OpenNoteDeposit,
};
use covert::mock_token::{IMockTokenDispatcher, IMockTokenDispatcherTrait};
use covert::mock_strk20_pool::{
    IMockStrk20PoolDispatcher, IMockStrk20PoolDispatcherTrait,
    IMockStrk20PoolSafeDispatcher, IMockStrk20PoolSafeDispatcherTrait,
};

const PREMIUM_1: u128 = 10000000000000000;
const PAYOUT_1: u128 = 50000000000000000;
const TERM_1: u64 = 604800;
const PREMIUM_2: u128 = 20000000000000000;
const PAYOUT_2: u128 = 100000000000000000;
const TERM_2: u64 = 1209600;
const PREMIUM_3: u128 = 40000000000000000;
const PAYOUT_3: u128 = 200000000000000000;
const TERM_3: u64 = 2592000;
const RESERVE: u128 = 1000000000000000000;

// Signer A (BOB): private key 0x112233445566778899aabbccddeeff00112233445566778899aabbccddee
// All signatures are deterministic ECDSA over the exact poseidon messages the contract verifies.
const BOB_PUB: felt252 = 0x33ce6e7c74475b8fba787ea2ae58b5544101582ca6e81c543496ecf3468de08;
const POLICY_A: felt252 = 0x4573a9d16589929abc4b9dd96b7037cdd2579b9c4a421ceb0db8b4224d46773;
const INCIDENT_A: felt252 = 0x696e636964656e742d76312d746573742d64617461;
const CLAIM_A: felt252 = 0x3834360d5d096dee266e59015a5618ad4f2acc5fa7ad6a5a94ade9e9fcc49a5;
const SIG_CLAIM_A_R: felt252 = 0x6226e0e7357a5585a82d7e7c7dab9af9665a38344ff882c62ebed9d2560a536;
const SIG_CLAIM_A_S: felt252 = 0x16e0e2bb8c3274180538f1cfedbc923847e17ded9978a075f365d4826a94350;
const SIG_REDEEM_A_R: felt252 = 0x6f42caee4b078b1318780b21c3a5dbd9da66d91517a827bf72ee2320c08f64a;
const SIG_REDEEM_A_S: felt252 = 0x2685a41c260d9f3ce00b287c293f8cf3d3ed59965e2d51c12566947c97eb4a3;

// Signer B (CAROL): private key 0x22110099ffeeddccbbaa88776655443322110099ffeeddccbbaa8877665544
const CAROL_PUB: felt252 = 0x409a14dd3955b72dfb50ad0ec99dd742a4a1a1c6e8b75e8e7fe69e193c1e832;
const POLICY_B: felt252 = 0x60b16ccd2903a21c3ea44edf2ef5c0f7a98c72b24798b6264ffa3a95fc15bd4;
const INCIDENT_B: felt252 = 0x636c61696d2d76322d696e636964656e742d64617461;
const CLAIM_B: felt252 = 0x532ade590732f602d1b5d9e94e745f4e5573fe63c6230668b655b174e4011c;
const SIG_CLAIM_B_R: felt252 = 0x3b323c6041a200232355de913e499978b3e85b469f95933f569a365e6e86865;
const SIG_CLAIM_B_S: felt252 = 0x1cc4bd9032a62bc926c103645c78c4548038b66a025455a2f1bfa8b3d55c770;
const SIG_REDEEM_B_R: felt252 = 0x59f8a51771eb3b82819468dec6bb074859b37ca0c3faf1d6c28928d4e5389cd;
const SIG_REDEEM_B_S: felt252 = 0x2ebbd9a3e0fb8b3299efc15286cbc874364f9dfef45ccf00477924e9c8ac836;

const ADJUDICATION_WINDOW: u64 = 259200;

const OP_BUY: felt252 = 1;
const OP_CLAIM: felt252 = 2;
const OP_REDEEM: felt252 = 3;

fn owner() -> ContractAddress { 'owner'.try_into().unwrap() }
fn adjudicator() -> ContractAddress { 'adjudicator'.try_into().unwrap() }
fn anonymizer_actor() -> ContractAddress { 'anonymizer'.try_into().unwrap() }
fn pool_actor() -> ContractAddress { 'pool'.try_into().unwrap() }
fn attacker() -> ContractAddress { 'attacker'.try_into().unwrap() }

fn deploy_token() -> (IMockTokenDispatcher, ContractAddress) {
    let class = declare("MockToken").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    (IMockTokenDispatcher { contract_address: address }, address)
}

fn deploy_policy(token_address: ContractAddress) -> (ICovertPolicyDispatcher, ContractAddress) {
    let class = declare("CovertPolicy").unwrap().contract_class();
    let calldata = array![owner().into(), adjudicator().into(), token_address.into()];
    let (address, _) = class.deploy(@calldata).unwrap();
    (ICovertPolicyDispatcher { contract_address: address }, address)
}

fn deploy_anonymizer(
    policy_address: ContractAddress, pool: ContractAddress, token_address: ContractAddress,
) -> (ICovertAnonymizerDispatcher, ContractAddress) {
    let class = declare("CovertAnonymizer").unwrap().contract_class();
    let calldata = array![policy_address.into(), pool.into(), token_address.into()];
    let (address, _) = class.deploy(@calldata).unwrap();
    (ICovertAnonymizerDispatcher { contract_address: address }, address)
}

fn fund(
    token: IMockTokenDispatcher,
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    anon: ContractAddress,
    amount: u128,
) {
    token.mint(owner(), amount.into());
    start_cheat_caller_address(policy_address, owner());
    policy.configure_anonymizer(anon);
    policy.fund_reserve(amount);
    stop_cheat_caller_address(policy_address);
}

fn configure_and_fund(
    token: IMockTokenDispatcher,
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    anon: ContractAddress,
) {
    fund(token, policy, policy_address, anon, RESERVE);
}

fn fund_only(
    token: IMockTokenDispatcher,
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    amount: u128,
) {
    token.mint(owner(), amount.into());
    start_cheat_caller_address(policy_address, owner());
    policy.fund_reserve(amount);
    stop_cheat_caller_address(policy_address);
}

fn purchase_direct(
    token: IMockTokenDispatcher,
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    anon: ContractAddress,
    commitment: felt252,
    owner_key: felt252,
    tier: u8,
    paid_amount: u128,
    timestamp: u64,
) {
    token.mint(anon, paid_amount.into());
    start_cheat_caller_address(policy_address, anon);
    start_cheat_block_timestamp(policy_address, timestamp);
    policy.buy_policy(commitment, owner_key, tier, paid_amount);
    stop_cheat_block_timestamp(policy_address);
    stop_cheat_caller_address(policy_address);
}

fn submit_claim_direct(
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    anon: ContractAddress,
    policy_commitment: felt252,
    claim_commitment: felt252,
    incident_hash: felt252,
    sig_r: felt252,
    sig_s: felt252,
) {
    start_cheat_caller_address(policy_address, anon);
    policy.submit_claim(policy_commitment, claim_commitment, incident_hash, sig_r, sig_s);
    stop_cheat_caller_address(policy_address);
}

fn redeem_direct(
    policy: ICovertPolicyDispatcher,
    policy_address: ContractAddress,
    anon: ContractAddress,
    policy_commitment: felt252,
    claim_commitment: felt252,
    sig_r: felt252,
    sig_s: felt252,
) -> u128 {
    start_cheat_caller_address(policy_address, anon);
    let payout = policy.redeem_claim(policy_commitment, claim_commitment, sig_r, sig_s);
    stop_cheat_caller_address(policy_address);
    payout
}

fn revert_felt<T, impl TDrop: Drop<T>>(result: Result<T, Array<felt252>>) -> felt252 {
    match result {
        Result::Ok(_) => panic!("expected a revert"),
        Result::Err(pd) => *pd.at(0),
    }
}

fn open_note_single(result: Result<Span<OpenNoteDeposit>, Array<felt252>>) -> OpenNoteDeposit {
    match result {
        Result::Ok(mut span) => match span.pop_front() {
            Option::Some(note) => *note,
            Option::None => panic!("expected one open note"),
        },
        Result::Err(_) => panic!("expected success"),
    }
}

#[test]
fn tier_one_expiry_is_contract_derived_and_exposure_is_accounted() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    let timestamp = 1_000_000_u64;
    purchase_direct(token, policy, policy_address, anon, 0x111, 0x222, 1, PREMIUM_1, timestamp);

    let (exists, tier, owner_key, expiry, active, claimed, has_claim) = policy.policy_state(0x111);
    assert(exists, 'policy missing');
    assert(tier == 1, 'wrong tier');
    assert(owner_key == 0x222, 'wrong key');
    assert(expiry == timestamp + TERM_1, 'client controls expiry');
    assert(active && !claimed && !has_claim, 'bad initial state');
    assert(policy.exposure() == PAYOUT_1, 'bad exposure');
    assert(policy.reserve() == RESERVE + PREMIUM_1, 'bad reserve');
}

#[test]
fn wrong_tier_is_rejected_everywhere() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(revert_felt(safe.buy_policy(0xAAA, 0xBBB, 0, PREMIUM_1)) == 'BAD_TIER', 'tier 0 accepted');
    assert(revert_felt(safe.buy_policy(0xAAA, 0xBBB, 4, PREMIUM_1)) == 'BAD_TIER', 'tier 4 accepted');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn wrong_premium_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(revert_felt(safe.buy_policy(0xCCC, 0xDDD, 1, PREMIUM_1 + 1)) == 'BAD_PREMIUM', 'overpay accepted');
    assert(revert_felt(safe.buy_policy(0xCCC, 0xDDD, 1, PREMIUM_1 - 1)) == 'BAD_PREMIUM', 'underpay accepted');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn duplicate_policy_commitment_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    token.mint(anon, (PREMIUM_1 * 2).into());
    start_cheat_caller_address(policy_address, anon);
    policy.buy_policy(0xEEE, 0xEEE2, 1, PREMIUM_1);
    assert(
        revert_felt(safe.buy_policy(0xEEE, 0xEEE3, 1, PREMIUM_1)) == 'POLICY_EXISTS',
        'commitment reused',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn zero_bearer_key_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(revert_felt(safe.buy_policy(0x1234, 0, 1, PREMIUM_1)) == 'BAD_KEY', 'zero bearer key');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn zero_commitment_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(revert_felt(safe.buy_policy(0, BOB_PUB, 1, PREMIUM_1)) == 'BAD_COMMITMENT', 'zero commitment');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn reserve_capacity_failure_blocks_issuance() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();

    // Configure the anonymizer without funding any reserve.
    start_cheat_caller_address(policy_address, owner());
    policy.configure_anonymizer(anon);
    stop_cheat_caller_address(policy_address);

    // No reserve at all: tier-1 exposure (0.05) exceeds reserve + incoming premium.
    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(
        revert_felt(safe.buy_policy(0x777, 0x888, 1, PREMIUM_1)) == 'INSOLVENT',
        'unfunded reserve issued cover',
    );
    stop_cheat_caller_address(policy_address);

    // Funded below the tier-1 insolvency line (reserve < payout - premium): still insolvent.
    fund_only(token, policy, policy_address, PAYOUT_1 - PREMIUM_1 - 1);
    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    assert(
        revert_felt(safe.buy_policy(0x777, 0x888, 1, PREMIUM_1)) == 'INSOLVENT',
        'over-leveraged issuance',
    );
    stop_cheat_caller_address(policy_address);

    // Boundary: reserve + incoming premium exactly equals the new exposure.
    fund_only(token, policy, policy_address, 1);
    start_cheat_caller_address(policy_address, anon);
    token.mint(anon, PREMIUM_1.into());
    policy.buy_policy(0x777, 0x888, 1, PREMIUM_1);
    stop_cheat_caller_address(policy_address);
    assert(policy.exposure() == PAYOUT_1, 'boundary buy not issued');
}

#[test]
fn exposure_is_accumulated_exactly_across_tiers_and_released_on_expiry() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    let timestamp = 1_000_000_u64;

    purchase_direct(token, policy, policy_address, anon, 0xA1, BOB_PUB, 1, PREMIUM_1, timestamp);
    purchase_direct(token, policy, policy_address, anon, 0xA2, CAROL_PUB, 2, PREMIUM_2, timestamp);
    purchase_direct(token, policy, policy_address, anon, 0xA3, BOB_PUB, 3, PREMIUM_3, timestamp);

    assert(policy.exposure() == PAYOUT_1 + PAYOUT_2 + PAYOUT_3, 'exposure not summed');

    start_cheat_block_timestamp(policy_address, timestamp + TERM_2 + 1);
    policy.expire_policy(0xA2);
    stop_cheat_block_timestamp(policy_address);
    assert(policy.exposure() == PAYOUT_1 + PAYOUT_3, 'expiry release wrong');
}

#[test]
fn policy_cannot_be_created_before_anonymizer_is_configured() {
    let (token, token_address) = deploy_token();
    let (_policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };

    token.mint(anonymizer_actor(), PREMIUM_1.into());
    start_cheat_caller_address(policy_address, anonymizer_actor());
    assert(
        revert_felt(safe.buy_policy(0x8888, BOB_PUB, 1, PREMIUM_1)) == 'NOT_CONFIGURED',
        'policy before anonymizer',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn only_configured_anonymizer_can_purchase_cover() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    token.mint(attacker(), PREMIUM_1.into());
    start_cheat_caller_address(policy_address, attacker());
    match safe.buy_policy(0x777, 0x888, 1, PREMIUM_1) {
        Result::Ok(_) => panic!("non anonymizer purchased cover"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(policy_address);
    let (exists, _, _, _, _, _, _) = policy.policy_state(0x777);
    assert(!exists, 'unauthorized policy persisted');
}

#[test]
fn public_observer_cannot_consume_policy_claim_slot_with_bad_signature() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, 0x333, 0x444, 1, PREMIUM_1, 2_000_000_u64);

    let incident_hash: felt252 = 0xabc;
    let claim = poseidon_hash_span(array![0x333, incident_hash].span());
    start_cheat_caller_address(policy_address, anon);
    match safe.submit_claim(0x333, claim, incident_hash, 1, 1) {
        Result::Ok(_) => panic!("invalid bearer signature accepted"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(policy_address);

    let (_, _, _, _, _, _, has_claim) = policy.policy_state(0x333);
    let (claim_exists, _, _, _, _) = policy.claim_state(claim);
    assert(!has_claim, 'claim slot griefed');
    assert(!claim_exists, 'invalid claim persisted');
}

#[test]
fn malformed_claim_commitment_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, 0xdead, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S))
            == 'BAD_COMMITMENT',
        'unbound claim commitment',
    );
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_A, 0, SIG_CLAIM_A_R, SIG_CLAIM_A_S))
            == 'BAD_COMMITMENT',
        'zero incident accepted',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn claim_commitment_must_bind_policy_and_incident_before_signature_check() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, 0x555, 0x666, 1, PREMIUM_1, 3_000_000_u64);

    start_cheat_caller_address(policy_address, anon);
    match safe.submit_claim(0x555, 0xdead, 0xbeef, 1, 1) {
        Result::Ok(_) => panic!("unbound claim commitment accepted"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(policy_address);

    let (_, _, _, _, _, _, has_claim) = policy.policy_state(0x555);
    assert(!has_claim, 'bad commitment used slot');
}

#[test]
fn valid_claim_submission_records_authenticated_state() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    let (claim_exists, claim_policy, claim_incident, decision, redeemed) = policy.claim_state(CLAIM_A);
    assert(claim_exists, 'claim not recorded');
    assert(claim_policy == POLICY_A, 'claim policy binding wrong');
    assert(claim_incident == INCIDENT_A, 'claim incident wrong');
    assert(decision == 0, 'claim not pending');
    assert(!redeemed, 'claim redeemed at submission');
    let (_, _, _, _, _, _, has_claim) = policy.policy_state(POLICY_A);
    assert(has_claim, 'policy claim slot not consumed');
}

#[test]
fn duplicate_claim_on_same_policy_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S))
            == 'POLICY_HAS_CLAIM',
        'second claim accepted',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn claim_after_expiry_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    let timestamp = 2_000_000_u64;
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, timestamp);

    start_cheat_block_timestamp(policy_address, timestamp + TERM_1 + 1);
    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S)) == 'EXPIRED',
        'late claim accepted',
    );
    stop_cheat_caller_address(policy_address);
    stop_cheat_block_timestamp(policy_address);
}

#[test]
fn claim_before_policy_exists_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S))
            == 'POLICY_MISSING',
        'claim on missing policy',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn failed_claim_leaves_state_unchanged() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_A, INCIDENT_A, 1, 1)) == 'BAD_SIGNATURE',
        'bad bearer signature accepted',
    );
    stop_cheat_caller_address(policy_address);

    let (_, _, _, _, _, _, has_claim) = policy.policy_state(POLICY_A);
    let (claim_exists, _, _, _, _) = policy.claim_state(CLAIM_A);
    assert(!has_claim && !claim_exists, 'failed claim mutated state');
    assert(policy.exposure() == PAYOUT_1, 'exposure mutated');
}

#[test]
fn claim_for_inactive_policy_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);
    start_cheat_caller_address(policy_address, adjudicator());
    policy.deny_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.submit_claim(POLICY_A, CLAIM_B, INCIDENT_B, SIG_CLAIM_B_R, SIG_CLAIM_B_S))
            == 'POLICY_MISSING',
        'claim on inactive policy',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn unauthorized_approval_and_denial_are_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, attacker());
    assert(revert_felt(safe.approve_claim(CLAIM_A)) == 'NOT_ADJUDICATOR', 'attacker approved');
    assert(revert_felt(safe.deny_claim(CLAIM_A)) == 'NOT_ADJUDICATOR', 'attacker denied');
    stop_cheat_caller_address(policy_address);

    start_cheat_caller_address(policy_address, owner());
    assert(revert_felt(safe.approve_claim(CLAIM_A)) == 'NOT_ADJUDICATOR', 'owner approved');
    stop_cheat_caller_address(policy_address);

    let (_, _, _, decision, _) = policy.claim_state(CLAIM_A);
    assert(decision == 0, 'decision changed');
}

#[test]
fn approve_and_deny_missing_claim_are_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    configure_and_fund(token, policy, policy_address, anonymizer_actor());

    start_cheat_caller_address(policy_address, adjudicator());
    assert(revert_felt(safe.approve_claim(0x9999)) == 'CLAIM_MISSING', 'approved phantom claim');
    assert(revert_felt(safe.deny_claim(0x9999)) == 'CLAIM_MISSING', 'denied phantom claim');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn approval_twice_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    assert(revert_felt(safe.approve_claim(CLAIM_A)) == 'DECIDED', 'approved twice');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn denial_twice_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.deny_claim(CLAIM_A);
    assert(revert_felt(safe.deny_claim(CLAIM_A)) == 'DECIDED', 'denied twice');
    stop_cheat_caller_address(policy_address);
}

#[test]
fn denial_releases_exposure_and_deactivates_policy() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    assert(policy.exposure() == PAYOUT_1, 'exposure not opened');

    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);
    let reserve_before = policy.reserve();
    start_cheat_caller_address(policy_address, adjudicator());
    policy.deny_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    assert(policy.exposure() == 0, 'exposure not released on denial');
    assert(policy.reserve() == reserve_before, 'denial touched reserve');
    let (_, _, _, _, active, _, _) = policy.policy_state(POLICY_A);
    assert(!active, 'policy active after denial');
    let (_, _, _, decision, _) = policy.claim_state(CLAIM_A);
    assert(decision == 2, 'claim not denied');
}

#[test]
fn adjudicator_cannot_fund_reserve_or_alter_economics() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    configure_and_fund(token, policy, policy_address, anonymizer_actor());

    start_cheat_caller_address(policy_address, adjudicator());
    assert(revert_felt(safe.fund_reserve(1)) == 'NOT_OWNER', 'adjudicator funded reserve');
    assert(revert_felt(safe.configure_anonymizer(attacker())) == 'NOT_OWNER', 'adjudicator reconfigured');
    stop_cheat_caller_address(policy_address);
    assert(policy.reserve() == RESERVE, 'reserve altered');
}

#[test]
fn expired_unused_policy_releases_exposure() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    let timestamp = 4_000_000_u64;
    purchase_direct(token, policy, policy_address, anon, 0x999, 0xaaa, 1, PREMIUM_1, timestamp);
    assert(policy.exposure() == PAYOUT_1, 'exposure not opened');

    start_cheat_block_timestamp(policy_address, timestamp + TERM_1 + 1);
    policy.expire_policy(0x999);
    stop_cheat_block_timestamp(policy_address);

    assert(policy.exposure() == 0, 'exposure not released');
    let (_, _, _, _, active, _, _) = policy.policy_state(0x999);
    assert(!active, 'expired policy active');
}

#[test]
fn expiry_requires_term_end_and_is_single_use() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    let timestamp = 4_000_000_u64;
    purchase_direct(token, policy, policy_address, anon, 0x999, 0xaaa, 1, PREMIUM_1, timestamp);

    start_cheat_block_timestamp(policy_address, timestamp + TERM_1);
    assert(
        revert_felt(safe.expire_policy(0x999)) == 'NOT_EXPIRED',
        'expired at term boundary',
    );
    start_cheat_block_timestamp(policy_address, timestamp + TERM_1 + 1);
    policy.expire_policy(0x999);
    assert(
        revert_felt(safe.expire_policy(0x999)) == 'POLICY_MISSING',
        'expired policy expired twice',
    );
    stop_cheat_block_timestamp(policy_address);
}

#[test]
fn settlement_before_approval_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S)) == 'NOT_APPROVED',
        'settled before approval',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn settlement_after_denial_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.deny_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S)) == 'NOT_APPROVED',
        'settled after denial',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn settlement_with_bad_redemption_signature_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, 1, 1)) == 'BAD_SIGNATURE',
        'bad redemption signature',
    );
    stop_cheat_caller_address(policy_address);
    let (_, _, _, _, redeemed) = policy.claim_state(CLAIM_A);
    assert(!redeemed, 'bad sig redeem mutated');
}

#[test]
fn settlement_with_wrong_policy_binding_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_B, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S)) == 'CLAIM_MISSING',
        'redeemed wrong policy',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn settlement_for_missing_or_unapproved_claim_is_rejected() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S)) == 'CLAIM_MISSING',
        'redeemed missing claim',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn valid_settlement_pays_fixed_payout_and_consumes_replay_state() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 2_000_000_u64);
    submit_claim_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);

    let reserve_before = policy.reserve();
    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    let payout = redeem_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S);
    assert(payout == PAYOUT_1, 'payout not fixed tier value');
    assert(policy.reserve() == reserve_before - PAYOUT_1, 'reserve not decreased once');
    assert(policy.exposure() == 0, 'exposure not released once');
    assert(token.balance_of(anon) == PAYOUT_1.into(), 'payout did not reach anonymizer');

    let (_, _, _, _, redeemed) = policy.claim_state(CLAIM_A);
    assert(redeemed, 'claim not marked redeemed');
    let (_, _, _, _, active, claimed, _) = policy.policy_state(POLICY_A);
    assert(!active && claimed, 'policy not consumed');

    start_cheat_caller_address(policy_address, anon);
    assert(
        revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S)) == 'CLAIMED',
        'replay settlement succeeded',
    );
    stop_cheat_caller_address(policy_address);
}

#[test]
fn pool_routed_purchase_traverses_anonymizer_and_policy() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());
    let output = anon.privacy_invoke(
        OP_BUY, token.contract_address, pool_actor(), policy.contract_address,
        0x1234, 0x5678, 1, 0, 0, 0,
    );
    stop_cheat_caller_address(anon_address);

    assert(output.len() == 0, 'purchase opened note');
    assert(anon.invoke_count() == 1, 'invoke not counted');
    let (exists, tier, _, _, active, _, _) = policy.policy_state(0x1234);
    assert(exists && active && tier == 1, 'policy not purchased');
    assert(token.balance_of(anon_address) == 0, 'premium stranded');
}

#[test]
fn full_stack_claim_approve_settle_returns_exact_open_note_deposit() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());
    anon.privacy_invoke(
        OP_BUY, token.contract_address, pool_actor(), policy.contract_address,
        POLICY_A, BOB_PUB, 1, 0, 0, 0,
    );
    anon.privacy_invoke(
        OP_CLAIM, token.contract_address, pool_actor(), policy.contract_address,
        POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S, 0,
    );
    stop_cheat_caller_address(anon_address);

    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    let reserve_before = policy.reserve();
    let note_id = 0xfeedface;
    start_cheat_caller_address(anon_address, pool_actor());
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };
    let note = open_note_single(
        safe.privacy_invoke(
            OP_REDEEM, token.contract_address, pool_actor(), policy.contract_address,
            POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S, 0, note_id,
        ),
    );
    stop_cheat_caller_address(anon_address);

    assert(note.note_id == note_id, 'note id mismatch');
    assert(note.token == token_address, 'note token mismatch');
    assert(note.amount == PAYOUT_1, 'note amount not exact payout');
    assert(policy.reserve() == reserve_before - PAYOUT_1, 'reserve not settled');
    assert(policy.exposure() == 0, 'exposure not released');
    assert(token.balance_of(anon_address) == PAYOUT_1.into(), 'anonymizer payout missing');
    let (_, _, _, _, redeemed) = policy.claim_state(CLAIM_A);
    assert(redeemed, 'claim not redeemed');
    let (_, _, _, _, active, claimed, _) = policy.policy_state(POLICY_A);
    assert(!active && claimed, 'policy not consumed');
}

#[test]
fn anonymizer_rejects_wrong_pool_caller() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, attacker());
    match safe.privacy_invoke(
        OP_BUY, token.contract_address, pool_actor(), policy.contract_address,
        0x2222, 0x3333, 1, 0, 0, 0,
    ) {
        Result::Ok(_) => panic!("wrong pool caller accepted"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(anon_address);
}

#[test]
fn anonymizer_rejects_wrong_pool_argument() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());
    assert(
        revert_felt(
            safe.privacy_invoke(
                OP_BUY, token.contract_address, attacker(), policy.contract_address,
                0x2222, 0x3333, 1, 0, 0, 0,
            ),
        ) == 'BAD_POOL',
        'wrong supplied pool accepted',
    );
    stop_cheat_caller_address(anon_address);
}

#[test]
fn anonymizer_rejects_wrong_policy_argument() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());
    assert(
        revert_felt(
            safe.privacy_invoke(
                OP_BUY, token.contract_address, pool_actor(), attacker(),
                0x2222, 0x3333, 1, 0, 0, 0,
            ),
        ) == 'BAD_POLICY',
        'wrong supplied policy accepted',
    );
    stop_cheat_caller_address(anon_address);
}

#[test]
fn anonymizer_rejects_wrong_token_argument() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());
    assert(
        revert_felt(
            safe.privacy_invoke(
                OP_BUY, attacker(), pool_actor(), policy.contract_address,
                0x2222, 0x3333, 1, 0, 0, 0,
            ),
        ) == 'BAD_TOKEN',
        'wrong supplied token accepted',
    );
    stop_cheat_caller_address(anon_address);
}

#[test]
fn anonymizer_rejects_dust_or_subsidized_purchase_balance() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, (PREMIUM_1 + 1).into());
    start_cheat_caller_address(anon_address, pool_actor());
    match safe.privacy_invoke(
        OP_BUY, token.contract_address, pool_actor(), policy.contract_address,
        0x4444, 0x5555, 1, 0, 0, 0,
    ) {
        Result::Ok(_) => panic!("non-exact premium accepted"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(anon_address);
    let (exists, _, _, _, _, _, _) = policy.policy_state(0x4444);
    assert(!exists, 'dust purchase persisted');
}

#[test]
fn anonymizer_rejects_subsidized_underpaid_balance() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, (PREMIUM_1 - 1).into());
    start_cheat_caller_address(anon_address, pool_actor());
    assert(
        revert_felt(
            safe.privacy_invoke(
                OP_BUY, token.contract_address, pool_actor(), policy.contract_address,
                0x4444, 0x5555, 1, 0, 0, 0,
            ),
        ) == 'BAD_INPUT_AMOUNT',
        'subsidized balance accepted',
    );
    stop_cheat_caller_address(anon_address);
    let (exists, _, _, _, _, _, _) = policy.policy_state(0x4444);
    assert(!exists, 'subsidized purchase persisted');
}

#[test]
fn anonymizer_rejects_unused_argument_smuggling() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_actor(), token_address);
    configure_and_fund(token, policy, policy_address, anon_address);
    let safe = ICovertAnonymizerSafeDispatcher { contract_address: anon_address };

    token.mint(anon_address, PREMIUM_1.into());
    start_cheat_caller_address(anon_address, pool_actor());

    assert(
        revert_felt(
            safe.privacy_invoke(OP_BUY, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 1, 1, 0, 0),
        ) == 'BAD_OP',
        'buy smuggled arg3',
    );
    assert(
        revert_felt(
            safe.privacy_invoke(OP_BUY, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 1, 0, 1, 0),
        ) == 'BAD_OP',
        'buy smuggled arg4',
    );
    assert(
        revert_felt(
            safe.privacy_invoke(OP_BUY, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 1, 0, 0, 1),
        ) == 'BAD_OP',
        'buy smuggled note_id',
    );
    assert(
        revert_felt(
            safe.privacy_invoke(OP_CLAIM, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 0x33, 0x44, 0x55, 7),
        ) == 'BAD_OP',
        'claim smuggled note_id',
    );
    assert(
        revert_felt(
            safe.privacy_invoke(OP_REDEEM, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 0x33, 0x44, 1, 0),
        ) == 'BAD_OP',
        'redeem smuggled arg4',
    );
    assert(
        revert_felt(
            safe.privacy_invoke(OP_BUY, token.contract_address, pool_actor(), policy.contract_address, 0x11, 0x22, 0x123456789, 0, 0, 0),
        ) != 0,
        'unknown op accepted',
    );

    stop_cheat_caller_address(anon_address);
    assert(policy.exposure() == 0, 'smuggled args changed state');
}

#[test]
fn anonymizer_constructor_rejects_zero_addresses() {
    let (token, token_address) = deploy_token();
    let class = declare("CovertAnonymizer").unwrap().contract_class();
    let bad = array![attacker().into(), attacker().into(), 0.into()];
    match class.deploy(@bad) {
        Result::Ok(_) => panic!("zero token address accepted"),
        Result::Err(_) => {},
    };
    let _ = token;
    let _ = token_address;
}

#[test]
fn policy_constructor_rejects_zero_addresses() {
    let class = declare("CovertPolicy").unwrap().contract_class();
    let bad = array![owner().into(), adjudicator().into(), 0.into()];
    match class.deploy(@bad) {
        Result::Ok(_) => panic!("zero token address accepted"),
        Result::Err(_) => {},
    };
}

#[test]
fn policy_configuration_read_back_matches_deployment_and_locks_once() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);

    assert(policy.owner() == owner(), 'owner view wrong');
    assert(policy.adjudicator() == adjudicator(), 'adjudicator view wrong');
    assert(policy.anonymizer() == anon, 'anonymizer view wrong');
    assert(policy.token() == token_address, 'token view wrong');

    // The anonymizer can never be replaced: a second configure reverts.
    start_cheat_caller_address(policy_address, owner());
    assert(
        revert_felt(safe.configure_anonymizer(attacker())) == 'ALREADY_CONFIGURED',
        'anonymizer replaced',
    );
    stop_cheat_caller_address(policy_address);
    assert(policy.anonymizer() == anon, 'anonymizer changed');
}

#[test]
fn only_adjudicator_can_decide_claims_even_before_claim_lookup() {
    let (_token, token_address) = deploy_token();
    let (_policy, policy_address) = deploy_policy(token_address);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    start_cheat_caller_address(policy_address, attacker());
    match safe.approve_claim(0x123) {
        Result::Ok(_) => panic!("attacker approved claim"),
        Result::Err(_) => {},
    };
    stop_cheat_caller_address(policy_address);
}


// =====================================================================
// Adjudication liveness: an abandoned claim must not lock reserve capital
// forever, but must not be closable before its deadline either.
// =====================================================================

fn claimed_policy_at(
    timestamp: u64,
) -> (IMockTokenDispatcher, ICovertPolicyDispatcher, ContractAddress, ContractAddress) {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, timestamp);

    start_cheat_caller_address(policy_address, anon);
    start_cheat_block_timestamp(policy_address, timestamp);
    policy.submit_claim(POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S);
    stop_cheat_block_timestamp(policy_address);
    stop_cheat_caller_address(policy_address);
    (token, policy, policy_address, anon)
}

#[test]
fn claim_deadline_is_submission_time_plus_window() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, _policy_address, _anon) = claimed_policy_at(submitted_at);
    assert(policy.adjudication_window() == ADJUDICATION_WINDOW, 'window changed');
    assert(policy.claim_deadline(CLAIM_A) == submitted_at + ADJUDICATION_WINDOW, 'bad deadline');
    // A claim that does not exist reports no deadline rather than a bare window.
    assert(policy.claim_deadline(0xdead) == 0, 'phantom deadline');
}

#[test]
fn stale_claim_cannot_be_closed_before_its_deadline() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, policy_address, _anon) = claimed_policy_at(submitted_at);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };

    // One second before the deadline the adjudicator still owns the decision.
    start_cheat_block_timestamp(policy_address, submitted_at + ADJUDICATION_WINDOW);
    let reason = revert_felt(safe.expire_stale_claim(CLAIM_A));
    stop_cheat_block_timestamp(policy_address);
    assert(reason == 'NOT_STALE', 'wrong reason before deadline');
    assert(policy.exposure() == PAYOUT_1, 'exposure released early');
}

#[test]
fn stale_claim_closes_after_deadline_and_releases_exposure() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, policy_address, _anon) = claimed_policy_at(submitted_at);
    assert(policy.exposure() == PAYOUT_1, 'exposure not reserved');
    let reserve_before = policy.reserve();

    // Anyone may close it once the window has elapsed: this is a liveness escape,
    // not a privileged action.
    start_cheat_caller_address(policy_address, attacker());
    start_cheat_block_timestamp(policy_address, submitted_at + ADJUDICATION_WINDOW + 1);
    policy.expire_stale_claim(CLAIM_A);
    stop_cheat_block_timestamp(policy_address);
    stop_cheat_caller_address(policy_address);

    assert(policy.exposure() == 0, 'exposure not released');
    assert(policy.reserve() == reserve_before, 'reserve moved on timeout');
    let (_, _, _, decision, redeemed) = policy.claim_state(CLAIM_A);
    assert(decision == 2, 'claim not closed');
    assert(!redeemed, 'timeout paid out');
    let (_, _, _, _, active, claimed, _) = policy.policy_state(POLICY_A);
    assert(!active, 'policy still active');
    assert(!claimed, 'timeout marked as paid');
}

#[test]
fn timed_out_claim_cannot_then_be_settled() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, policy_address, anon) = claimed_policy_at(submitted_at);
    start_cheat_block_timestamp(policy_address, submitted_at + ADJUDICATION_WINDOW + 1);
    policy.expire_stale_claim(CLAIM_A);
    stop_cheat_block_timestamp(policy_address);

    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    start_cheat_caller_address(policy_address, anon);
    let reason = revert_felt(safe.redeem_claim(POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S));
    stop_cheat_caller_address(policy_address);
    assert(reason == 'NOT_APPROVED', 'timed-out claim settled');
}

#[test]
fn timed_out_claim_cannot_be_closed_twice() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, policy_address, _anon) = claimed_policy_at(submitted_at);
    start_cheat_block_timestamp(policy_address, submitted_at + ADJUDICATION_WINDOW + 1);
    policy.expire_stale_claim(CLAIM_A);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let reason = revert_felt(safe.expire_stale_claim(CLAIM_A));
    stop_cheat_block_timestamp(policy_address);
    assert(reason == 'DECIDED', 'double timeout allowed');
}

#[test]
fn decided_claim_cannot_be_timed_out() {
    let submitted_at = 1_000_000_u64;
    let (_token, policy, policy_address, _anon) = claimed_policy_at(submitted_at);
    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    start_cheat_block_timestamp(policy_address, submitted_at + ADJUDICATION_WINDOW + 5);
    let reason = revert_felt(safe.expire_stale_claim(CLAIM_A));
    stop_cheat_block_timestamp(policy_address);
    assert(reason == 'DECIDED', 'approved claim timed out');
}

#[test]
fn timing_out_a_claim_that_does_not_exist_is_rejected() {
    let (token, token_address) = deploy_token();
    let (_policy, policy_address) = deploy_policy(token_address);
    let _ = token;
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };
    let reason = revert_felt(safe.expire_stale_claim(0xabc));
    assert(reason == 'CLAIM_MISSING', 'phantom claim timed out');
}

// =====================================================================
// Reserve surplus: capital that backs nothing must be recoverable, and
// capital that backs an outstanding policy must not be.
// =====================================================================

#[test]
fn free_reserve_tracks_exposure_and_saturates_at_zero() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    assert(policy.free_reserve() == RESERVE, 'free reserve wrong');

    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 1_000_000);
    // Premium joins the reserve, payout becomes exposure.
    assert(policy.reserve() == RESERVE + PREMIUM_1, 'reserve missing premium');
    assert(policy.exposure() == PAYOUT_1, 'exposure wrong');
    assert(policy.free_reserve() == RESERVE + PREMIUM_1 - PAYOUT_1, 'free reserve wrong');
}

#[test]
fn owner_can_withdraw_only_unbacked_reserve() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 1_000_000);

    let surplus = policy.free_reserve();
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };

    // One wei beyond the surplus would start eating the outstanding policy's backing.
    start_cheat_caller_address(policy_address, owner());
    let reason = revert_felt(safe.withdraw_surplus(surplus + 1, owner()));
    assert(reason == 'NO_SURPLUS', 'over-withdraw allowed');

    policy.withdraw_surplus(surplus, owner());
    stop_cheat_caller_address(policy_address);

    assert(policy.free_reserve() == 0, 'surplus not drained');
    assert(policy.reserve() == PAYOUT_1, 'backing removed');
    assert(policy.exposure() == PAYOUT_1, 'exposure changed');
    assert(token.balance_of(owner()) == surplus.into(), 'owner not paid surplus');
}

#[test]
fn surplus_withdrawal_is_owner_only_and_rejects_zero() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    let safe = ICovertPolicySafeDispatcher { contract_address: policy_address };

    start_cheat_caller_address(policy_address, attacker());
    let reason = revert_felt(safe.withdraw_surplus(1, attacker()));
    stop_cheat_caller_address(policy_address);
    assert(reason == 'NOT_OWNER', 'attacker drained reserve');

    start_cheat_caller_address(policy_address, adjudicator());
    let reason_adj = revert_felt(safe.withdraw_surplus(1, adjudicator()));
    stop_cheat_caller_address(policy_address);
    assert(reason_adj == 'NOT_OWNER', 'adjudicator drained reserve');

    start_cheat_caller_address(policy_address, owner());
    let reason_zero = revert_felt(safe.withdraw_surplus(0, owner()));
    let zero_addr: ContractAddress = 0.try_into().unwrap();
    let reason_addr = revert_felt(safe.withdraw_surplus(1, zero_addr));
    stop_cheat_caller_address(policy_address);
    assert(reason_zero == 'BAD_AMOUNT', 'zero withdraw allowed');
    assert(reason_addr == 'BAD_ADDRESS', 'burn address allowed');
    assert(policy.reserve() == RESERVE, 'reserve moved');
}

#[test]
fn settled_payout_leaves_reserve_withdrawable_but_not_the_paid_amount() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 1_000_000);
    submit_claim_direct(
        policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S,
    );
    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);
    redeem_direct(policy, policy_address, anon, POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S);

    // After settlement nothing is outstanding, so the whole remaining reserve is free.
    assert(policy.exposure() == 0, 'exposure not released');
    assert(policy.free_reserve() == RESERVE + PREMIUM_1 - PAYOUT_1, 'free reserve wrong');
}

#[test]
fn policy_claim_reverse_index_is_populated_on_submission() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let anon = anonymizer_actor();
    configure_and_fund(token, policy, policy_address, anon);
    purchase_direct(token, policy, policy_address, anon, POLICY_A, BOB_PUB, 1, PREMIUM_1, 1_000_000);
    assert(policy.policy_claim(POLICY_A) == 0, 'claim before submission');
    submit_claim_direct(
        policy, policy_address, anon, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S,
    );
    assert(policy.policy_claim(POLICY_A) == CLAIM_A, 'reverse index missing');
}

// =====================================================================
// End-to-end through a pool contract that actually calls the anonymizer.
// No caller cheats: the pool is genuinely the caller the anonymizer pins.
// =====================================================================

fn deploy_pool(token_address: ContractAddress) -> (IMockStrk20PoolDispatcher, ContractAddress) {
    let class = declare("MockStrk20Pool").unwrap().contract_class();
    let (address, _) = class.deploy(@array![token_address.into()]).unwrap();
    (IMockStrk20PoolDispatcher { contract_address: address }, address)
}

fn holder() -> ContractAddress { 'holder'.try_into().unwrap() }

#[test]
fn pool_routed_lifecycle_fails_before_approval_and_succeeds_after() {
    let (token, token_address) = deploy_token();
    let (policy, policy_address) = deploy_policy(token_address);
    let (pool, pool_address) = deploy_pool(token_address);
    let (_anon, anon_address) = deploy_anonymizer(policy_address, pool_address, token_address);
    configure_and_fund(token, policy, policy_address, anon_address);

    let now = 1_700_000_000_u64;
    start_cheat_block_timestamp_global(now);

    // --- shield: public deposit into the pool -----------------------------
    let shield: u128 = 500000000000000000; // 0.5 STRK
    token.mint(holder(), shield.into());
    start_cheat_caller_address(pool_address, holder());
    pool.deposit(shield);
    assert(pool.private_balance(holder()) == shield, 'shield not credited');
    let public_after_shield = token.balance_of(holder());

    // --- activate cover privately ----------------------------------------
    pool.route_buy(anon_address, policy_address, POLICY_A, BOB_PUB, 1, PREMIUM_1);
    let (exists, tier, _, expiry, active, _, _) = policy.policy_state(POLICY_A);
    assert(exists && active, 'policy not active');
    assert(tier == 1, 'wrong tier');
    assert(expiry == now + TERM_1, 'expiry not contract derived');
    assert(pool.private_balance(holder()) == shield - PREMIUM_1, 'premium not debited');

    // --- file the authenticated claim ------------------------------------
    pool.route_claim(
        anon_address, policy_address, POLICY_A, CLAIM_A, INCIDENT_A, SIG_CLAIM_A_R, SIG_CLAIM_A_S,
    );
    let (claim_exists, claim_policy, _, decision, _) = policy.claim_state(CLAIM_A);
    assert(claim_exists, 'claim not filed');
    assert(claim_policy == POLICY_A, 'claim not bound to policy');
    assert(decision == 0, 'claim pre-decided');

    // --- SETTLEMENT BEFORE APPROVAL MUST FAIL, FOR THIS EXACT REASON ------
    let pool_safe = IMockStrk20PoolSafeDispatcher { contract_address: pool_address };
    let premature = revert_felt(
        pool_safe.route_redeem(
            anon_address, policy_address, POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S, 0x4e4f5445315f,
        ),
    );
    assert(premature == 'NOT_APPROVED', 'premature settlement reason');
    assert(pool.private_balance(holder()) == shield - PREMIUM_1, 'premature settlement paid');
    assert(policy.exposure() == PAYOUT_1, 'exposure changed on reject');
    stop_cheat_caller_address(pool_address);

    // --- adjudicator approves --------------------------------------------
    start_cheat_caller_address(policy_address, adjudicator());
    policy.approve_claim(CLAIM_A);
    stop_cheat_caller_address(policy_address);

    // --- the identical settlement now succeeds ----------------------------
    let reserve_before = policy.reserve();
    start_cheat_caller_address(pool_address, holder());
    let credited = pool.route_redeem(
        anon_address, policy_address, POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S, 0x4e4f5445315f,
    );
    stop_cheat_caller_address(pool_address);

    assert(credited == PAYOUT_1, 'payout not fixed by tier');
    assert(pool.private_balance(holder()) == shield - PREMIUM_1 + PAYOUT_1, 'private delta wrong');
    // The observable consequence: the public wallet balance never moved.
    assert(token.balance_of(holder()) == public_after_shield, 'public wallet was paid');
    assert(policy.reserve() == reserve_before - PAYOUT_1, 'reserve not reconciled');
    assert(policy.exposure() == 0, 'exposure not released');

    // --- and it cannot be drawn twice -------------------------------------
    start_cheat_caller_address(pool_address, holder());
    let replay = revert_felt(
        pool_safe.route_redeem(
            anon_address, policy_address, POLICY_A, CLAIM_A, SIG_REDEEM_A_R, SIG_REDEEM_A_S, 0x4e4f5445325f,
        ),
    );
    stop_cheat_caller_address(pool_address);
    assert(replay == 'CLAIMED', 'double settlement reason');

    stop_cheat_block_timestamp_global();
}
}
