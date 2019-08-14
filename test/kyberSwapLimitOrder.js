const BN = require('bignumber.js');
const truffleAssert = require("truffle-assertions");
const Helper = require("./helper.js");
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MockKyberNetwork = artifacts.require('MockKyberNetwork.sol');
const MockKyberNetworkProxy = artifacts.require('MockKyberNetworkProxy.sol');
const KyberSwapLimitOrder = artifacts.require('KyberSwapLimitOrder.sol');
const TestToken = artifacts.require('TestToken.sol');

/////////////////
/// Addresses ///
/////////////////
let user1PrivateKey = Helper.generatePrivateKey();
let user2PrivateKey = Helper.generatePrivateKey();
let user1Address = Helper.privateKeyToAddress(user1PrivateKey);
let user2Address = Helper.privateKeyToAddress(user2PrivateKey);
let user1Account = {'address': user1Address, 'privateKey': user1PrivateKey, 'nonce': 0};
let user2Account = {'address': user2Address, 'privateKey': user2PrivateKey, 'nonce': 0};

///////////////////////////////
/// Auto generated accounts ///
///////////////////////////////
let admin;
let operator;
let testTradeUser;

/////////////////
/// Contracts ///
/////////////////
let kncToken;
let omgToken;
let network;
let networkProxy;
let limitOrder;
let reentrancy;

//////////////////////////////////////////////
/// Contracts to be instantiated with web3 ///
//////////////////////////////////////////////
let kncTokenWeb3;
let omgTokenWeb3;
let limitOrderWeb3;

////////////////////
/// Token Params ///
////////////////////
let NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
let ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
let tokenDecimals = 18;
let tokenPrecision = (new BN('10')).pow(tokenDecimals);
let ratePrecision = tokenPrecision;
let initialEtherAmount = (new BN('10')).pow(tokenDecimals).multipliedBy(10); //10 ETH
let tokenRate = (new BN('10')).pow(tokenDecimals-2);
let userTokenQtyWei = (new BN('1000000')).multipliedBy(tokenPrecision); //1M tokens to user
let limitOrderWei = (new BN('100')).multipliedBy(tokenPrecision);
let maxTokenAllowance = new BN('2').pow(256).minus(1);
let maxFeePrecision = new BN('100').multipliedBy(new BN('10').pow(4));
let feeAmountInPrecision = new BN('10000'); //1%

///////////////////////
/// Other Variables ///
///////////////////////
let nonce;
let concatenatedAddresses;
let hint = Helper.getHint()

contract('KyberSwapLimitOrder', function(accounts) {
  before("setup", async() => {
    //admin account for deployment of contracts
    admin = accounts[0];

    //non-admin account
    operator = accounts[1];

    //test trade user for network trade
    testTradeUser = accounts[2];

    //send 10 ETH to addresses
    await Helper.sendEtherWithPromise(accounts[3], user1Address, initialEtherAmount.valueOf());
    await Helper.sendEtherWithPromise(accounts[4], user2Address, initialEtherAmount.valueOf());

    user1Balance = await Helper.getBalancePromise(user1Address);
    user2Balance = await Helper.getBalancePromise(user2Address);
    assert.equal(user1Balance.valueOf(),initialEtherAmount.valueOf(),"user1 initial ether balance not as expected");
    assert.equal(user2Balance.valueOf(),initialEtherAmount.valueOf(),"user2 initial ether balance not as expected");
  });

  it("deploy contracts and initialise values", async function () {
    kncToken = await TestToken.new("KyberNetworkCrystal", "KNC" , tokenDecimals, {from: admin});
    omgToken = await TestToken.new("OmiseGo", "OMG", tokenDecimals, {from: admin});
    network = await MockKyberNetwork.new({from: admin});
    networkProxy = await MockKyberNetworkProxy.new(network.address, {from: admin});
    assert.equal(await networkProxy.networkContract(),network.address,"Network addresses don't tally")
    await network.setProxyContract(networkProxy.address, {from: admin});
    assert.equal(await network.networkProxyContract(),networkProxy.address,"Network proxy addresses don't tally")
    limitOrder = await KyberSwapLimitOrder.new(admin, networkProxy.address, {from: admin});
    assert.equal(await limitOrder.kyberNetworkProxy(),networkProxy.address, {from: admin});

    //transfer 1M kncTokens to user1 and testTradeUser
    await kncToken.transfer(user1Address, userTokenQtyWei.toFixed(), {from: admin});
    await kncToken.transfer(testTradeUser, userTokenQtyWei.toFixed(), {from: admin});

    //transfer 1M omgTokens to user1 and testTradeUser
    await omgToken.transfer(user1Address, userTokenQtyWei.toFixed(), {from: admin});
    await omgToken.transfer(testTradeUser, userTokenQtyWei.toFixed(), {from: admin});

    //transfer ETH to network contract
    let initialEther = (new BN(10)).pow(18).multipliedBy(50); //50 ether
    await Helper.sendEtherWithPromise(accounts[8], network.address, initialEther.toFixed());
  });

  it("should re-instantiate relevant contracts via web3", async function() {
    //needed for signing and broadcasting txs with web3 generated accounts
    kncTokenWeb3 = new web3.eth.Contract(kncToken.abi, kncToken.address);
    omgTokenWeb3 = new web3.eth.Contract(omgToken.abi, omgToken.address);
    limitOrderWeb3 = new web3.eth.Contract(limitOrder.abi, limitOrder.address);
  });

  it("should not have limit order contract instantiated with null addresses", async function() {
    try {
      await KyberSwapLimitOrder.new(NULL_ADDRESS, networkProxy.address, {from: admin});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }

    try {
      await KyberSwapLimitOrder.new(admin, NULL_ADDRESS, {from: admin});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have user1 give allowance to token contracts", async function () {
    //user1 give allowance to limit order contract for trades
    data = kncTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user1Account,kncToken.address,data);
    data = omgTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user1Account,omgToken.address,data);

    actualKncAllowance = await kncToken.allowance(user1Address,limitOrder.address);
    actualOmgAllowance = await omgToken.allowance(user1Address,limitOrder.address);
    actualKncAllowance = new BN(actualKncAllowance);
    actualOmgAllowance = new BN(actualOmgAllowance);

    assert.equal(maxTokenAllowance.valueOf(),actualKncAllowance.valueOf(),"actual KNC token allowance not equal to expected")
    assert.equal(maxTokenAllowance.valueOf(),actualOmgAllowance.valueOf(),"actual OMG token allowance not equal to expected")
  });

  it("should initialise network, rate and test trade", async function () {
    //kncToken -> ETH
    await network.setPairRate(kncToken.address, ETH_ADDRESS, tokenRate.toFixed(), {from: admin});
    actualRates = await network.getExpectedRate.call(kncToken.address,ETH_ADDRESS,1000);
    actualExpectedRate = actualRates[0];
    assert.equal(tokenRate.valueOf(),actualExpectedRate.valueOf(),"Incorrect expected rate for kncToken")

    //omgToken -> ETH
    await network.setPairRate(omgToken.address, ETH_ADDRESS, tokenRate.toFixed(), {from: admin});
    actualRates = await network.getExpectedRate.call(omgToken.address,ETH_ADDRESS,1000);
    actualExpectedRate = actualRates[0];
    assert.equal(tokenRate.valueOf(),actualExpectedRate.valueOf(),"Incorrect expected rate for omgToken")

    //test user gives allowance to networkProxy for test trade
    await kncToken.approve(networkProxy.address, maxTokenAllowance.toFixed(), {from: testTradeUser});
    await omgToken.approve(networkProxy.address, maxTokenAllowance.toFixed(), {from: testTradeUser});

    //Perform test trade of 1000 kncToken wei with networkProxy
    //testTradeUser performs trade, but sends converted ETH to admin, since he'll be paying for gas
    //ie. destAddress = admin
    let srcTokenWei = 1000;
    let initialBalanceEther = await Helper.getBalancePromise(admin);
    let initialTokenBalance = await kncToken.balanceOf.call(testTradeUser);
    initialTokenBalance = new BN(initialTokenBalance);
    await networkProxy.tradeWithHint(kncToken.address, srcTokenWei, ETH_ADDRESS, admin,
      1000000, 0, NULL_ADDRESS, hint, {from: testTradeUser});
    let expectedEtherPayment = (new BN(srcTokenWei)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    let expectedEtherBalance = expectedEtherPayment.plus(initialBalanceEther);
    let expectedTokenBalance = initialTokenBalance.minus(srcTokenWei);
    let actualEtherBalance = await Helper.getBalancePromise(admin);
    actualEtherBalance = new BN(actualEtherBalance);
    let actualTokenBalance = await kncToken.balanceOf.call(testTradeUser);
    actualTokenBalance = new BN(actualTokenBalance);
    assert.equal(actualEtherBalance.valueOf(), expectedEtherBalance.valueOf(),"Ether balance not as expected after KNC -> ETH trade");
    assert.equal(actualTokenBalance.valueOf(), expectedTokenBalance.valueOf(), "Token balance not as expected after KNC -> ETH trade");

    //Perform test trade of 1000 omgToken wei with networkProxy
    initialBalanceEther = await Helper.getBalancePromise(admin);
    initialTokenBalance = await omgToken.balanceOf.call(testTradeUser);
    initialTokenBalance = new BN(initialTokenBalance);
    await networkProxy.tradeWithHint(omgToken.address, srcTokenWei, ETH_ADDRESS, admin,
      1000000, 0, NULL_ADDRESS, hint, {from: testTradeUser});
    expectedEtherPayment = (new BN(srcTokenWei)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    expectedEtherBalance = expectedEtherPayment.plus(initialBalanceEther);
    expectedTokenBalance = initialTokenBalance.minus(srcTokenWei);
    actualEtherBalance = await Helper.getBalancePromise(admin);
    actualEtherBalance = new BN(actualEtherBalance);
    actualTokenBalance = await omgToken.balanceOf.call(testTradeUser);
    actualTokenBalance = new BN(actualTokenBalance);
    assert.equal(actualEtherBalance.valueOf(), expectedEtherBalance.valueOf(),"Ether balance not as expected after OMG -> ETH trade");
    assert.equal(actualTokenBalance.valueOf(), expectedTokenBalance.valueOf(), "Token balance not as expected after OMG -> ETH trade");
  });

  it("should have operator added to limit order contract", async function() {
    await limitOrder.addOperator(operator,{from: admin});
    isOperator = await limitOrder.operators(operator);
    assert.isTrue(isOperator,"Operator was not added successfully");
  });

  it("should not have tokens listed by non-admin", async function() {
    try {
      await limitOrder.listToken(kncToken.address,{from: operator});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have tokens listed by admin", async function() {
    await limitOrder.listToken(kncToken.address, {from: admin});
    await limitOrder.listToken(omgToken.address, {from: admin});

    kncAllowance = await kncToken.allowance(limitOrder.address,networkProxy.address);
    omgAllowance = await omgToken.allowance(limitOrder.address,networkProxy.address);
    kncAllowance = new BN(kncAllowance);
    omgAllowance = new BN(omgAllowance);

    assert.equal(kncAllowance.valueOf(),maxTokenAllowance.valueOf(),"token listing failed by admin");
    assert.equal(omgAllowance.valueOf(),maxTokenAllowance.valueOf(),"token listing failed by admin");
  });

  it("should not have null address listed by admin", async function() {
    try {
      await limitOrder.listToken(NULL_ADDRESS, {from: admin});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should not have trades enabled by non-admin", async function() {
    try {
      //should fail if non-admin tries to enable trade
      await limitOrder.enableTrade({from: operator});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have trades enabled by admin", async function () {
    await limitOrder.enableTrade({from: admin});
    assert.isTrue(await limitOrder.tradeEnabled(), "trade was not enabled by admin");
  });

  it("should not have trades disabled by non-admin", async function () {
    try {
      await limitOrder.disableTrade({from: operator});
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have trades disabled by admin", async function () {
    await limitOrder.disableTrade({from: admin});
    assert.isFalse(await limitOrder.tradeEnabled(), "trade was not disabled by admin");
  });

  it("should return true for valid address in nonce", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    assert.isTrue(await limitOrder.validAddressInNonce.call(nonce),"returned false for valid address in nonce");
  });
  //
  it("should return false for invalid address in nonce", async function () {
    nonce = Helper.getNonce(networkProxy.address);
    assert.isFalse(await limitOrder.validAddressInNonce.call(nonce),"returned true for invalid address in nonce");
  });

  it("should correctly return concatenated token addresses in uint", async function () {
    expectedConcatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    actualConcatenatedAddresses = await limitOrder.concatTokenAddresses.call(kncToken.address,ETH_ADDRESS);
    actualConcatenatedAddresses = new BN(actualConcatenatedAddresses);
    assert.equal(expectedConcatenatedAddresses.valueOf(),actualConcatenatedAddresses.valueOf());
  });

  it("should correctly validate a valid signature", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.valueOf(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf());
    isValid = await limitOrder.verifySignature(sig.msgHash,sig.v,sig.r,sig.s,user1Address);
    assert(isValid,"either generated signature is invalid, or signature check is incorrect");
  });

  it("return false for illegal signatures - replacing different signed values", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.valueOf(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf());
    sigUser2 = Helper.getLimitOrderSignature(user2Account,nonce,kncToken.address,
      limitOrderWei.valueOf(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.valueOf());

    //wrong msgHash
    isValid = await limitOrder.verifySignature.call(sigUser2.msgHash,sigUser1.v,sigUser1.r,sigUser1.s,user1Address);
    assert.isFalse(isValid,"invalid signature was valid");

    //wrong v
    isValid = await limitOrder.verifySignature.call(sigUser1.msgHash,'0x1d',sigUser1.r,sigUser1.s,user1Address);
    assert.isFalse(isValid,"invalid signature was valid");

    //wrong r
    isValid = await limitOrder.verifySignature.call(sigUser1.msgHash,sigUser1.v,sigUser2.r,sigUser1.s,user1Address);
    assert.isFalse(isValid,"invalid signature was valid");

    //wrong s
    isValid = await limitOrder.verifySignature.call(sigUser1.msgHash,sigUser1.v,sigUser1.r,sigUser2.s,user1Address);
    assert.isFalse(isValid,"invalid signature was valid");

    //wrong user
    isValid = await limitOrder.verifySignature.call(sigUser1.msgHash,sigUser1.v,sigUser1.r,sigUser2.s,user2Address);
    assert.isFalse(isValid,"invalid signature was valid");
  });

  it("should return true for valid nonce", async function () {
    expectedNonce = Helper.getNonce(limitOrder.address);
    concatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    assert(await limitOrder.isValidNonce.call(user1Address,concatenatedAddresses.toFixed(),nonce),"returned false for valid nonce");
  });

  it("should return false for invalid nonce", async function () {
    nonce = Helper.getNonce(limitOrder.address,0); //timestamp of zero
    await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),nonce,{from: operator});
    assert.isFalse(await limitOrder.isValidNonce.call(operator,concatenatedAddresses.toFixed(),nonce),"returned true for invalid nonce");
  });

  it("should prevent updating with an old nonce", async function () {
    olderNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    newerNonce = Helper.getNonce(limitOrder.address);
    await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),newerNonce,{from: operator});
    try {
      await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),olderNonce,{from: operator});
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should correctly deduct fees for valid fees", async function () {
    expectedFeeAmount = feeAmountInPrecision.dividedBy(maxFeePrecision).multipliedBy(limitOrderWei);
    expectedTokenQtyToSwap = limitOrderWei.minus(expectedFeeAmount);

    result = await limitOrder.deductFee.call(limitOrderWei.toFixed(),feeAmountInPrecision.toFixed());
    actualTokenQtyToSwap = result[0];
    actualFeeAmount = result[1];
    assert.equal(expectedTokenQtyToSwap.valueOf(),actualTokenQtyToSwap.valueOf(),"token quantities to swap don't match");
    assert.equal(expectedFeeAmount.valueOf(),actualFeeAmount.valueOf(),"fee amounts don't match");
  });

  it("should revert when fee exceeds max fee precision", async function () {
    try {
      let exceededFeeAmount = maxFeePrecision.plus(1);
      await limitOrder.deductFee.call(limitOrderWei.toFixed(),exceededFeeAmount.toFixed());
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have zero srcQty if fee is 100%", async function () {
    expectedTokenQtyToSwap = new BN('0');
    expectedFeeAmount = limitOrderWei;

    result = await limitOrder.deductFee.call(limitOrderWei.toFixed(),maxFeePrecision.toFixed());
    actualTokenQtyToSwap = result[0];
    actualFeeAmount = result[1];
    assert.equal(expectedTokenQtyToSwap.valueOf(),actualTokenQtyToSwap.valueOf(),"token quantities to swap don't match");
    assert.equal(expectedFeeAmount.valueOf(),actualFeeAmount.valueOf(),"fee amounts don't match");
  });

  it("should return zero fees if fee is 0%", async function () {
    expectedTokenQtyToSwap = limitOrderWei;
    expectedFeeAmount = new BN('0');

    result = await limitOrder.deductFee.call(limitOrderWei.toFixed(),new BN('0').toFixed());
    actualTokenQtyToSwap = result[0];
    actualFeeAmount = result[1];
    assert.equal(expectedTokenQtyToSwap.valueOf(),actualTokenQtyToSwap.valueOf(),"token quantities to swap don't match");
    assert.equal(expectedFeeAmount.valueOf(),actualFeeAmount.valueOf(),"fee amounts don't match");
  });

  it("should correctly update nonce upon manually invalidating old orders", async function () {
    concatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    expectedNonce = Helper.getNonce(limitOrder.address);
    expectedNonce = expectedNonce.toLowerCase()
    await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),expectedNonce, {from: operator});
    actualNonce = await limitOrder.nonces.call(operator,concatenatedAddresses.toFixed());
    actualNonce = actualNonce.toString(16);
    //handle edge case where concatenatedAddresses' first char is zero
    if(actualNonce.length == 63) actualNonce = '0' + actualNonce;
    actualNonce = '0x' + actualNonce;
    assert.equal(expectedNonce,actualNonce,"expected nonce not equal to actual nonce");
  });

  it("should revert invalidateOldOrders if nonce is older than the one stored in the contract", async function () {
    concatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    olderNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    newerNonce = Helper.getNonce(limitOrder.address);
    await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),newerNonce);
    try {
      await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),olderNonce);
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert invalidateOldOrders for invalid address in nonce", async function() {
    concatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    nonce = Helper.getNonce(kncToken.address);
    try {
      await limitOrder.invalidateOldOrders(concatenatedAddresses.toFixed(),nonce);
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should enable trade for subsequent test cases", async function () {
    await limitOrder.enableTrade({from: admin});
    assert(await limitOrder.tradeEnabled())
  });

  it("should execute a valid limit order by operator", async function () {
    userInitialTokenBalance = await kncToken.balanceOf(user1Address);
    userInitialBalanceEther = await Helper.getBalancePromise(user1Address);
    expectedTokenBalance = new BN(userInitialTokenBalance).minus(limitOrderWei);

    feeAmount = feeAmountInPrecision.dividedBy(maxFeePrecision).multipliedBy(limitOrderWei);
    tokenQtyToSwap = limitOrderWei.minus(feeAmount);
    expectedEtherPayment = (new BN(tokenQtyToSwap)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    expectedEtherBalance = expectedEtherPayment.plus(userInitialBalanceEther);

    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.valueOf(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf());

    await limitOrder.executeLimitOrder(
      user1Address,nonce,kncToken.address,limitOrderWei.valueOf(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf(),
      sig.v,sig.r,sig.s,
      {from: operator}
    );

    let actualTokenBalance = await kncToken.balanceOf(user1Address);
    actualTokenBalance = new BN(actualTokenBalance);
    let actualEtherBalance = await Helper.getBalancePromise(user1Address);
    actualEtherBalance = new BN(actualEtherBalance);

    assert.equal(expectedTokenBalance.valueOf(),actualTokenBalance.valueOf(),"token balances did not tally after order");
    assert.equal(expectedEtherBalance.valueOf(),actualEtherBalance.valueOf(),"ether balances did not tally after order");
  });

  it("should not have a valid limit order executed by admin", async function() {
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,expectedNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: admin}
      );
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should not have a valid limit order executed by non-operator", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,expectedNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: testTradeUser}
      );
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should update nonce upon successful execution of a limit order", async function () {
    expectedNonce = Helper.getNonce(limitOrder.address);
    expectedNonce = expectedNonce.toLowerCase()
    sig = Helper.getLimitOrderSignature(user1Account,expectedNonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    await limitOrder.executeLimitOrder(
      user1Address,expectedNonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
      sig.v,sig.r,sig.s,
      {from: operator}
    );

    actualNonce = await limitOrder.nonces.call(user1Address,concatenatedAddresses.toFixed());
    actualNonce = actualNonce.toString(16)
    //handle edge case where concatenatedAddresses' first char is zero
    if(actualNonce.length == 63) actualNonce = '0' + actualNonce;
    actualNonce = '0x' + actualNonce;

    assert.equal(expectedNonce,actualNonce,"actual nonce does not match expected nonce in contract");
  });

  it("should revert if same limit order is sent after successful execution", async function () {
    //Successful limit order
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    await limitOrder.executeLimitOrder(
      user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
      sig.v,sig.r,sig.s,
      {from: operator}
    );

    try {
      //should fail because it's the same limit order
      let result = await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: admin}
      );
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order when user gives 0 allowance to limit order contract", async function () {
      try {
        //user1 gives zero allowance to limit order contract
        data = kncTokenWeb3.methods.approve(limitOrder.address,0).encodeABI();
        await Helper.sendTx(user1Account,kncToken.address,data);

        nonce = Helper.getNonce(limitOrder.address);
        sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
          limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch(e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }
  });

  it("should revert order when user does not give sufficient allowance to limit order contract", async function() {
    try {
      insufficientAllowanceAmt = limitOrderWei.minus(1);
      //user1 gives 1 token wei less than needed to limit order contract
      data = kncTokenWeb3.methods.approve(limitOrder.address,insufficientAllowanceAmt.toFixed()).encodeABI();
      await Helper.sendTx(user1Account,kncToken.address,data);

      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
        limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should not update nonce upon a failing limit order", async function () {
    expectedNonce = await limitOrder.nonces.call(user1Address,concatenatedAddresses.toFixed());
    expectedNonce = '0x' + expectedNonce.toString(16);

    try {
      //set zero allowance
      data = kncTokenWeb3.methods.approve(limitOrder.address,0).encodeABI();
      await Helper.sendTx(user1Account,kncToken.address,data);
      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
        limitOrderWei.valueOf(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

      //failing order: zero allowance
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch(e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }

    actualNonce = await limitOrder.nonces.call(user1Address,concatenatedAddresses.toFixed());
    actualNonce = '0x' + actualNonce.toString(16)
    assert.equal(expectedNonce,actualNonce,"actual nonce does not match expected nonce in contract");

    //reset to max token allowance
    data = kncTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user1Account,kncToken.address,data);
  });

  it("should revert order when user does not have enough tokens", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    user1KncTokenBalance = await kncToken.balanceOf(user1Address);
    swapAmount = new BN(user1KncTokenBalance);
    swapAmount = swapAmount.plus(1);

    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      swapAmount,ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,swapAmount.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong user", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user2Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong nonce", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    await sleep(100);
    wrongNonce = Helper.getNonce(limitOrder.address);
    try {
      await limitOrder.executeLimitOrder(
        user1Address,wrongNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong srcToken", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,omgToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong order amount", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    wrongOrderAmount = limitOrderWei.minus(1);

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,wrongOrderAmount.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong dest token", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        omgToken.address,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong dest address", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    //wrong dest address
    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong conversion rate", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    //wrong minConversionRate
    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,1,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong fee amount", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      wrongFeeAmount = feeAmountInPrecision.minus(100);
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,wrongFeeAmount.toFixed(),
        sigUser1.v,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong signature.v", async function () {
    wrongSigV = '0x1d';
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        wrongSigV,sigUser1.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong signature.r", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    sigUser2 = Helper.getLimitOrderSignature(user2Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser2.r,sigUser1.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid signed params - wrong signature.s", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sigUser1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    sigUser2 = Helper.getLimitOrderSignature(user2Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigUser1.v,sigUser1.r,sigUser2.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order for invalid address in nonce", async function () {
    //wrong address
    nonce = Helper.getNonce(kncToken.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }
  });

  it("should revert order for an unlisted token in limit order contract", async function () {
      unlistedToken = await TestToken.new("UnlistedToken", "ULT" , tokenDecimals, {from: admin});
      //transfer 1M tokens to user1 and testTradeUser
      await unlistedToken.transfer(user1Address, userTokenQtyWei.toFixed(), {from: admin});
      await unlistedToken.transfer(testTradeUser, userTokenQtyWei.toFixed(), {from: admin});

      //testTradeUser gives allowance to proxy contract
      await unlistedToken.approve(networkProxy.address, maxTokenAllowance.toFixed(), {from: testTradeUser});

      //user1 gives allowance to limit order contract
      unlistedTokenWeb3 = new web3.eth.Contract(unlistedToken.abi,unlistedToken.address);
      data = unlistedTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
      await Helper.sendTx(user1Account,unlistedToken.address,data);

      //list token in KyberNetwork
      await network.setPairRate(unlistedToken.address, ETH_ADDRESS, tokenRate.toFixed(), {from: admin});
      actualRates = await network.getExpectedRate.call(unlistedToken.address,ETH_ADDRESS,1000);
      actualExpectedRate = actualRates[0];
      assert.equal(tokenRate.valueOf(),actualExpectedRate.valueOf(),"Incorrect expected rate for ULT token")

      //perform test ULT -> ETH trade with testTradeUser
      let srcTokenWei = 1000;
      let initialBalanceEther = await Helper.getBalancePromise(admin);
      let initialTokenBalance = await unlistedToken.balanceOf.call(testTradeUser);
      initialTokenBalance = new BN(initialTokenBalance);

      await networkProxy.tradeWithHint(unlistedToken.address, srcTokenWei.toFixed(), ETH_ADDRESS, admin,
        1000000, 0, NULL_ADDRESS, hint, {from: testTradeUser});

      let expectedEtherPayment = (new BN(srcTokenWei)).multipliedBy(tokenRate).div(ratePrecision);
      expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
      let expectedEtherBalance = expectedEtherPayment.plus(initialBalanceEther);
      let expectedTokenBalance = initialTokenBalance.minus(srcTokenWei);
      let actualEtherBalance = await Helper.getBalancePromise(admin);
      actualEtherBalance = new BN(actualEtherBalance);
      let actualTokenBalance = await unlistedToken.balanceOf.call(testTradeUser);
      actualTokenBalance = new BN(actualTokenBalance);

      assert.equal(actualEtherBalance.valueOf(), expectedEtherBalance.valueOf(),"Ether balance not as expected after ULT -> ETH trade");
      assert.equal(actualTokenBalance.valueOf(), expectedTokenBalance.valueOf(), "Token balance not as expected after ULT -> ETH trade");

      //create and sign order
      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,unlistedToken.address,
        limitOrderWei.valueOf(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf());

      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,unlistedToken.address,limitOrderWei.valueOf(),
          ETH_ADDRESS,user1Address,0,feeAmountInPrecision.valueOf(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      };
  });

  it("should execute limit order for 0% fees", async function () {
    userInitialTokenBalance = await kncToken.balanceOf(user1Address);
    userInitialBalanceEther = await Helper.getBalancePromise(user1Address);
    expectedTokenBalance = new BN(userInitialTokenBalance).minus(limitOrderWei);

    feeAmount = 0;
    tokenQtyToSwap = limitOrderWei.minus(feeAmount);
    expectedEtherPayment = (new BN(tokenQtyToSwap)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    expectedEtherBalance = expectedEtherPayment.plus(userInitialBalanceEther);

    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,0);

    await limitOrder.executeLimitOrder(
      user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,0,
      sig.v,sig.r,sig.s,
      {from: operator}
    );

    let actualTokenBalance = await kncToken.balanceOf(user1Address);
    actualTokenBalance = new BN(actualTokenBalance);
    let actualEtherBalance = await Helper.getBalancePromise(user1Address);
    actualEtherBalance = new BN(actualEtherBalance);

    assert.equal(expectedTokenBalance.valueOf(),actualTokenBalance.valueOf(),"token balances did not tally after order");
    assert.equal(expectedEtherBalance.valueOf(),actualEtherBalance.valueOf(),"ether balances did not tally after order");
  });

  it("should revert order if fee charged is 100% (swapping nothing)", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,maxFeePrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,maxFeePrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert order if fee exceeds 100%", async function () {
      exceededFeeAmount = maxFeePrecision.plus(1);
      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
        limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,exceededFeeAmount.toFixed());
      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,0,maxFeePrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }
  });

  it("should revert for an old limit order", async function () {
    olderNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    newerNonce = Helper.getNonce(limitOrder.address);

    sigOldOrder = Helper.getLimitOrderSignature(user1Account,olderNonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    sigNewOrder = Helper.getLimitOrderSignature(user1Account,newerNonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    await limitOrder.executeLimitOrder(
      user1Address,newerNonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
      sigNewOrder.v,sigNewOrder.r,sigNewOrder.s,
      {from: operator}
    );

    try {
      await limitOrder.executeLimitOrder(
        user1Address,olderNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sigOldOrder.v,sigOldOrder.r,sigOldOrder.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should revert for old orders manually invalidated by users", async function () {
    olderNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    newerNonce = Helper.getNonce(limitOrder.address);

    data = limitOrderWeb3.methods.invalidateOldOrders(concatenatedAddresses.toFixed(),newerNonce).encodeABI();
    await Helper.sendTx(user1Account,limitOrder.address,data);
    sig = Helper.getLimitOrderSignature(user1Account,olderNonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    try {
      await limitOrder.executeLimitOrder(
        user1Address,olderNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should execute for a order of valid nonce if invalidateOldOrders function reverted", async function () {
    concatenatedAddresses = Helper.getConcatenatedTokenAddresses(kncToken.address,ETH_ADDRESS);
    //this nonce is used second to call invalidateOldOrders function, should revert
    olderNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    //this nonce is used first to call invalidateOldOrders function, should execute
    newerNonce = Helper.getNonce(limitOrder.address);
    await sleep(1);
    //this nonce is used last for the order, should execute
    newestNonce = Helper.getNonce(limitOrder.address);

    //invalidate orders
    data = limitOrderWeb3.methods.invalidateOldOrders(concatenatedAddresses.toFixed(),newerNonce).encodeABI();
    await Helper.sendTx(user1Account,limitOrder.address,data);
    try {
      data = limitOrderWeb3.methods.invalidateOldOrders(concatenatedAddresses.toFixed(),olderNonce).encodeABI();
      await Helper.sendTx(user1Account,limitOrder.address,data);
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }

    userInitialTokenBalance = await kncToken.balanceOf(user1Address);
    userInitialBalanceEther = await Helper.getBalancePromise(user1Address);
    expectedTokenBalance = new BN(userInitialTokenBalance).minus(limitOrderWei);

    feeAmount = feeAmountInPrecision.dividedBy(maxFeePrecision).multipliedBy(limitOrderWei);
    tokenQtyToSwap = limitOrderWei.minus(feeAmount);
    expectedEtherPayment = (new BN(tokenQtyToSwap)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    expectedEtherBalance = expectedEtherPayment.plus(userInitialBalanceEther);

    sig = Helper.getLimitOrderSignature(user1Account,newestNonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());

    await limitOrder.executeLimitOrder(
        user1Address,newestNonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );

    let actualTokenBalance = await kncToken.balanceOf(user1Address);
    let actualEtherBalance = await Helper.getBalancePromise(user1Address);
    actualTokenBalance = new BN(actualTokenBalance);
    actualEtherBalance = new BN(actualEtherBalance);
    assert.equal(expectedTokenBalance.valueOf(),actualTokenBalance.valueOf(),"token balances did not tally after order");
    assert.equal(expectedEtherBalance.valueOf(),actualEtherBalance.valueOf(),"ether balances did not tally after order");
  });

  it("should not be able to use funds in contract for execution of orders", async function() {
    //send 1M KNC tokens to limit order contract
    await kncToken.transfer(limitOrder.address, userTokenQtyWei.toFixed(), {from: admin});

    //user2 approve limit order contract
    data = kncTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user2Account,limitOrder.address,data);

    user2TokenBalance = await kncToken.balanceOf(user2Address);
    user2TokenBalance = new BN(user2TokenBalance);
    //check that user2 does not have any KNC tokens
    assert.equal(0,user2TokenBalance.valueOf(), "user2's token balance is not zero");

    expectedKncTokenBalance = await kncToken.balanceOf(limitOrder.address);
    expectedKncTokenBalance = new BN(expectedKncTokenBalance);
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user2Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed());

    try {
      await limitOrder.executeLimitOrder(
        user2Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }

    actualKncTokenBalance = await kncToken.balanceOf(limitOrder.address);
    actualKncTokenBalance = new BN(actualKncTokenBalance);
    assert.equal(expectedKncTokenBalance.valueOf(),actualKncTokenBalance.valueOf(),"KNC token balance in contract don't tally");
  });

  it("should work for multiple orders sent by different users for different tokens", async function () {
    //send 1M KNC and OMG tokens to user2
    await kncToken.transfer(user2Address, userTokenQtyWei.toFixed(), {from: admin});
    await omgToken.transfer(user2Address, userTokenQtyWei.toFixed(), {from: admin});

    //users to approve max allowance to limit order contract
    data = kncTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user1Account,kncToken.address,data);
    await Helper.sendTx(user2Account,kncToken.address,data);

    data = omgTokenWeb3.methods.approve(limitOrder.address,maxTokenAllowance.toFixed()).encodeABI();
    await Helper.sendTx(user1Account,omgToken.address,data);
    await Helper.sendTx(user2Account,omgToken.address,data);

    //get initial balances
    feeAmount = feeAmountInPrecision.dividedBy(maxFeePrecision).multipliedBy(limitOrderWei);
    tokenQtyToSwap = limitOrderWei.minus(feeAmount);
    expectedEtherPayment = (new BN(tokenQtyToSwap)).multipliedBy(tokenRate).div(ratePrecision);
    expectedEtherPayment = expectedEtherPayment.minus(expectedEtherPayment.mod(1));
    //since 2 orders of the same rate => same ETH receivable for each order
    expectedEtherPayment = expectedEtherPayment.multipliedBy(2);

    //calculate user1 expected balances
    user1KncTokenBalance = await kncToken.balanceOf(user1Address);
    user1OmgTokenBalance = await omgToken.balanceOf(user1Address);
    user1EtherBalance = await Helper.getBalancePromise(user1Address);
    user1EtherBalance = new BN(user1EtherBalance);
    expectedUser1KncTokenBalance = new BN(user1KncTokenBalance).minus(limitOrderWei);
    expectedUser1OmgTokenBalance = new BN(user1OmgTokenBalance).minus(limitOrderWei);
    expectedUser1EtherBalance = user1EtherBalance.plus(expectedEtherPayment);

    //calculate user2 expected balances
    user2KncTokenBalance = await kncToken.balanceOf(user2Address);
    user2OmgTokenBalance = await omgToken.balanceOf(user2Address);
    user2EtherBalance = await Helper.getBalancePromise(user2Address);
    user2EtherBalance = new BN(user2EtherBalance);
    expectedUser2KncTokenBalance = new BN(user2KncTokenBalance).minus(limitOrderWei);
    expectedUser2OmgTokenBalance = new BN(user2OmgTokenBalance).minus(limitOrderWei);
    expectedUser2EtherBalance = user2EtherBalance.plus(expectedEtherPayment);

    nonce = Helper.getNonce(limitOrder.address);
    //create 4 orders: 1 KNC -> ETH order and 1 OMG -> ETH order per person using the same nonce
    sigOrder1 = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    sigOrder2 = Helper.getLimitOrderSignature(user1Account,nonce,omgToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    sigOrder3 = Helper.getLimitOrderSignature(user2Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed());
    sigOrder4 = Helper.getLimitOrderSignature(user2Account,nonce,omgToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed());

    await limitOrder.executeLimitOrder(
      user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
      sigOrder1.v,sigOrder1.r,sigOrder1.s,
      {from: operator}
    );

    await limitOrder.executeLimitOrder(
      user1Address,nonce,omgToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
      sigOrder2.v,sigOrder2.r,sigOrder2.s,
      {from: operator}
    );

    await limitOrder.executeLimitOrder(
      user2Address,nonce,kncToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed(),
      sigOrder3.v,sigOrder3.r,sigOrder3.s,
      {from: operator}
    );

    await limitOrder.executeLimitOrder(
      user2Address,nonce,omgToken.address,limitOrderWei.toFixed(),
      ETH_ADDRESS,user2Address,0,feeAmountInPrecision.toFixed(),
      sigOrder4.v,sigOrder4.r,sigOrder4.s,
      {from: operator}
    );

    //get actual balances
    actualUser1KncTokenBalance = await kncToken.balanceOf(user1Address);
    actualUser1KncTokenBalance = new BN(actualUser1KncTokenBalance);
    actualUser1OmgTokenBalance = await omgToken.balanceOf(user1Address);
    actualUser1OmgTokenBalance = new BN(actualUser1OmgTokenBalance)
    actualUser1EtherBalance = await Helper.getBalancePromise(user1Address);
    actualUser1EtherBalance = new BN(actualUser1EtherBalance);
    actualUser2KncTokenBalance = await kncToken.balanceOf(user2Address);
    actualUser2KncTokenBalance = new BN(actualUser2KncTokenBalance);
    actualUser2OmgTokenBalance = await omgToken.balanceOf(user2Address);
    actualUser2OmgTokenBalance = new BN(actualUser2OmgTokenBalance);
    actualUser2EtherBalance = await Helper.getBalancePromise(user2Address);
    actualUser2EtherBalance = new BN(actualUser2EtherBalance);

    assert.equal(expectedUser1KncTokenBalance.valueOf(),actualUser1KncTokenBalance.valueOf(),"user1 KNC token balances don't match");
    assert.equal(expectedUser1OmgTokenBalance.valueOf(),actualUser1OmgTokenBalance.valueOf(),"user1 OMG token balances don't match");
    assert.equal(expectedUser1EtherBalance.valueOf(),actualUser1EtherBalance.valueOf(),"user1 Ether balances don't match");
    assert.equal(expectedUser2KncTokenBalance.valueOf(),actualUser2KncTokenBalance.valueOf(),"user2 KNC token balances don't match");
    assert.equal(expectedUser2OmgTokenBalance.valueOf(),actualUser2OmgTokenBalance.valueOf(),"user2 OMG token balances don't match");
    assert.equal(expectedUser2EtherBalance.valueOf(),actualUser2EtherBalance.valueOf(),"user2 Ether balances don't match");
  });

  it("should revert in the case of an reentrancy attack", async function () {
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,reentrancy.address,0,feeAmountInPrecision.toFixed());

    try {
      await reentrancy.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,reentrancy.address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
      assert(false,"throw was expected in line above.");
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });

  it("should have operator successfully execute the same limit order that failed due to slippage rates;", async function () {
      //set bad rate for KNC -> ETH
      badTokenRate =  (new BN('1000')).pow(tokenDecimals);
      userMinConversionRate = tokenRate.minus(1);
      await network.setPairRate(kncToken.address, ETH_ADDRESS, badTokenRate.toFixed(), {from: admin});

      //get limit order params
      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
        limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed());
      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }

      //set good rate
      await network.setPairRate(kncToken.address, ETH_ADDRESS, tokenRate.toFixed(), {from: admin});
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
  });

  it("should revert if non-operator tries to execute a failed limit order due to slippage rates;", async function () {
      //set bad rate for KNC -> ETH
      badTokenRate =  (new BN('1000')).pow(tokenDecimals);
      userMinConversionRate = tokenRate.minus(1);
      await network.setPairRate(kncToken.address, ETH_ADDRESS, badTokenRate.toFixed(), {from: admin});

      //get limit order params
      nonce = Helper.getNonce(limitOrder.address);
      sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
        limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed());
      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: operator}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }

      //set good rate
      await network.setPairRate(kncToken.address, ETH_ADDRESS, tokenRate.toFixed(), {from: admin});

      //outsider tries to send someone else's failed limit order
      try {
        await limitOrder.executeLimitOrder(
          user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
          ETH_ADDRESS,user1Address,userMinConversionRate.toFixed(),feeAmountInPrecision.toFixed(),
          sig.v,sig.r,sig.s,
          {from: testTradeUser}
        );
        assert(false,"throw was expected in line above.");
      } catch (e) {
        assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
      }
  });

  it("should revert when trades have been disabled", async function () {
    await limitOrder.disableTrade({from: admin});
    assert.isFalse(await limitOrder.tradeEnabled(), "trade was not disabled")
    nonce = Helper.getNonce(limitOrder.address);
    sig = Helper.getLimitOrderSignature(user1Account,nonce,kncToken.address,
      limitOrderWei.toFixed(),ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed());
    try {
      await limitOrder.executeLimitOrder(
        user1Address,nonce,kncToken.address,limitOrderWei.toFixed(),
        ETH_ADDRESS,user1Address,0,feeAmountInPrecision.toFixed(),
        sig.v,sig.r,sig.s,
        {from: operator}
      );
    } catch (e) {
      assert(Helper.isRevertErrorMessage(e),"expected throw but got: " + e);
    }
  });
});
