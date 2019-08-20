const ConversionRates = artifacts.require("MockConversionRate.sol");
const TestToken = artifacts.require("TestToken.sol");
const Helper = require("./helper.js");

let validRateDurationInBlocks = 1000;
let numTokens = 17;
let tokens = [];
let minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
let maxPerBlockImbalance = 4000;
let maxTotalImbalance = maxPerBlockImbalance * 12;

contract('ConversionRates', function(accounts) {
    it("should init globals", function() {
        admin = accounts[0];
        alerter = accounts[1];
        operator = accounts[2];
        reserveAddress = accounts[3];
    })

    it("should init and set one instance of ConversionRates", async function () {
        //init contract
        convRatesInst = await ConversionRates.new(admin);
        // convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);
        // for (let i = 0; i < numTokens; ++i) {
        //     token = await TestToken.new("test" + i, "tst" + i, 18);
        //     tokens[i] = token.address;
        //     await convRatesInst.addToken(token.address);
        //     await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
        //     await convRatesInst.enableTokenTrade(token.address);
        // }
        // assert.deepEqual(tokens.length, numTokens, "bad number tokens");
        //
        // await convRatesInst.addOperator(operator);
        // await convRatesInst.setReserveAddress(reserveAddress);
        // await convRatesInst.addAlerter(alerter);
    });

    it("should fail to instantiate another instance without gas param", async function () {
        anotherConvRatesInst = await ConversionRates.new(admin);
    })

    it('should be able to instantiate another instance with gas param', async function () {
        anotherConvRatesInst = await ConversionRates.new(admin, {gas: 6000000})
    })

    it("should set general parameters, but complains of timeout.", async function () {
        //this.timeout(20000);
        //set pricing general parameters
        convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create and add tokens. actually only addresses...
        for (let i = 0; i < numTokens; ++i) {
            token = await TestToken.new("test" + i, "tst" + i, 18);
            tokens[i] = token.address;
            await convRatesInst.addToken(token.address);
            await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
            await convRatesInst.enableTokenTrade(token.address);
        }
        assert.deepEqual(tokens.length, numTokens, "bad number tokens");
    });

    it("should set general parameters with timeout specified.", async function () {
        this.timeout(20000);
        //set pricing general parameters
        convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create and add tokens. actually only addresses...
        for (let i = 0; i < numTokens; ++i) {
            token = await TestToken.new("test" + i, "tst" + i, 18);
            tokens[i] = token.address;
            await convRatesInst.addToken(token.address);
            await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
            await convRatesInst.enableTokenTrade(token.address);
        }
        assert.deepEqual(tokens.length, numTokens, "bad number tokens");

        await convRatesInst.addOperator(operator);
        await convRatesInst.setReserveAddress(reserveAddress);
        await convRatesInst.addAlerter(alerter);
    });
});
