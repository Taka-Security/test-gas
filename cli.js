#!/usr/bin/env node

const path = require('path');
const exec = require('util').promisify(require('child_process').exec);

const fs = require('fs-plus');
const { EVM } = require('evm');
const chalk = require('chalk');
const { table } = require('table');
const { ArgumentParser } = require('argparse');

//
// 
// 
// Constants
// 
// 
// 

const VALID_EVM_VERSIONS = ['homestead', 'tangerineWhistle', 'spuriousDragon', 'byzantium', 'constantinople', 'petersburg'];

const TESTRUN_CONTRACT_DIR = path.join(__dirname, 'contracts', 'testrun');
const TESTRUN_OUTPUT_DIR = path.join(__dirname, 'test', 'testrun');
const TESTRUN_CONTRACT_CONFIG_FILE = path.join(TESTRUN_CONTRACT_DIR, 'config.json');
const TESTRUN_SUCCESS_FILE = path.join(TESTRUN_OUTPUT_DIR, 'test_output.txt');
const TESTRUN_ERROR_FILE = path.join(TESTRUN_OUTPUT_DIR, 'truffle_output.txt');

const TESTRUN_TRUFFLE_TEST_CMD = path.join(__dirname, 'node_modules', '.bin', 'truffle test');

const DEFAULT_NETWORK_HOST = '127.0.0.1';
const DEFAULT_NETWORK_PORT = 8545;
const DEFAULT_NETWORK_ID = '*';
const DEFAULT_NETWORK_GAS = 7e6;

const DEFAULT_EVM_VERSION = 'petersburg';

const TRUFFLE_CONFIG_PATH = path.join(__dirname, 'truffle-config.js');

//
// 
// 
// CLI arguments
// 
// 
// 

/**
 *
 *
 * @returns
 */
function gather_cli_args() {
  const argParser = new ArgumentParser({
    version: require('./package.json').version,
    addHelp: false,
    description: 'Compare gas cost of executing multiple functions',
  });
    
  argParser.addArgument(
    [ '--help', '-h' ],
    {
      action: 'storeTrue',
      help: 'display help',
      dest: 'display_help',
    }
  );
    
  argParser.addArgument(
    [ '--contracts' ],
    {
      nargs: '+',  //wont work when passing as env var to truffle test
      metavar: '<path>',
      help: 'solidity contract path(s), supports glob',
      dest: 'solidity_file_paths',
    }
  );
  
  argParser.addArgument(
    [ '--solc' ],
    {
      metavar: '<version>',
      defaultValue: '0.5.9',
      help: 'solc version to use, DEFAULT=0.5.6',
      dest: 'solc_version',
    }
  );
  
  argParser.addArgument(
    [ '--evm' ],
    {
      defaultValue: 'petersburg',
      metavar: '<version>',
      choices: VALID_EVM_VERSIONS,
      help: 'evm version to use, DEFAULT=petersburg',
      dest: 'evm_version',
    }
  );
  
  argParser.addArgument(
    [ '--optimizer' ],
    {
      defaultValue: 0,
      metavar: '<runs>',
      type: 'int',
      help: 'number of optimizer runs, DEFAULT=0',
      dest: 'optimizer_runs',
    }
  );
  
  argParser.addArgument(
    [ '--function' ],
    {
      metavar: '<function()>',
      help: 'function to call, e.g. \'testFn(2)\'',
      dest: 'fn_call',
    }
  );
  
  argParser.addArgument(
    [ '--disassemble' ],
    {
      // defaultValue: '127.0.0.1',
      metavar: '<dir path>',
      help: 'directory to write contract disassemblies to',
      dest: 'disassembly_path',
    }
  );
  
  argParser.addArgument(
    [ '--node-host' ],
    {
      // defaultValue: '127.0.0.1',
      metavar: '<host>',
      help: 'host/ip address of ethereum node',
      dest: 'node_host',
    }
  );
  
  argParser.addArgument(
    [ '--node-port' ],
    {
      // defaultValue: 8545,
      metavar: '<port>',
      type: 'int',
      help: 'port of ethereum node',
      dest: 'node_port',
    }
  );
  
  argParser.addArgument(
    [ '--node-id' ],
    {
      // defaultValue: '*',
      metavar: '<id>',
      help: 'network id of ethereum node',
      dest: 'node_id',
    }
  );
  
  argParser.addArgument(
    [ '--node-gas' ],
    {
      metavar: '<gaslimit>',
      help: 'ethereum network gas limit',
      dest: 'node_gas_limit',
      type: 'int',
    }
  );
  
  argParser.addArgument(
    [ '--node-websockets' ],
    {
      // defaultValue: false,
      action: 'storeTrue',
      help: 'use websockets of ethereum node',
      dest: 'node_websockets',
    }
  );

  
  return argParser.parseArgs();
};

//
// 
// 
// Helper functions
// 
// 
// 

/**
 * removes folders that are used to store temporary results of each execution of this script
 */
function cleanup_testrun_dirs() {
  fs.removeSync(TESTRUN_CONTRACT_DIR);        // ./contracts/testrun/
  fs.removeSync(TESTRUN_OUTPUT_DIR);          // ./test/testrun/
  fs.removeSync(TESTRUN_CONTRACT_CONFIG_FILE) // ./truffle-config.js
}

/**
 * - creates empty dir ./test/testrun/
 * - copies the input solidity files into ./contracts/testrun/
 * - creates a testrun config.json file into ./contracts/testrun/
 *
 * @param {String[]} input_file_paths - list of solidity contract file paths
 * @param {String=} fn_call - optional function to call, e.g. 'exec(43)'
 */
function setup_testrun_dirs(input_file_paths, fn_call) {
  
  // create the testrun directories
  fs.makeTreeSync(TESTRUN_CONTRACT_DIR); // ./contracts/testrun/
  fs.makeTreeSync(TESTRUN_OUTPUT_DIR);   // ./test/testrun/
  
  // move the input files to the contracts/ dir
  input_file_paths.forEach((testfilePath) => {
    fs.writeFileSync( // move test file to correct location
      path.join(TESTRUN_CONTRACT_DIR, path.basename(testfilePath)),
      fs.readFileSync(testfilePath, 'utf8'),
    );
  });
  
  // write the input files in the supplied order into a config json file
  // this is needed to allow specifying the order of the contracts to execute
  // otherwise they will be sorted lexicographically
  fs.writeFileSync(TESTRUN_CONTRACT_CONFIG_FILE, JSON.stringify({ 
    contract_names: input_file_paths,
    fn_call,
    output_file_path: TESTRUN_SUCCESS_FILE,    
  }, null, 2));
  
  if (fn_call) {
    console.log(`> calling function: ${fn_call}`);
  }
}

/**
 * creates a truffle config and writes it to test-config.js
 * truffle-config.js will be used when the comparison (truffle) tests are executed
 *
 * @param {String} solc_version - solidity compiler version, e.g. 0.5.9
 * @param {Number} optimizer_runs - count of optimizer runs, e.g. 200
 * @param {('homestead', 'tangerineWhistle', 'spuriousDragon', 'byzantium', 'constantinople', 'petersburg')} evm_version - evm version of compiler
 * @param {String=} node_host - the network node host, e.g. localhost
 * @param {Number=} node_port - the network node port, e.g. 8545
 * @param {Number=} node_id - the network node id, e.g. 4
 * @param {Boolean=} node_websockets - use websockets yes/no to communicate with ethereum node
 * @param {Number=} node_gas_limit - gas limit of ethereum node
 */
function setup_truffle_config(solc_version, optimizer_runs, evm_version, node_host, node_port, node_id, node_websockets, node_gas_limit) {
  // create a truffle-config.js file
  const truffle_config = {
    compilers: {
      solc: {
        version: solc_version,
        settings: {
          optimizer: {
            enabled: optimizer_runs > 0,
            runs: optimizer_runs,
          },
          evmVersion: evm_version,
        },
      },
    },
  };
  console.log(`truffle  # ${require('./package-lock.json').dependencies.truffle.version}`);
  console.log(`compiler # solc: ${solc_version} | evm: ${evm_version} | optimizer runs: ${optimizer_runs}`);
  
  // possibly add a truffle network to the truffle-config.js file
  if (node_host || node_port || node_id || node_websockets || node_gas_limit) {
    truffle_config.networks = {
      development: {
        host: node_host || DEFAULT_NETWORK_HOST,
        port: node_port || DEFAULT_NETWORK_PORT,
        network_id: node_id ? parseInt(node_id, 10) : DEFAULT_NETWORK_ID, 
        gas: node_gas_limit || DEFAULT_NETWORK_GAS,
        websockets: !!node_websockets,
      },
    };
    console.log(`node     # host: ${truffle_config.networks.development.host} | port: ${truffle_config.networks.development.port} | id: ${truffle_config.networks.development.network_id} | ws: ${truffle_config.networks.development.websockets?'yes':'no'} | gas limit: ${truffle_config.networks.development.gas}`);
  } else {
    console.log('node     # host: truffle vm');
  }
    
  // wrtie created truffle-config.js file to filesystem
  fs.writeFileSync(TRUFFLE_CONFIG_PATH, `module.exports = ${JSON.stringify(truffle_config, null, 4)}`);
}

/**
 * converts bytecode of each contract into a disassembly with the following features:
 * - divides into basic blocks (each JUMPDEST starts a new block)
 * - adds integer value to hex values which also are a valid jump destination
 * and writes that into a file in the chosen out_dir
 * 
 * @param {Object} bytecodes - object containing as key contract name and as value the contract bytecode string
 * @param {String} out_dir - path of the directory in which to write the formatted opcode file of each input contract
 */
function write_disassembly_to_file(contract_bytecodes, out_dir) {
  
  // create the directory if it does not yet exist
  fs.makeTreeSync(out_dir);
  
  Object.keys(contract_bytecodes).forEach(contract_name => {
    const bytecode = contract_bytecodes[contract_name];
    // bytecode is saved in ./test/testrun/MyContract.evm
    const bytecode_file_path = path.join(TESTRUN_OUTPUT_DIR, `${contract_name}.evm`);
    
    // list of object with 1 object per instruction
    const opcodes_raw = (new EVM(bytecode)).getOpcodes();
    
    // save a list of the program counter (pc) of each of the JUMPDEST instructions
    const jumpdest_pcs = opcodes_raw.filter(o => o.name === 'JUMPDEST').map(o => o.pc);
    
    const formatted_opcodes = opcodes_raw.map(o => {
      // check if this is the start of a new baisc block, if so enter an extra newline
      if (o.name === 'JUMPDEST') return `\n${o.pc} JUMPDEST`;
      
      let output_line = `${o.pc} ${o.name}`;
      
      // if there are arguments supplied to this opcode
      if (o.pushData) {
        // extract value from the node.js Buffer we got from 'evm', results in list of uint8 numbers
        const val_raw = JSON.parse(JSON.stringify(o.pushData)).data;
        
        // convert the list of uint8 numbers to one long list of 2 character hexadecimals, prepend with 0x
        const val_hex = `0x${val_raw.map(v => v === 0 ? '00' : v.toString(16)).join('')}`;
        
        // append the hex value to the output
        output_line += ` ${val_hex}`;
        
        // we want to show the uint value of low hexadecimals that are also valid jump destinations 
        // 3 uint8 numbers = 2^24 = 16.777.216
        if (val_raw.length <= 3) {
          // convert the hex value (base16) to a js number (base10)
          const val_num = parseInt(val_hex, 16);
          
          // check if this number is also a valid jump destination
          if (jumpdest_pcs.includes(val_num)) {
            // append the number value of the hex value to the output
            output_line += ` # == ${val_num}`;
          }
        }
      }
      
      // return the output line of this opcode
      return output_line;
    });
    
    // write the disassembly to a file named MyContract_opcodes.txt inside dir <out_dir>
    fs.writeFileSync(
      path.join(out_dir, `${contract_name}_opcodes.txt`),
      formatted_opcodes.join('\n'),
    );
  });
};

/**
 * execute truffle test in a subprocess and return the success json data
 * on error outputs the error and exits
 * 
 * @param {Object} cli_args - 
 * @param {String[]} input_file_paths - list of (absolute) file paths of the contracts
 * @returns {Object} the json data from the testrun success file
 */
async function exec_truffle_test(cli_args, input_file_paths) {
  console.log(`> deploying ${input_file_paths.length} contracts: ${input_file_paths.map(p => path.basename(p)).join(' ')}`);
  try {
    // execute 'truffle test' in a subprocess
    // - all necessary arguments are passed in through the created file ./contracts/testrun/config.json
    // - stderr is relayed to the testrun error file
    // - stdout is hidden
    // await exec(`FN_CALL='${cli_args.fn_call || 'none'}' SOLC_VERSION=${cli_args.solc_version} TEST_FILE_PATHS=${input_file_paths} OUTPUT_FILE_PATH=${TESTRUN_SUCCESS_FILE} ${TESTRUN_TRUFFLE_TEST_CMD + ' 1>' + TESTRUN_ERROR_FILE}`, { cwd: __dirname });
    await exec(`${TESTRUN_TRUFFLE_TEST_CMD + ' 1>' + TESTRUN_ERROR_FILE}`, { cwd: __dirname });
  } catch (err) {
    // we do it like this to show truffe compile errors
    if (/Command failed:/.test(err)) {
      console.log('==== TRUFFLE ERROR ====', err);
      // if there is error output, print it
      fs.existsSync(TESTRUN_ERROR_FILE) && console.log(fs.readFileSync(TESTRUN_ERROR_FILE, 'utf8'));
      cleanup_testrun_dirs();
      process.exit(0);
    } 
    
    // this must some other error..
    throw err;
  }
  
  // retrieve the success json data from the "gatekeeper" file
  const success_data = JSON.parse(fs.readFileSync(TESTRUN_SUCCESS_FILE, 'utf8'));
  
  return success_data;
}

/**
 * used to prettify the table that is output to stdout by this tool
 * 
 * will alter the input number list to
 * - color the lowest number green
 * - for all others, add a red number indicating difference from the lowest number
 * 
 * Subgoal: vertically aligning the differences
 * 
 * ╔════════════════════════╤════════════════╤════════════╤══════════════╗
 * ║                        │ NewSafeMath    │ NoSafeMath │ OldSafeMath  ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ contract bytecode size │ 235  +106      │ 129        │ 157  +28     ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ deployment gas cost    │ 117035  +28110 │ 88925      │ 96429  +7504 ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ function call gas cost │ 21712  +82     │ 21630      │ 21707  +77   ║
 * ╚════════════════════════╧════════════════╧════════════╧══════════════╝
 *                                   |
 *                           convert | to
 *                                   v
 * ╔════════════════════════╤════════════════╤════════════╤══════════════╗
 * ║                        │ NewSafeMath    │ NoSafeMath │ OldSafeMath  ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ contract bytecode size │ 235     +106   │ 129        │ 157    +28   ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ deployment gas cost    │ 117035  +28110 │ 88925      │ 96429  +7504 ║
 * ╟────────────────────────┼────────────────┼────────────┼──────────────╢
 * ║ function call gas cost │ 21712   +82    │ 21630      │ 21707  +77   ║
 * ╚════════════════════════╧════════════════╧════════════╧══════════════╝
 *
 * @param {Number[]} number_arr - list of positive integers
 * @param {('codesize', 'deploymentGas', 'usageGas')} data_type - type of data to output in this row
 * @returns the formatted table row for the chosen data type
 */
function output_table_row(success_data, data_type) {  
  const number_arr = success_data.contract_names.map(contract_name => success_data[data_type][contract_name]);
  
  // get the lowest horizontal value
  const lowest_hori_num = Math.min(...number_arr);
  
  return number_arr.map((n, idx) => {
    const current_contract_name = success_data.contract_names[idx];
    
    // to be able to align the difference values, 
    // we need to know the longest value when looking at the (vertical) column
    // where longest is the character count of the written down number
    const longest_vert_num = Math.max(...[
      success_data.deploymentGas[current_contract_name],
      success_data.codesize[current_contract_name],
      success_data.usageGas[current_contract_name] || 0, // dirty fix to have default value
    ].map(n => n.toString().length));
     
    
    return n === lowest_hori_num
      // if this number is the lowest, color it green
      ? chalk.green(n)
      
      // otherwise, output the number + difference with lowest in red
      : `${n} ${' '.repeat(longest_vert_num - n.toString().length)} ${chalk.red('+' + (n - lowest_hori_num))}`
  });
}

/**
 * prints a colorized table to stdout with the results 
 *
 * @param {Boolean} include_fn_call - did we execute a function (i.e. was --function used in invocation)
 * @param {Object} success_data - the json success data from the successful truffle test execution
 */
function print_table(include_fn_call, success_data) {
  // the table simply is defined by an array of arrays
  const table_data = [
    // |                        | Contract 1     | Contract 2     | Contract 3   |
    ['', ...success_data.contract_names],
    // | contract size          | 100000  +10000 | 130000  +40000 | 90000        |
    ['contract bytecode size', ...output_table_row(success_data, 'codesize')],
    // | deployment gas cost    | 100000  +10000 | 130000  +40000 | 90000        |
    ['deployment gas cost', ...output_table_row(success_data, 'deploymentGas')],
  ];
  
  // if --function was used in invoking this tool, include gas cost of executing that function in the table
  include_fn_call && table_data.push(
    // | function call gas cost | 23000          | 47000  +24000  | 29000  +6000 |
    ['function call gas cost', ...output_table_row(success_data, 'usageGas')]
  );
  
  console.log(table(table_data));
};

//
// 
// 
// Start
// 
// 
// 

try {
  (async () => {
    // use argparse to parse the cli args
    const cli_args = gather_cli_args();
    
    if (cli_args.display_help) {
      console.log(fs.readFileSync(path.join(__dirname, 'HELP.txt'), 'utf8'));
      process.exit(0);
    }
    
    if (!cli_args.solidity_file_paths) {
      console.log('missing required option --contracts');
      console.log('--contracts <path> [<path> ...]   solidity contract path(s), supports glob');
      process.exit(0);
    }
    
    // convert to absolute paths
    const input_file_paths = cli_args.solidity_file_paths.map(p => path.join(process.cwd(), p));
    
    // create truffle-config.js file
    const truffle_config = setup_truffle_config(cli_args.solc_version, cli_args.optimizer_runs, cli_args.evm_version, cli_args.node_host, cli_args.node_port, cli_args.node_id, cli_args.node_websockets, cli_args.node_gas_limit);
    
    // create all necessary directories and copy all nevessary files to be able to do a testrun
    setup_testrun_dirs(input_file_paths, cli_args.fn_call);
    
    // run the truffle test which will deploy each contract (and execute the chosen function) 
    const success_data = await exec_truffle_test(cli_args, input_file_paths);

    // optional, writing formatted opcode files
    if (cli_args.disassembly_path) {
      write_disassembly_to_file(success_data.bytecode, cli_args.disassembly_path);
    }
    
    // prints the table with results to stdout
    print_table(!!cli_args.fn_call, success_data);
    
    // remove all testrun dirs
    cleanup_testrun_dirs();
  })();
} catch (err) {
  // just to be sure we always cleanup
  cleanup_testrun_dirs();
  throw err;
}