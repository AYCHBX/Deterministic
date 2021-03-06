// (C) 2017 Internet of Coins / Joachim de Koning
// Deterministic encryption wrapper for Ethereum
const Decimal = require('../../common/crypto/decimal');
Decimal.set({ precision: 64 });

// inclusion of necessary requires
const wrapperlib = {
  ethUtil: require('ethereumjs-util'),
  EthTx: require('ethereumjs-tx'),
  ethABI: require('ethereumjs-abi')
};

/*
 21000 gas is charged for any transaction as a "base fee". This covers the cost of an elliptic curve operation to recover the sender address from the signature as well as the disk and bandwidth space of storing the transactio

Lower gas price means a slower transaction, but higher chance the tx doesn't burn thru its gas limit when the Eth network mempool is busy.

*/
// shim for randomBytes to avoid require('crypto') incompatibilities
// solves bug: "There was an error collecting entropy from the browser
const randomBytes = crypto.randomBytes;
if (typeof window === 'object') {
  const wCrypto = window.crypto || {};
  if (!wCrypto.getRandomValues) {
    wCrypto.getRandomValues = function getRandomValues (arr) {
      const bytes = randomBytes(arr.length);
      for (let i = 0; i < bytes.length; i++) {
        arr[i] = bytes[i];
      }
    };
  }
}

// encode ABI smart contract calls
// call it by explicitly specifying the variables you want to pass along
//
// EXAMPLES:
//            encode({ 'func':'balanceOf(address):(uint256)', 'vars':['target'], 'target':data.target });
//            encode({ 'func':'transfer(address,uint256):(uint256)', 'vars':['target','amount'], 'target':data.target,'amount':toHex(data.amount) });
function encode (data) {
  return '0x' + (new Function('wrapperlib', 'data', 'return wrapperlib.ethABI.simpleEncode(data.func,data.' + data.vars.join(',data.') + ');'))(wrapperlib, data).toString('hex');
}

// Expects string input and parses it to hexadecimal format
function toHex (input) {
  let result = new Decimal(input).toHex().toString('hex');
  return result ? result : '0x0';
}

const deterministic = {

  // create deterministic public and private keys based on a seed
  keys: function (data) {
    const privateKey = wrapperlib.ethUtil.sha256(data.seed);
    return {privateKey: privateKey};
  },
  // TODO importPublic
  // TODO sumKeys

  importPrivate: function (data) {
    return {privateKey: Buffer.from(data.privateKey, 'hex')};
  },

  // generate a unique wallet address from a given public key
  address: function (data) {
    const publicKey = wrapperlib.ethUtil.privateToPublic(data.privateKey);
    return '0x' + wrapperlib.ethUtil.publicToAddress(publicKey).toString('hex');
  },

  // return public key
  publickey: function (data) {
    const publicKey = wrapperlib.ethUtil.privateToPublic(data.privateKey);
    return publicKey.toString('hex');
  },

  // return private key
  privatekey: function (data) {
    return data.privateKey.toString('hex');
  },

  // create and sign a transaction
  transaction: function (data, dataCallback, errorCallback) {
    const hasValidMessage = typeof data.message !== 'undefined' && data.message !== null && data.message !== '';

    const fee = new Decimal(data.fee);
    if (!data.hasOwnProperty('unspent')) {
      errorCallback('Missing unspent (pre-transactional) data');
      return;
    }

    const gasBaseFee = new Decimal(data.unspent.gasBaseFee);
    const gasLimit = new Decimal(data.unspent.gasLimit);
    const gasDataFee = new Decimal(data.unspent.gasDataFee);
    /*

     The calculation done in the recipe:

     local::fee = gasPrice*gasBaseFee
     fee = local::fee + gasPrice * gasEstimation
         = gasPrice * gasBaseFee + gasPrice * gasEstimation
         = gasPrice * (gasBaseFee + gasEstimation)

     The reverse calculation to retrieve the gasPrice:
     => gasPrice = fee / (gasBaseFee+gasEstimation)

    */

    const gasPrice = fee.dividedBy(gasBaseFee.plus(gasDataFee));

    const txParams = {
      nonce: toHex(data.unspent.nonce),
      gasPrice: toHex(gasPrice.toFixed(0).toString()),
      gasLimit: toHex(gasLimit.toFixed(0).toString())
    };

    if (data.mode !== 'token') { // Base ETH mode
      txParams.to = data.target; // send it to ...
      txParams.value = toHex(data.amount); // the amount to send
      if (hasValidMessage) { // optionally add a message to the transaction
        txParams.data = data.message;
      }
    } else { // ERC20-compatible token mode
      const encoded = encode({ 'func': 'transfer(address,uint256):(bool)', 'vars': ['target', 'amount'], 'target': data.target, 'amount': toHex(data.amount) }); // returns the encoded binary data to be sent
      // TODO: optionally add a message to the transaction
      if (hasValidMessage) {
        errorCallback('Cannot send attachment data with ERC20 tokens yet!');
        return;
      }
      txParams.to = data.contract; // send payload to contract address
      txParams.value = '0x0'; // set to zero, since we're only sending tokens
      txParams.data = encoded; // payload as encoded using the smart contract
    }
    // Transaction is created
    const tx = new wrapperlib.EthTx(txParams);

    // Transaction is signed
    tx.sign(data.keys.privateKey);
    const serializedTx = tx.serialize();
    const rawTx = '0x' + serializedTx.toString('hex');
    dataCallback(rawTx);
  },
  encode: function (data) { return encode(data); } // used to compute token balances by ethereum/module.js
};

// export functionality to a pre-prepared var
window.deterministic = deterministic;
