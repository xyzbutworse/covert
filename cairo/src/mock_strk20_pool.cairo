use starknet::ContractAddress;

/// TEST AND DEVNET INFRASTRUCTURE ONLY. NEVER DEPLOY THIS TO MAINNET.
///
/// A stand-in for the STRK20 privacy pool that reproduces the *interface* COVERT
/// depends on, so the full route
///
///     pool -> CovertAnonymizer -> CovertPolicy -> CovertAnonymizer -> pool
///
/// can be executed as real transactions on a local Starknet node.
///
/// It deliberately does NOT reproduce STRK20's privacy construction: there are no
/// notes, no proofs and no anonymity set here, and a balance in this contract is
/// plainly visible. What it does reproduce faithfully is the calling pattern —
/// the pool funds the anonymizer, calls `privacy_invoke` as the pinned caller, and
/// absorbs the returned `OpenNoteDeposit` — which is the part of the mechanism
/// COVERT's own contracts implement and must be tested against.
///
/// On Starknet Mainnet this contract is replaced by the real STRK20 pool at
/// 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a and COVERT's
/// code path is unchanged.
#[starknet::interface]
pub trait IMockStrk20Pool<TState> {
    fn deposit(ref self: TState, amount: u128);
    fn private_balance(self: @TState, account: ContractAddress) -> u128;
    fn route_buy(
        ref self: TState,
        anonymizer: ContractAddress,
        policy: ContractAddress,
        commitment: felt252,
        owner_key: felt252,
        tier: u8,
        premium: u128,
    );
    fn route_claim(
        ref self: TState,
        anonymizer: ContractAddress,
        policy: ContractAddress,
        policy_commitment: felt252,
        claim_commitment: felt252,
        incident_hash: felt252,
        sig_r: felt252,
        sig_s: felt252,
    );
    fn route_redeem(
        ref self: TState,
        anonymizer: ContractAddress,
        policy: ContractAddress,
        policy_commitment: felt252,
        claim_commitment: felt252,
        sig_r: felt252,
        sig_s: felt252,
        note_id: felt252,
    ) -> u128;
}

#[starknet::contract]
pub mod MockStrk20Pool {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use covert::covert_anonymizer::{
        ICovertAnonymizerDispatcher, ICovertAnonymizerDispatcherTrait, OpenNoteDeposit,
    };

    const OP_BUY: felt252 = 1;
    const OP_CLAIM: felt252 = 2;
    const OP_REDEEM: felt252 = 3;

    #[starknet::interface]
    pub trait IERC20<TState> {
        fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(
            ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        fn balance_of(self: @TState, account: ContractAddress) -> u256;
    }

    mod errors {
        pub const LOW_BALANCE: felt252 = 'POOL_LOW_BALANCE';
        pub const TRANSFER_FAILED: felt252 = 'POOL_TRANSFER_FAILED';
        pub const NO_DEPOSIT: felt252 = 'POOL_NO_DEPOSIT';
    }

    #[storage]
    struct Storage {
        token: ContractAddress,
        balances: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Shielded: Shielded,
        PrivateNoteCredited: PrivateNoteCredited,
    }

    #[derive(Drop, starknet::Event)]
    struct Shielded { #[key] account: ContractAddress, amount: u128, balance: u128 }
    #[derive(Drop, starknet::Event)]
    struct PrivateNoteCredited {
        #[key] account: ContractAddress,
        #[key] note_id: felt252,
        amount: u128,
        balance: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, token: ContractAddress) {
        self.token.write(token);
    }

    #[abi(embed_v0)]
    impl PoolImpl of super::IMockStrk20Pool<ContractState> {
        /// Public shield deposit — the step COVERT never claims is private.
        fn deposit(ref self: ContractState, amount: u128) {
            let caller = get_caller_address();
            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer_from(caller, get_contract_address(), amount.into());
            assert(ok, errors::TRANSFER_FAILED);
            let balance = self.balances.read(caller) + amount;
            self.balances.write(caller, balance);
            self.emit(Shielded { account: caller, amount, balance });
        }

        fn private_balance(self: @ContractState, account: ContractAddress) -> u128 {
            self.balances.read(account)
        }

        /// `withdraw(recipient = anonymizer)` + `invoke` in one call, as the wallet
        /// composes them in a single STRK20 transaction.
        fn route_buy(
            ref self: ContractState,
            anonymizer: ContractAddress,
            policy: ContractAddress,
            commitment: felt252,
            owner_key: felt252,
            tier: u8,
            premium: u128,
        ) {
            let caller = get_caller_address();
            let balance = self.balances.read(caller);
            assert(balance >= premium, errors::LOW_BALANCE);
            self.balances.write(caller, balance - premium);

            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = erc20.transfer(anonymizer, premium.into());
            assert(ok, errors::TRANSFER_FAILED);

            let anon = ICovertAnonymizerDispatcher { contract_address: anonymizer };
            anon
                .privacy_invoke(
                    OP_BUY,
                    self.token.read(),
                    get_contract_address(),
                    policy,
                    commitment,
                    owner_key,
                    tier.into(),
                    0,
                    0,
                    0,
                );
        }

        /// Zero-value `invoke`. The pool's balance rule is satisfied trivially, which
        /// is why COVERT's authenticated claim needs no bond.
        fn route_claim(
            ref self: ContractState,
            anonymizer: ContractAddress,
            policy: ContractAddress,
            policy_commitment: felt252,
            claim_commitment: felt252,
            incident_hash: felt252,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            let anon = ICovertAnonymizerDispatcher { contract_address: anonymizer };
            anon
                .privacy_invoke(
                    OP_CLAIM,
                    self.token.read(),
                    get_contract_address(),
                    policy,
                    policy_commitment,
                    claim_commitment,
                    incident_hash,
                    sig_r,
                    sig_s,
                    0,
                );
        }

        /// `transfer(amount: OPEN)` + `invoke`: the pool creates an open note, the
        /// anonymizer returns the deposit that fills it, and the pool pulls the
        /// approved payout in.
        fn route_redeem(
            ref self: ContractState,
            anonymizer: ContractAddress,
            policy: ContractAddress,
            policy_commitment: felt252,
            claim_commitment: felt252,
            sig_r: felt252,
            sig_s: felt252,
            note_id: felt252,
        ) -> u128 {
            let caller = get_caller_address();
            let anon = ICovertAnonymizerDispatcher { contract_address: anonymizer };
            let deposits: Span<OpenNoteDeposit> = anon
                .privacy_invoke(
                    OP_REDEEM,
                    self.token.read(),
                    get_contract_address(),
                    policy,
                    policy_commitment,
                    claim_commitment,
                    sig_r,
                    sig_s,
                    0,
                    note_id,
                );

            assert(deposits.len() > 0, errors::NO_DEPOSIT);
            let erc20 = IERC20Dispatcher { contract_address: self.token.read() };
            let mut credited: u128 = 0;
            let mut i: u32 = 0;
            while i < deposits.len() {
                let deposit: OpenNoteDeposit = *deposits.at(i);
                let ok = erc20
                    .transfer_from(anonymizer, get_contract_address(), deposit.amount.into());
                assert(ok, errors::TRANSFER_FAILED);
                credited += deposit.amount;
                i += 1;
            }

            let balance = self.balances.read(caller) + credited;
            self.balances.write(caller, balance);
            self.emit(PrivateNoteCredited { account: caller, note_id, amount: credited, balance });
            credited
        }
    }
}
