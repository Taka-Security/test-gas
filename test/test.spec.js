const path = require('path');
const fs = require('fs');

const TESTRUN_CONTRACT_DIR = path.join(__dirname, '..', 'contracts', 'testrun');

contract('Testing', () => {
  let comparison;
  let contractNames = [];
  let fnName;
  let fnArgs = [];
  
  before(() => {    
    const testConfig = require(path.join(TESTRUN_CONTRACT_DIR, 'config.json'));
    const testfilePaths = fs.readdirSync(TESTRUN_CONTRACT_DIR); 
    
    testConfig.contracts.forEach((testfilePath) => {
      const contractName = path.basename(testfilePath, '.sol');
      contractNames.push(contractName);
    });      
    
    comparison = {
      contractNames: [],
      codesize: {},
      deploymentGas: {},
      usageGas: {},
    };
    
    if (!!process.env.FN_CALL) {
      fnName = process.env.FN_CALL.split('(')[0];
      fnArgs.push(...process.env.FN_CALL.replace(new RegExp(`${fnName}\\(`), '').trim().slice(0, -1).split(',').filter(x => !!x));
    }
  });
  
  after(() => {    
    fs.writeFileSync(process.env.OUTPUT_FILE_PATH, JSON.stringify(comparison, null, 2));
  });
  
  it('Test', async () => {
    for (let i = 0; i < contractNames.length; i += 1) {
      const contractName = contractNames[i];
      const contractArtifact = artifacts.require(path.join(TESTRUN_CONTRACT_DIR, contractName));
      const contractInstance = await contractArtifact.new();
      const contractCode = await web3.eth.getCode(contractInstance.address);
      comparison.contractNames.push(contractName);
      comparison.codesize[contractName] = (contractCode.length - 2) / 2;
      comparison.deploymentGas[contractName] = (await web3.eth.getTransactionReceipt(contractInstance.transactionHash)).gasUsed;
    
      if (!!process.env.FN_CALL) {
        console.log('innnn');
        const testTx = await contractInstance[fnName](...fnArgs);
        comparison.usageGas[contractName] = testTx.receipt.gasUsed;
      }
    }
  });
});