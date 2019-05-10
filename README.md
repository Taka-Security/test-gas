## test-gas

Comparing gas cost of executing the same function in different solidity contracts.

```
usage: index.js [-h] [-v] --contracts <path> [<path> ...] --solc <version>
                --function <function> [--evm <version>] [--optimizer <runs>]
                [--node-host <host>] [--node-port <port>] [--node-id <id>]
                [--node-gas <gaslimit>] [--node-websockets]


Compare gas cost of executing multiple functions

Optional arguments:
  -h, --help            Show this help message and exit.
  -v, --version         Show program's version number and exit.
  --contracts <path> [<path> ...]
                        solidity test file glob path, e.g. ./contracts/*.sol
  --solc <version>      solc version to use, e.g. 0.5.6
  --function <function()>
                        function to call, e.g. 'testFn(2)'
  --evm <version>       evm version to use, e.g. byzantium
  --optimizer <runs>    number of optimizer runs, e.g. 200
  --node-host <host>    host/ip address of ethereum node
  --node-port <port>    port of ethereum node
  --node-id <id>        network id of ethereum node
  --node-gas <gaslimit>
                        ethereum network gas limit
  --node-websockets     use websockets of ethereum node                     
```

### Example

1. create two contracts:

  - `Test_increment_single.sol`
    ```
    pragma solidity ^0.5.8;

    contract Test_increment_single {
      uint a = 3;
      function exec() public {
        a += 1;
      }
    } 
    ```
  - `Test_increment_double.sol`
    ```
    pragma solidity ^0.5.8;

    contract Test_increment_double {
      uint a = 3;
      function exec() public {
        a += 1;
        a += 1;
      }
    } 
    ```

2. execute `test-gas` command

    - use truffle internal development EVM node
    ```
    test-gas --contracts ./Test_increment_single.sol ./Test_increment_double.sol --solc 0.5.8 --function 'exec()'
    ```
    
    - connect to running (ganache/geth/parity) node
    
    ```
    test-gas --node-host localhost --node-port 8545 --contracts ./Test_increment_single.sol ./Test_increment_double.sol --solc 0.5.8 --function 'exec()' 
    ```
    
3. review output of `test-gas` execution
    - used truffle internal development EVM node
    ```
    executing exec() in 2 solidity test files
    node host: truffle
    solc: 0.5.8 | evm: petersburg | optimizer runs: 0
    .---------------------------------------------------------------------------.
    |               | Test_increment_double | Test_increment_single |   diff    |
    |---------------|-----------------------|-----------------------|-----------|
    | codesize      |                   131 |                   115 | -     -16 |
    | deploymentGas |                109807 |                105513 | -   -4294 |
    | usageGas      |                 31860 |                 26627 | -   -5233 |
    '---------------------------------------------------------------------------'
    ```
    - used running (ganache/geth/parity) node
    ```
    executing exec() in 2 solidity test files
    node host: 127.0.0.1 | node port: 8545 | node id: * | node ws: no | node gas limit: null
    solc: 0.5.8 | evm: petersburg | optimizer runs: 0
    .---------------------------------------------------------------------------.
    |               | Test_increment_double | Test_increment_single |   diff    |
    |---------------|-----------------------|-----------------------|-----------|
    | codesize      |                   131 |                   115 | -     -16 |
    | deploymentGas |                109807 |                105513 | -   -4294 |
    | usageGas      |                 31860 |                 26627 | -   -5233 |
    '---------------------------------------------------------------------------'
    ```
    
### Testing on different networks/nodes

- When not specifying any of the `--node-` cli arguments, truffle will use it's internal development EVM.
- When specifying any of the `--node-` options a `truffle.js` file will be dynamically created and used to determine the node to connect to. For example, only supplying `--node-port 8545` would connect to `127.0.0.1:8545`.

## TODO

- [ ] due to pragma used in `Migrations.sol` currently only supports solc `0.5.x`.
- [ ] still didn't manage to run it against a running geth/parity node.


