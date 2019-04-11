#!/usr/bin/env node

const path = require('path');
const fs = require('fs-plus');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const exec = require('util').promisify(require('child_process').exec);

const { ArgumentParser } = require('argparse');

function gatherCliArgs() {
  const argParser = new ArgumentParser({
    version: '0.0.1',
    addHelp: true,
    description: 'Test gas of multiple solidity function calls',
  });
    
  argParser.addArgument(
    [ '-f' ],
    {
      nargs: '+',  //wont work when passing as env var to truffle test
      required: true,
      metavar: '<path>',
      help: 'solidity test file path(s), e.g. ./contracts/*.sol',
      dest: 'solidity_file_paths',
    }
  );
  
  argParser.addArgument(
    [ '-s' ],
    {
      required: true,
      metavar: '<version>',
      help: 'solc version to use, e.g. 0.5.6',
      dest: 'solc_version',
    }
  );
  
  argParser.addArgument(
    [ '-o' ],
    {
      defaultValue: 0,
      metavar: '<runs>',
      type: 'int',
      help: 'number of optimizer runs, e.g. 200',
      dest: 'optimizer_runs',
    }
  );
  
  argParser.addArgument(
    [ '-c' ],
    {
      defaultValue: 'test()',
      metavar: '<function call>',
      help: 'function to call, e.g. \'testFn(2)\'',
      dest: 'fn_call',
    }
  );
  
  return argParser.parseArgs();
};

const TESTRUN_CONTRACT_DIR = path.join(__dirname, 'contracts', 'testrun');
const TESTRUN_OUTPUT_DIR = path.join(__dirname, 'test', 'testrun');

function setup_testrun_dirs(inputFilePaths) {
  cleanup_testrun_dirs();
  mkdirp.sync(TESTRUN_CONTRACT_DIR);
  mkdirp.sync(TESTRUN_OUTPUT_DIR);
  
  inputFilePaths.forEach((testfilePath) => {
    fs.writeFileSync( // move test file to correct location
      path.join(TESTRUN_CONTRACT_DIR, path.basename(testfilePath)),
      fs.readFileSync(testfilePath, 'utf8'),
    );
  }); 
}

function cleanup_testrun_dirs() {
  rimraf.sync(TESTRUN_CONTRACT_DIR);
  rimraf.sync(TESTRUN_OUTPUT_DIR);
}

function setup_solc(solc_version, optimizer_runs) {
  const currentTruffleJs = require(path.join(__dirname, 'truffle.bak.js'));
  currentTruffleJs.compilers.solc.version = solc_version;
  currentTruffleJs.compilers.solc.settings.optimizer.enabled = optimizer_runs > 0;
  currentTruffleJs.compilers.solc.settings.optimizer.runs = optimizer_runs;
  fs.writeFileSync(
    path.join(__dirname, 'truffle.js'),
    `module.exports = ${JSON.stringify(currentTruffleJs, null, 4)}` 
  );
}

async function main() {
  const cliArgs = gatherCliArgs();
  
  // absolute paths make our life easier
  const inputFilePaths = cliArgs.solidity_file_paths.map(p => path.join(process.cwd(), p));
  
  setup_solc(cliArgs.solc_version, cliArgs.optimizer_runs);
  setup_testrun_dirs(inputFilePaths);
  
  const outputSuccessFilePath = path.join(TESTRUN_OUTPUT_DIR, 'test_output.txt');
  const outputTruffleTestPath = path.join(TESTRUN_OUTPUT_DIR, 'truffle_output.txt');

  try {
    await exec(`FN_CALL='${cliArgs.fn_call}' SOLC_VERSION=${cliArgs.solc_version} TEST_FILE_PATHS=${inputFilePaths} OUTPUT_FILE_PATH=${outputSuccessFilePath} ${path.join(__dirname, 'node_modules', '.bin', 'truffle test 1>' + outputTruffleTestPath)}`, { cwd: __dirname });
  } catch (err) {
    if (/Command failed:/.test(err)) {
      console.log('==== TRUFFLE ERROR ====', err);
      fs.existsSync(outputTruffleTestPath) && console.log(fs.readFileSync(outputTruffleTestPath, 'utf8'));
      cleanup_testrun_dirs();
      process.exit(0);
    } 
    cleanup_testrun_dirs();
    throw err;
  }
    
  // print table with all results
  console.log(fs.readFileSync(outputSuccessFilePath, 'utf8'));
  cleanup_testrun_dirs();
};

main();
