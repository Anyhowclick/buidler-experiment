pragma solidity 0.5.9;


import "../Withdrawable.sol";


contract MockWithdrawable is Withdrawable {
    function () external payable {}
}
