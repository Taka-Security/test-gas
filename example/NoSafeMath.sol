pragma solidity ^0.5.8;

contract NoSafeMath {
  function exec(uint _arg) external {
    _arg + 1;
  }
} 