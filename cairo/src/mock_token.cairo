#[starknet::interface]
pub trait IMockToken<TState> {
    fn mint(ref self: TState, to: starknet::ContractAddress, amount: u256);
    fn balance_of(self: @TState, account: starknet::ContractAddress) -> u256;
    fn approve(ref self: TState, spender: starknet::ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TState, recipient: starknet::ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState,
        sender: starknet::ContractAddress,
        recipient: starknet::ContractAddress,
        amount: u256,
    ) -> bool;
}

// Test-only ERC-20 stand-in. It intentionally ignores allowances: COVERT's tests use it to
// exercise reserve accounting and cross-contract transfer paths, not ERC-20 allowance logic.
#[starknet::contract]
pub mod MockToken {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    mod errors {
        pub const INSUFFICIENT: felt252 = 'INSUFFICIENT';
    }

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl MockTokenImpl of super::IMockToken<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, errors::INSUFFICIENT);
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, errors::INSUFFICIENT);
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
    }
}
