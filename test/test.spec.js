const path = require('path');
const fs = require('fs');
const AsciiTable = require('ascii-table');

const TESTRUN_CONTRACT_DIR = path.join(__dirname, '..', 'contracts', 'testrun');

contract('Testing', () => {
  let comparison;
  let contractNames = [];
  let fnName;
  let fnArgs = [];
  
  before(() => {    
    const testfilePaths = fs.readdirSync(TESTRUN_CONTRACT_DIR); 
    
    testfilePaths.forEach((testfilePath) => {
      const contractName = path.basename(testfilePath, '.sol');
      contractNames.push(contractName);
    });      
    
    comparison = {
      codesize: {},
      deploymentGas: {},
      usageGas: {},
    };
    
    fnName = process.env.FN_CALL.split('(')[0];
    fnArgs.push(...process.env.FN_CALL.replace(new RegExp(`${fnName}\\(`), '').trim().slice(0, -1).split(',').filter(x => !!x));
  });
  
  after(() => {
    const genDiff = (a, b) => {
      const result = a - b;
      if (result > 0) return `+${AsciiTable.alignRight(result, 8)}`;
      if (result < 0) return `-${AsciiTable.alignRight(result, 8)}`;
      return AsciiTable.alignRight(result, 9);
    };
    
    const genMultiDiff = (longestLine, highestGasCost, gasCost) => {
      if (gasCost === highestGasCost) return `✔${AsciiTable.alignRight(gasCost, longestLine)}`;
      return `${AsciiTable.alignRight(gasCost, longestLine)}`; 
    };
    
    const table = new AsciiTable();
    // const contractNameSlugs = contractNames.map(n => n.length > 9 ? `${n.slice(0,9)}..` : n);
    const longestLine = Math.max(...contractNames.map(x => x.length));
    table.setAlignRight(1);
    if (contractNames.length == 1) {
      table.setHeading('', ...contractNames);
      table.addRow('codesize', ...contractNames.map(contractName => comparison.codesize[contractName]));
      table.addRow('deploymentGas', ...contractNames.map(contractName => comparison.deploymentGas[contractName]));
      table.addRow('usageGas', ...contractNames.map(contractName => comparison.usageGas[contractName]));
    } else if (contractNames.length === 2) {
      table.setHeading('', ...contractNames, 'diff');
      table.addRow('codesize', ...contractNames.map(contractName => comparison.codesize[contractName]), genDiff(comparison.codesize[contractNames[1]], comparison.codesize[contractNames[0]]));
      table.addRow('deploymentGas', ...contractNames.map(contractName => comparison.deploymentGas[contractName]), genDiff(comparison.deploymentGas[contractNames[1]], comparison.deploymentGas[contractNames[0]]));
      table.addRow('usageGas', ...contractNames.map(contractName => comparison.usageGas[contractName]), genDiff(comparison.usageGas[contractNames[1]], comparison.usageGas[contractNames[0]]));
    } else {
      table.setHeading('', ...contractNames);
      let highest = Math.max(...contractNames.map(contractName => comparison.codesize[contractName]));
      table.addRow('codesize', ...contractNames.map(contractName => genMultiDiff(longestLine, highest, comparison.codesize[contractName])));
      highest = Math.max(...contractNames.map(contractName => comparison.deploymentGas[contractName]));
      table.addRow('deploymentGas', ...contractNames.map(contractName => genMultiDiff(longestLine, highest, comparison.deploymentGas[contractName])));
      highest = Math.max(...contractNames.map(contractName => comparison.usageGas[contractName]));
      table.addRow('usageGas', ...contractNames.map(contractName => genMultiDiff(longestLine, highest, comparison.usageGas[contractName])));        
    }
    
    fs.writeFileSync(process.env.OUTPUT_FILE_PATH, table.toString());
  });
  
  it('Test', async () => {
    for (let i = 0; i < contractNames.length; i += 1) {
      const contractName = contractNames[i];
      const contractArtifact = artifacts.require(path.join(TESTRUN_CONTRACT_DIR, contractName));
      const contractInstance = await contractArtifact.new();
      const contractCode = await web3.eth.getCode(contractInstance.address);
      
      comparison.codesize[contractName] = (contractCode.length - 2) / 2;
      comparison.deploymentGas[contractName] = (await web3.eth.getTransactionReceipt(contractInstance.transactionHash)).gasUsed;
      
      const testTx = await contractInstance[fnName](...fnArgs);
      comparison.usageGas[contractName] = testTx.receipt.gasUsed;
    }
  });
});