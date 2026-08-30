use starknet::ContractAddress;

// Must serialize identically to the STRK20 pool's OpenNoteDeposit.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IERC20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IPolicy<TState> {
    fn buy_policy(ref self: TState, commitment: felt252, owner_key: felt252, tier: u8, paid_amount: u128);
    fn submit_claim(
        ref self: TState,
        policy_commitment: felt252,
        claim_commitment: felt252,
        incident_hash: felt252,
        sig_r: felt252,
        sig_s: felt252,
    );
    fn redeem_claim(
        ref self: TState,
        policy_commitment: felt252,
        claim_commitment: felt252,
        sig_r: felt252,
        sig_s: felt252,
    ) -> u128;
    fn quote_tier(self: @TState, tier: u8) -> (u128, u128, u64);
}

#[starknet::interface]
pub trait ICovertAnonymizer<TState> {
    fn privacy_invoke(
        ref self: TState,
        operation: felt252,
        token: ContractAddress,
        pool_address: ContractAddress,
        policy_address: ContractAddress,
        arg0: felt252,
        arg1: felt252,
        arg2: felt252,
        arg3: felt252,
        arg4: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn invoke_count(self: @TState) -> u64;
}

#[starknet::contract]
pub mod CovertAnonymizer {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IPolicyDispatcher, IPolicyDispatcherTrait,
        OpenNoteDeposit,
    };

    const OP_BUY: felt252 = 1;
    const OP_CLAIM: felt252 = 2;
    const OP_REDEEM: felt252 = 3;

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const BAD_TOKEN: felt252 = 'BAD_TOKEN';
        pub const BAD_OP: felt252 = 'BAD_OP';
        pub const BAD_POLICY: felt252 = 'BAD_POLICY';
        pub const NO_INPUT: felt252 = 'NO_INPUT';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
        pub const BAD_INPUT_AMOUNT: felt252 = 'BAD_INPUT_AMOUNT';
        pub const BAD_ADDRESS: felt252 = 'BAD_ADDRESS';
    }

    #[storage]
    struct Storage {
        policy: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
        invoke_count_: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event { Routed: Routed }

    #[derive(Drop, starknet::Event)]
    struct Routed {
        #[key]
        operation: felt252,
        #[key]
        reference: felt252,
        amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        policy: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
    ) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(policy != zero, errors::BAD_ADDRESS);
        assert(pool != zero, errors::BAD_ADDRESS);
        assert(token != zero, errors::BAD_ADDRESS);
        self.policy.write(policy);
        self.pool.write(pool);
        self.token.write(token);
    }

    #[abi(embed_v0)]
    impl AnonImpl of super::ICovertAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: felt252,
            token: ContractAddress,
            pool_address: ContractAddress,
            policy_address: ContractAddress,
            arg0: felt252,
            arg1: felt252,
            arg2: felt252,
            arg3: felt252,
            arg4: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Pin the live pool, policy and token at deployment. Wallet placeholders are accepted
            // only after the pool substitutes them with exactly these addresses.
            assert(get_caller_address() == self.pool.read(), errors::BAD_POOL);
            assert(pool_address == self.pool.read(), errors::BAD_POOL);
            assert(token == self.token.read(), errors::BAD_TOKEN);
            assert(policy_address == self.policy.read(), errors::BAD_POLICY);

            let erc20 = IERC20Dispatcher { contract_address: token };
            let policy = IPolicyDispatcher { contract_address: policy_address };
            self.invoke_count_.write(self.invoke_count_.read() + 1);

            if operation == OP_BUY {
                // Every argument has exactly one meaning. Unused slots must be zero so a
                // malicious pool cannot smuggle arbitrary data through the pinning layer.
                assert(arg3 == 0 && arg4 == 0 && note_id == 0, errors::BAD_OP);
                let tier: u8 = arg2.try_into().expect(errors::BAD_OP);
                let (premium, _, _) = policy.quote_tier(tier);

                // The pool sends the exact fixed premium to COVERT before this invoke.
                let balance: u256 = erc20.balance_of(get_contract_address());
                let balance_u128: u128 = balance.try_into().expect(errors::AMOUNT_OVERFLOW);
                assert(balance_u128 == premium, errors::BAD_INPUT_AMOUNT);
                let ok = erc20.approve(policy_address, premium.into());
                assert(ok, errors::APPROVE_FAILED);

                policy.buy_policy(arg0, arg1, tier, premium);
                self.emit(Routed { operation, reference: arg0, amount: premium });
                array![].span()
            } else if operation == OP_CLAIM {
                // arg3/arg4 authenticate the bearer at claim-submission time, preventing an
                // observer from griefing a public policy commitment by consuming its claim slot.
                assert(note_id == 0, errors::BAD_OP);
                policy.submit_claim(arg0, arg1, arg2, arg3, arg4);
                self.emit(Routed { operation, reference: arg1, amount: 0 });
                array![].span()
            } else if operation == OP_REDEEM {
                assert(arg4 == 0, errors::BAD_OP);
                let payout = policy.redeem_claim(arg0, arg1, arg2, arg3);

                // Policy transfers exactly `payout` to this anonymizer. Approve only that payout
                // back to the STRK20 pool, which fills the wallet-created open note.
                let balance: u256 = erc20.balance_of(get_contract_address());
                let balance_u128: u128 = balance.try_into().expect(errors::AMOUNT_OVERFLOW);
                assert(balance_u128 == payout, errors::BAD_INPUT_AMOUNT);
                let ok = erc20.approve(pool_address, payout.into());
                assert(ok, errors::APPROVE_FAILED);

                self.emit(Routed { operation, reference: arg1, amount: payout });
                array![OpenNoteDeposit { note_id, token, amount: payout }].span()
            } else {
                panic!("BAD_OP")
            }
        }

        fn invoke_count(self: @ContractState) -> u64 {
            self.invoke_count_.read()
        }
    }
}
