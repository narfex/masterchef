require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("solidity-coverage");
const accounts = require('../accounts');

const networks = {
    localhost: {
        url: "http://127.0.0.1:8545"
    },
    bsc: {
        url: "https://bsc-dataseed.binance.org/",
        chainId: 56,
        gasPrice: 20000000000,
        accounts: [accounts.bsc.privateKey]
    },
	test: {
		url: "https://bsc-testnet.web3api.com/v1/KBR2FY9IJ2IXESQMQ45X76BNWDAW2TT3Z3",
    //url: "https://data-seed-prebsc-1-s1.binance.org:8545",
		chainId: 97,
		gasPrice: 20000000000,
        accounts: [accounts.bsc.privateKey]
	}
};

module.exports = {
    solidity: {
        version: "0.8.17",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: networks,
    etherscan: {
        apiKey: accounts.bscscan
    }
};
