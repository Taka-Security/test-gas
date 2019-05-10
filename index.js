#!/usr/bin/env node

const path = require('path');
const fs = require('fs-plus');
const exec = require('util').promisify(require('child_process').exec);

const { ArgumentParser } = require('argparse');

function gatherCliArgs() {
  const argParser = new ArgumentParser({
    version: '0.0.1',
    addHelp: true,
    description: 'Compare gas cost of executing multiple functions',
  });
    
  argParser.addArgument(
    [ '--contracts' ],
    {
      nargs: '+',  //wont work when passing as env var to truffle test
      required: true,
      metavar: '<path>',
      help: 'solidity test file glob path, e.g. ./contracts/*.sol',
      dest: 'solidity_file_paths',
    }
  );
  
  argParser.addArgument(
    [ '--solc' ],
    {
      required: true,
      metavar: '<version>',
      help: 'solc version to use, e.g. 0.5.6',
      dest: 'solc_version',
    }
  );
  
  argParser.addArgument(
    [ '--function' ],
    {
      required: true,
      metavar: '<function()>',
      help: 'function to call, e.g. \'testFn(2)\'',
      dest: 'fn_call',
    }
  );
  
  argParser.addArgument(
    [ '--evm' ],
    {
      defaultValue: 'petersburg',
      metavar: '<version>',
      choices: ['homestead', 'tangerineWhistle', 'spuriousDragon', 'byzantium', 'constantinople', 'petersburg'],
      help: 'evm version to use, e.g. byzantium',
      dest: 'evm_version',
    }
  );
  
  argParser.addArgument(
    [ '--optimizer' ],
    {
      defaultValue: 0,
      metavar: '<runs>',
      type: 'int',
      help: 'number of optimizer runs, e.g. 200',
      dest: 'optimizer_runs',
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

const TESTRUN_CONTRACT_DIR = path.join(__dirname, 'contracts', 'testrun');
const TESTRUN_OUTPUT_DIR = path.join(__dirname, 'test', 'testrun');

function create_network_json(node_host, node_port, node_id, node_websockets, node_gas_limit) {
  return {
    host: node_host || '127.0.0.1', 
    port: node_port || 8545, 
    network_id: node_id ? parseInt(node_id, 10) : '*', 
    websockets: !!node_websockets,
    gas: node_gas_limit || 7e6,
  };
}

function setup_testrun_dirs(inputFilePaths) {
  cleanup_testrun_dirs();
  fs.makeTreeSync(TESTRUN_CONTRACT_DIR);
  fs.makeTreeSync(TESTRUN_OUTPUT_DIR);
  
  inputFilePaths.forEach((testfilePath) => {
    fs.writeFileSync( // move test file to correct location
      path.join(TESTRUN_CONTRACT_DIR, path.basename(testfilePath)),
      fs.readFileSync(testfilePath, 'utf8'),
    );
  }); 
}

function cleanup_testrun_dirs() {
  fs.removeSync(TESTRUN_CONTRACT_DIR);
  fs.removeSync(TESTRUN_OUTPUT_DIR);
}

function setup_solc(solc_version, optimizer_runs, evm_version, node_host, node_port, node_id, node_websockets, node_gas_limit) {
  const currentTruffleJs = require(path.join(__dirname, 'truffle.bak.js'));
  currentTruffleJs.compilers.solc.version = solc_version;
  currentTruffleJs.compilers.solc.settings.optimizer.enabled = optimizer_runs > 0;
  currentTruffleJs.compilers.solc.settings.optimizer.runs = optimizer_runs;
  currentTruffleJs.compilers.solc.settings.evmVersion = evm_version;
  if (node_host || node_port || node_id || node_websockets || node_gas_limit) {
    currentTruffleJs.networks = {
      development: create_network_json(node_host, node_port, node_id, node_websockets, node_gas_limit),
    };
  }
    
  fs.writeFileSync(
    path.join(__dirname, 'truffle.js'),
    `module.exports = ${JSON.stringify(currentTruffleJs, null, 4)}` 
  );
}

async function main() {
  const cliArgs = gatherCliArgs();
  
  // absolute paths make our life easier
  const inputFilePaths = cliArgs.solidity_file_paths.map(p => path.join(process.cwd(), p));
  
  setup_solc(cliArgs.solc_version, cliArgs.optimizer_runs, cliArgs.evm_version, cliArgs.node_host, cliArgs.node_port, cliArgs.node_id, cliArgs.node_websockets, cliArgs.node_gas_limit);
  setup_testrun_dirs(inputFilePaths);
  
  const outputSuccessFilePath = path.join(TESTRUN_OUTPUT_DIR, 'test_output.txt');
  const outputTruffleTestPath = path.join(TESTRUN_OUTPUT_DIR, 'truffle_output.txt');

  console.log(`executing ${cliArgs.fn_call} in ${inputFilePaths.length} solidity test files`);

  try {
    await exec(`FN_CALL='${cliArgs.fn_call}' SOLC_VERSION=${cliArgs.solc_version} TEST_FILE_PATHS=${inputFilePaths} OUTPUT_FILE_PATH=${outputSuccessFilePath} ${path.join(__dirname, 'node_modules', '.bin', 'truffle test 1>' + outputTruffleTestPath)}`, { cwd: __dirname });
  } catch (err) {
    if (/Command failed:/.test(err)) {
      console.log('==== TRUFFLE ERROR ====', err);
      fs.existsSync(outputTruffleTestPath) && console.log(fs.readFileSync(outputTruffleTestPath, 'utf8'));
      // cleanup_testrun_dirs();
      process.exit(0);
    } 
    // cleanup_testrun_dirs();
    throw err;
  }
  
  // print solidity + network stats
  let nodeInfo;
  if (cliArgs.node_host || cliArgs.node_port || cliArgs.node_id || cliArgs.node_websockets || cliArgs.node_gas_limit) {
    // we used a custom ethereum node 
    const networkJson = create_network_json(cliArgs.node_host, cliArgs.node_port, cliArgs.node_id, cliArgs.node_websockets, cliArgs.node_gas_limit)
    console.log(`node host: ${networkJson.host} | node port: ${networkJson.port} | node id: ${networkJson.network_id} | node ws: ${networkJson.websockets?'yes':'no'} | node gas limit: ${cliArgs.node_gas_limit}`);
  } else {
    console.log('node host: truffle');
  }
  console.log(`solc: ${cliArgs.solc_version} | evm: ${cliArgs.evm_version} | optimizer runs: ${cliArgs.optimizer_runs}`);
  
  // print table with all results
  console.log(fs.readFileSync(outputSuccessFilePath, 'utf8'));
  
  cleanup_testrun_dirs();
};

main();
