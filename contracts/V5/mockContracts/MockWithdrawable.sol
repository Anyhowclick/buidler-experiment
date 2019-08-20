pragma solidity 0.5.9;


import "../Withdrawable.sol";


contract MockWithdrawable is Withdrawable {
    constructor(address _admin) public Withdrawable(_admin) {}
    function () external payable {}
}
