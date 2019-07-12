const path = require('path');
const fs = require('fs');

const TESTRUN_CONTRACT_DIR = path.join(__dirname, '..', 'contracts', 'testrun');

contract('Testing', () => {
  let json_results = { 
    contract_names: [],
    bytecode: {},
    codesize: {},
    deploymentGas: {},
    usageGas: {},
  };
  let contract_names = [];
  let fn_name;
  let fn_args = [];
  let test_config;
  
  before(() => {    
    // this file has been created in the main test-gas process and contains all necessary data to execute the tests
    test_config = require(path.join(TESTRUN_CONTRACT_DIR, 'config.json'));
    
    contract_names = test_config.contract_names.map(testfilePath => path.basename(testfilePath, '.sol'));
    
    if (test_config.fn_call) {
      fn_name = test_config.fn_call.split('(')[0];
      fn_args.push(...test_config.fn_call.replace(new RegExp(`${fn_name}\\(`), '').trim().slice(0, -1).split(',').filter(x => !!x));
    }
  });
  
  after(() => {    
    // write json result data to the the success file
    // the success file is at a static location and acts as the gate between 
    // this truffle test execution and the main test-gas cli process
    fs.writeFileSync(test_config.output_file_path, JSON.stringify(json_results, null, 2));
  });
  
  it('Tests', async () => {
    for (let i = 0; i < contract_names.length; i += 1) {
      const contract_name = contract_names[i];
      const contract_artifact = artifacts.require(path.join(TESTRUN_CONTRACT_DIR, contract_name));
      const contract_instance = await contract_artifact.new();
      const contract_code = await web3.eth.getCode(contract_instance.address);
      
      json_results.contract_names.push(contract_name);
      json_results.bytecode[contract_name] = contract_code;
      json_results.codesize[contract_name] = (contract_code.length - 2) / 2;
      json_results.deploymentGas[contract_name] = (await web3.eth.getTransactionReceipt(contract_instance.transactionHash)).gasUsed;
    
      if (test_config.fn_call) {
        const testTx = await contract_instance[fn_name](...fn_args);
        json_results.usageGas[contract_name] = testTx.receipt.gasUsed;
      }
    }
  });
});