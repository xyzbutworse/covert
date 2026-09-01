use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TState> {
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait ICovertPolicy<TState> {
    fn configure_anonymizer(ref self: TState, anonymizer: ContractAddress);
    fn fund_reserve(ref self: TState, amount: u128);
    fn buy_policy(ref self: TState, commitment: felt252, owner_key: felt252, tier: u8, paid_amount: u128);
    fn submit_claim(
        ref self: TState,
        policy_commitment: felt252,
        claim_commitment: felt252,
        incident_hash: felt252,
        sig_r: felt252,
        sig_s: felt252,
    );
    fn approve_claim(ref self: TState, claim_commitment: felt252);
    fn deny_claim(ref self: TState, claim_commitment: felt252);
    fn redeem_claim(
        ref self: TState,
        policy_commitment: felt252,
        claim_commitment: felt252,
        sig_r: felt252,
        sig_s: felt252,
    ) -> u128;
    fn expire_policy(ref self: TState, policy_commitment: felt252);
    fn expire_stale_claim(ref self: TState, claim_commitment: felt252);
    fn withdraw_surplus(ref self: TState, amount: u128, recipient: ContractAddress);
    fn quote_tier(self: @TState, tier: u8) -> (u128, u128, u64);
    fn owner(self: @TState) -> ContractAddress;
    fn adjudicator(self: @TState) -> ContractAddress;
    fn anonymizer(self: @TState) -> ContractAddress;
    fn token(self: @TState) -> ContractAddress;
    fn reserve(self: @TState) -> u128;
    fn exposure(self: @TState) -> u128;
    fn free_reserve(self: @TState) -> u128;
    fn adjudication_window(self: @TState) -> u64;
    fn policy_state(self: @TState, commitment: felt252) -> (bool, u8, felt252, u64, bool, bool, bool);
    fn policy_claim(self: @TState, commitment: felt252) -> felt252;
    fn claim_state(self: @TState, claim_commitment: felt252) -> (bool, felt252, felt252, u8, bool);
    fn claim_deadline(self: @TState, claim_commitment: felt252) -> u64;
}

#[starknet::contract]
pub mod CovertPolicy {
    use core::ecdsa::check_ecdsa_signature;
    use core::ec::stark_curve::ORDER;
    use core::poseidon::poseidon_hash_span;
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use super::{IERC20Dispatcher, IERC20DispatcherTrait};

    // Hackathon proof tiers. These are deliberately tiny, fixed-indemnity values.
    const PREMIUM_1: u128 = 10000000000000000;   // 0.01 STRK
    const PAYOUT_1: u128 = 50000000000000000;    // 0.05 STRK
    const TERM_1: u64 = 604800;                   // 7 days
    const PREMIUM_2: u128 = 20000000000000000;   // 0.02 STRK
    const PAYOUT_2: u128 = 100000000000000000;   // 0.10 STRK
    const TERM_2: u64 = 1209600;                  // 14 days
    const PREMIUM_3: u128 = 40000000000000000;   // 0.04 STRK
    const PAYOUT_3: u128 = 200000000000000000;   // 0.20 STRK
    const TERM_3: u64 = 2592000;                  // 30 days

    // Adjudication liveness bound. A claim left undecided past this window can be
    // timed out by anyone, which stops an absent adjudicator from locking reserve
    // capital behind an open claim forever. It cannot be used to deny a claim early:
    // the deadline is enforced against block time, not against a caller's authority.
    const ADJUDICATION_WINDOW_SECONDS: u64 = 259200; // 72 hours

    // Domain separation prevents a signature produced for one action from being replayed as another.
    const CLAIM_DOMAIN: felt252 = 'COVERT_CLAIM_V1';
    const REDEEM_DOMAIN: felt252 = 'COVERT_REDEEM_V1';

    const DECISION_PENDING: u8 = 0;
    const DECISION_APPROVED: u8 = 1;
    const DECISION_DENIED: u8 = 2;

    mod errors {
        pub const NOT_OWNER: felt252 = 'NOT_OWNER';
        pub const NOT_ADJUDICATOR: felt252 = 'NOT_ADJUDICATOR';
        pub const NOT_ANON: felt252 = 'NOT_ANON';
        pub const NOT_CONFIGURED: felt252 = 'NOT_CONFIGURED';
        pub const ALREADY_CONFIGURED: felt252 = 'ALREADY_CONFIGURED';
        pub const BAD_TIER: felt252 = 'BAD_TIER';
        pub const BAD_PREMIUM: felt252 = 'BAD_PREMIUM';
        pub const BAD_KEY: felt252 = 'BAD_KEY';
        pub const POLICY_EXISTS: felt252 = 'POLICY_EXISTS';
        pub const POLICY_MISSING: felt252 = 'POLICY_MISSING';
        pub const EXPIRED: felt252 = 'EXPIRED';
        pub const NOT_EXPIRED: felt252 = 'NOT_EXPIRED';
        pub const CLAIMED: felt252 = 'CLAIMED';
        pub const POLICY_HAS_CLAIM: felt252 = 'POLICY_HAS_CLAIM';
        pub const CLAIM_EXISTS: felt252 = 'CLAIM_EXISTS';
        pub const CLAIM_MISSING: felt252 = 'CLAIM_MISSING';
        pub const DECIDED: felt252 = 'DECIDED';
        pub const NOT_APPROVED: felt252 = 'NOT_APPROVED';
        pub const BAD_SIGNATURE: felt252 = 'BAD_SIGNATURE';
        pub const BAD_COMMITMENT: felt252 = 'BAD_COMMITMENT';
        pub const INSOLVENT: felt252 = 'INSOLVENT';
        pub const TRANSFER_FAILED: felt252 = 'TRANSFER_FAILED';
        pub const BAD_ADDRESS: felt252 = 'BAD_ADDRESS';
        pub const NOT_STALE: felt252 = 'NOT_STALE';
        pub const NO_SURPLUS: felt252 = 'NO_SURPLUS';
        pub const BAD_AMOUNT: felt252 = 'BAD_AMOUNT';
    }

    #[storage]
    struct Storage {
        owner: ContractAddress,
        adjudicator_: ContractAddress,
        token: ContractAddress,
        anonymizer: ContractAddress,
        anonymizer_configured: bool,
        reserve_amount: u128,
        exposure_amount: u128,

        policy_exists: Map<felt252, bool>,
        policy_tier: Map<felt252, u8>,
        policy_owner_key: Map<felt252, felt252>,
        policy_expiry: Map<felt252, u64>,
        policy_active: Map<felt252, bool>,
        policy_claimed: Map<felt252, bool>,
        policy_has_claim: Map<felt252, bool>,

        claim_exists: Map<felt252, bool>,
        claim_policy: Map<felt252, felt252>,
        claim_incident: Map<felt252, felt252>,
        claim_decision: Map<felt252, u8>,
        claim_redeemed: Map<felt252, bool>,
        claim_submitted_at: Map<felt252, u64>,
        policy_claim_of: Map<felt252, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AnonymizerConfigured: AnonymizerConfigured,
        ReserveFunded: ReserveFunded,
        PolicyPurchased: PolicyPurchased,
        PolicyExpired: PolicyExpired,
        ClaimSubmitted: ClaimSubmitted,
        ClaimApproved: ClaimApproved,
        ClaimDenied: ClaimDenied,
        ClaimTimedOut: ClaimTimedOut,
        ClaimSettled: ClaimSettled,
        ReserveWithdrawn: ReserveWithdrawn,
    }

    #[derive(Drop, starknet::Event)]
    struct AnonymizerConfigured { anonymizer: ContractAddress }
    #[derive(Drop, starknet::Event)]
    struct ReserveFunded { amount: u128, reserve: u128 }
    #[derive(Drop, starknet::Event)]
    struct PolicyPurchased { #[key] commitment: felt252, tier: u8, expiry: u64, payout: u128 }
    #[derive(Drop, starknet::Event)]
    struct PolicyExpired { #[key] commitment: felt252, released_exposure: u128 }
    #[derive(Drop, starknet::Event)]
    struct ClaimSubmitted {
        #[key] claim_commitment: felt252,
        #[key] policy_commitment: felt252,
        incident_hash: felt252,
    }
    #[derive(Drop, starknet::Event)]
    struct ClaimApproved {
        #[key] claim_commitment: felt252,
        #[key] policy_commitment: felt252,
    }
    #[derive(Drop, starknet::Event)]
    struct ClaimDenied {
        #[key] claim_commitment: felt252,
        #[key] policy_commitment: felt252,
        released_exposure: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct ClaimTimedOut {
        #[key] claim_commitment: felt252,
        #[key] policy_commitment: felt252,
        released_exposure: u128,
        deadline: u64,
    }
    #[derive(Drop, starknet::Event)]
    struct ReserveWithdrawn { amount: u128, reserve: u128, recipient: ContractAddress }
    #[derive(Drop, starknet::Event)]
    struct ClaimSettled {
        #[key] claim_commitment: felt252,
        #[key] policy_commitment: felt252,
        payout: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        adjudicator: ContractAddress,
        token: ContractAddress,
    ) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(owner != zero, errors::BAD_ADDRESS);
        assert(adjudicator != zero, errors::BAD_ADDRESS);
        assert(token != zero, errors::BAD_ADDRESS);
        self.owner.write(owner);
        self.adjudicator_.write(adjudicator);
        self.token.write(token);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn only_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
        }

        fn only_adjudicator(self: @ContractState) {
            assert(get_caller_address() == self.adjudicator_.read(), errors::NOT_ADJUDICATOR);
        }

        fn only_anonymizer(self: @ContractState) {
            assert(self.anonymizer_configured.read(), errors::NOT_CONFIGURED);
            assert(get_caller_address() == self.anonymizer.read(), errors::NOT_ANON);
        }

        fn economics(self: @ContractState, tier: u8) -> (u128, u128, u64) {
            assert(tier >= 1 && tier <= 3, errors::BAD_TIER);
            if tier == 1 {
                (PREMIUM_1, PAYOUT_1, TERM_1)
            } else if tier == 2 {
                (PREMIUM_2, PAYOUT_2, TERM_2)
            } else {
                (PREMIUM_3, PAYOUT_3, TERM_3)
            }
        }

        fn release_exposure(ref self: ContractState, policy_commitment: felt252) -> u128 {
            let tier = self.policy_tier.read(policy_commitment);
            let (_, payout, _) = self.economics(tier);
            let current = self.exposure_amount.read();
            assert(current >= payout, errors::INSOLVENT);
            self.exposure_amount.write(current - payout);
            payout
        }

        fn assert_bearer_signature(
            self: @ContractState, message_hash: felt252, owner_key: felt252, sig_r: felt252, sig_s: felt252,
        ) {
            // Enforce canonical scalar ranges before using Cairo's Stark-curve verifier.
            // This rejects malformed/high-s variants and keeps each authorization canonical.
            let order_u256: u256 = ORDER.into();
            let r_u256: u256 = sig_r.into();
            let s_u256: u256 = sig_s.into();
            assert(r_u256 > 0 && r_u256 < order_u256, errors::BAD_SIGNATURE);
            assert(s_u256 > 0 && s_u256 <= order_u256 / 2, errors::BAD_SIGNATURE);
            assert(check_ecdsa_signature(message_hash, owner_key, sig_r, sig_s), errors::BAD_SIGNATURE);
        }
    }

    #[abi(embed_v0)]
    impl PolicyImpl of super::ICovertPolicy<ContractState> {
        fn configure_anonymizer(ref self: ContractState, anonymizer: ContractAddress) {
            self.only_owner();
            assert(!self.anonymizer_configured.read(), errors::ALREADY_CONFIGURED);
            self.anonymizer.write(anonymizer);
            self.anonymizer_configured.write(true);
            self.emit(AnonymizerConfigured { anonymizer });
        }

        fn fund_reserve(ref self: ContractState, amount: u128) {
            self.only_owner();
            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer_from(get_caller_address(), get_contract_address(), amount.into());
            assert(ok, errors::TRANSFER_FAILED);
            let next = self.reserve_amount.read() + amount;
            self.reserve_amount.write(next);
            self.emit(ReserveFunded { amount, reserve: next });
        }

        fn buy_policy(
            ref self: ContractState,
            commitment: felt252,
            owner_key: felt252,
            tier: u8,
            paid_amount: u128,
        ) {
            self.only_anonymizer();
            assert(commitment != 0, errors::BAD_COMMITMENT);
            assert(!self.policy_exists.read(commitment), errors::POLICY_EXISTS);
            assert(owner_key != 0, errors::BAD_KEY);

            let (premium, payout, term_seconds) = self.economics(tier);
            assert(paid_amount == premium, errors::BAD_PREMIUM);

            // Policy duration is protocol-owned. The frontend cannot extend a cheap tier.
            let expiry = get_block_timestamp() + term_seconds;
            let new_exposure = self.exposure_amount.read() + payout;
            assert(self.reserve_amount.read() + premium >= new_exposure, errors::INSOLVENT);

            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer_from(get_caller_address(), get_contract_address(), premium.into());
            assert(ok, errors::TRANSFER_FAILED);

            self.reserve_amount.write(self.reserve_amount.read() + premium);
            self.exposure_amount.write(new_exposure);
            self.policy_exists.write(commitment, true);
            self.policy_tier.write(commitment, tier);
            self.policy_owner_key.write(commitment, owner_key);
            self.policy_expiry.write(commitment, expiry);
            self.policy_active.write(commitment, true);
            self.emit(PolicyPurchased { commitment, tier, expiry, payout });
        }

        fn submit_claim(
            ref self: ContractState,
            policy_commitment: felt252,
            claim_commitment: felt252,
            incident_hash: felt252,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            self.only_anonymizer();
            assert(self.policy_exists.read(policy_commitment), errors::POLICY_MISSING);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);
            assert(!self.policy_claimed.read(policy_commitment), errors::CLAIMED);
            assert(!self.policy_has_claim.read(policy_commitment), errors::POLICY_HAS_CLAIM);
            assert(get_block_timestamp() <= self.policy_expiry.read(policy_commitment), errors::EXPIRED);
            assert(!self.claim_exists.read(claim_commitment), errors::CLAIM_EXISTS);
            assert(incident_hash != 0, errors::BAD_COMMITMENT);

            // The claim handle is deterministically bound to this policy and salted incident hash.
            // The salt/plaintext stay offchain, but a caller cannot submit a different arbitrary
            // claim handle than the one the verifier can recompute from the reveal package.
            let expected_claim = poseidon_hash_span(array![policy_commitment, incident_hash].span());
            assert(claim_commitment == expected_claim, errors::BAD_COMMITMENT);

            // Claim submission itself authenticates the bearer. Observers can see a policy
            // commitment but cannot grief it by consuming its one-claim slot.
            let msg_hash = poseidon_hash_span(
                array![CLAIM_DOMAIN, policy_commitment, claim_commitment, incident_hash].span(),
            );
            let owner_key = self.policy_owner_key.read(policy_commitment);
            self.assert_bearer_signature(msg_hash, owner_key, sig_r, sig_s);

            self.policy_has_claim.write(policy_commitment, true);
            self.policy_claim_of.write(policy_commitment, claim_commitment);
            self.claim_exists.write(claim_commitment, true);
            self.claim_policy.write(claim_commitment, policy_commitment);
            self.claim_incident.write(claim_commitment, incident_hash);
            self.claim_decision.write(claim_commitment, DECISION_PENDING);
            // Starts the adjudication clock used by expire_stale_claim.
            self.claim_submitted_at.write(claim_commitment, get_block_timestamp());
            self.emit(ClaimSubmitted { claim_commitment, policy_commitment, incident_hash });
        }

        fn approve_claim(ref self: ContractState, claim_commitment: felt252) {
            self.only_adjudicator();
            assert(self.claim_exists.read(claim_commitment), errors::CLAIM_MISSING);
            assert(self.claim_decision.read(claim_commitment) == DECISION_PENDING, errors::DECIDED);
            // An approval on a policy that is no longer active would authorise a
            // settlement the policy can never honour. Refuse it at decision time.
            let policy_commitment = self.claim_policy.read(claim_commitment);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);
            self.claim_decision.write(claim_commitment, DECISION_APPROVED);
            self.emit(ClaimApproved { claim_commitment, policy_commitment });
        }

        fn deny_claim(ref self: ContractState, claim_commitment: felt252) {
            self.only_adjudicator();
            assert(self.claim_exists.read(claim_commitment), errors::CLAIM_MISSING);
            assert(self.claim_decision.read(claim_commitment) == DECISION_PENDING, errors::DECIDED);

            let policy_commitment = self.claim_policy.read(claim_commitment);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);
            let released = self.release_exposure(policy_commitment);
            self.claim_decision.write(claim_commitment, DECISION_DENIED);
            self.policy_active.write(policy_commitment, false);
            self.emit(ClaimDenied { claim_commitment, policy_commitment, released_exposure: released });
        }

        fn redeem_claim(
            ref self: ContractState,
            policy_commitment: felt252,
            claim_commitment: felt252,
            sig_r: felt252,
            sig_s: felt252,
        ) -> u128 {
            self.only_anonymizer();
            assert(self.claim_exists.read(claim_commitment), errors::CLAIM_MISSING);
            assert(self.claim_policy.read(claim_commitment) == policy_commitment, errors::CLAIM_MISSING);
            assert(self.claim_decision.read(claim_commitment) == DECISION_APPROVED, errors::NOT_APPROVED);
            assert(!self.claim_redeemed.read(claim_commitment), errors::CLAIMED);
            assert(!self.policy_claimed.read(policy_commitment), errors::CLAIMED);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);

            let tier = self.policy_tier.read(policy_commitment);
            let (_, payout, _) = self.economics(tier);
            let msg_hash = poseidon_hash_span(
                array![REDEEM_DOMAIN, policy_commitment, claim_commitment, payout.into()].span(),
            );
            let owner_key = self.policy_owner_key.read(policy_commitment);
            self.assert_bearer_signature(msg_hash, owner_key, sig_r, sig_s);
            assert(self.reserve_amount.read() >= payout, errors::INSOLVENT);

            self.claim_redeemed.write(claim_commitment, true);
            self.policy_claimed.write(policy_commitment, true);
            self.policy_active.write(policy_commitment, false);
            self.reserve_amount.write(self.reserve_amount.read() - payout);
            self.release_exposure(policy_commitment);

            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer(get_caller_address(), payout.into());
            assert(ok, errors::TRANSFER_FAILED);
            self.emit(ClaimSettled { claim_commitment, policy_commitment, payout });
            payout
        }

        fn expire_policy(ref self: ContractState, policy_commitment: felt252) {
            assert(self.policy_exists.read(policy_commitment), errors::POLICY_MISSING);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);
            assert(!self.policy_has_claim.read(policy_commitment), errors::POLICY_HAS_CLAIM);
            assert(get_block_timestamp() > self.policy_expiry.read(policy_commitment), errors::NOT_EXPIRED);
            let released = self.release_exposure(policy_commitment);
            self.policy_active.write(policy_commitment, false);
            self.emit(PolicyExpired { commitment: policy_commitment, released_exposure: released });
        }

        /// Permissionless liveness escape for an abandoned claim.
        ///
        /// If the adjudicator never decides, the policy's fixed payout would stay
        /// reserved forever and the reserve could never back new cover. After the
        /// adjudication window elapses anyone may close the claim, which releases
        /// the exposure. The window is checked against block time, so this cannot
        /// be used to deny a claim the adjudicator still has time to decide.
        fn expire_stale_claim(ref self: ContractState, claim_commitment: felt252) {
            assert(self.claim_exists.read(claim_commitment), errors::CLAIM_MISSING);
            assert(self.claim_decision.read(claim_commitment) == DECISION_PENDING, errors::DECIDED);

            let deadline = self.claim_submitted_at.read(claim_commitment) + ADJUDICATION_WINDOW_SECONDS;
            assert(get_block_timestamp() > deadline, errors::NOT_STALE);

            let policy_commitment = self.claim_policy.read(claim_commitment);
            assert(self.policy_active.read(policy_commitment), errors::POLICY_MISSING);

            let released = self.release_exposure(policy_commitment);
            self.claim_decision.write(claim_commitment, DECISION_DENIED);
            self.policy_active.write(policy_commitment, false);
            self.emit(ClaimTimedOut { claim_commitment, policy_commitment, released_exposure: released, deadline });
        }

        /// Withdraw only reserve that backs nothing.
        ///
        /// Without this, every STRK ever paid into the reserve is locked in the
        /// contract forever. The bound is the invariant that matters: the owner can
        /// never remove capital that is backing an outstanding policy, because the
        /// withdrawable amount is reserve minus current exposure.
        fn withdraw_surplus(ref self: ContractState, amount: u128, recipient: ContractAddress) {
            self.only_owner();
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(recipient != zero, errors::BAD_ADDRESS);
            assert(amount > 0, errors::BAD_AMOUNT);

            let reserve = self.reserve_amount.read();
            let exposure = self.exposure_amount.read();
            assert(reserve >= exposure, errors::INSOLVENT);
            let surplus = reserve - exposure;
            assert(amount <= surplus, errors::NO_SURPLUS);

            let next = reserve - amount;
            self.reserve_amount.write(next);

            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer(recipient, amount.into());
            assert(ok, errors::TRANSFER_FAILED);
            self.emit(ReserveWithdrawn { amount, reserve: next, recipient });
        }

        fn quote_tier(self: @ContractState, tier: u8) -> (u128, u128, u64) {
            self.economics(tier)
        }

        fn owner(self: @ContractState) -> ContractAddress { self.owner.read() }
        fn adjudicator(self: @ContractState) -> ContractAddress { self.adjudicator_.read() }
        fn anonymizer(self: @ContractState) -> ContractAddress { self.anonymizer.read() }
        fn token(self: @ContractState) -> ContractAddress { self.token.read() }

        fn reserve(self: @ContractState) -> u128 { self.reserve_amount.read() }
        fn exposure(self: @ContractState) -> u128 { self.exposure_amount.read() }

        /// Reserve that is not backing an outstanding policy. Saturates at zero so a
        /// reader never sees an underflow panic instead of a solvency figure.
        fn free_reserve(self: @ContractState) -> u128 {
            let reserve = self.reserve_amount.read();
            let exposure = self.exposure_amount.read();
            if reserve > exposure { reserve - exposure } else { 0 }
        }

        fn adjudication_window(self: @ContractState) -> u64 { ADJUDICATION_WINDOW_SECONDS }

        fn policy_state(
            self: @ContractState,
            commitment: felt252,
        ) -> (bool, u8, felt252, u64, bool, bool, bool) {
            (
                self.policy_exists.read(commitment),
                self.policy_tier.read(commitment),
                self.policy_owner_key.read(commitment),
                self.policy_expiry.read(commitment),
                self.policy_active.read(commitment),
                self.policy_claimed.read(commitment),
                self.policy_has_claim.read(commitment),
            )
        }

        /// Reverse index: the claim filed against a policy, or 0.
        fn policy_claim(self: @ContractState, commitment: felt252) -> felt252 {
            self.policy_claim_of.read(commitment)
        }

        /// Timestamp after which expire_stale_claim becomes callable. 0 if no claim.
        fn claim_deadline(self: @ContractState, claim_commitment: felt252) -> u64 {
            if !self.claim_exists.read(claim_commitment) { return 0; }
            self.claim_submitted_at.read(claim_commitment) + ADJUDICATION_WINDOW_SECONDS
        }

        fn claim_state(
            self: @ContractState,
            claim_commitment: felt252,
        ) -> (bool, felt252, felt252, u8, bool) {
            (
                self.claim_exists.read(claim_commitment),
                self.claim_policy.read(claim_commitment),
                self.claim_incident.read(claim_commitment),
                self.claim_decision.read(claim_commitment),
                self.claim_redeemed.read(claim_commitment),
            )
        }
    }
}
