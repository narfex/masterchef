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
    bscTestnet: {
        // url: "https://data-seed-prebsc-1-s1.binance.org:8545",
        url: "https://data-seed-prebsc-1-s1.binance.org:8545",
        chainId: 97,
        accounts: [accounts.bsc.privateKey]
    },
    polygon: {
        url: "https://polygon-rpc.com",
        chainId: 137,
        gasPrice: 140 * 1_000_000_000,
        accounts: [accounts.bsc.privateKey]
    },
    test: {
        url: "https://bsc-testnet.web3api.com/v1/KBR2FY9IJ2IXESQMQ45X76BNWDAW2TT3Z3",
        //url: "https://data-seed-prebsc-1-s1.binance.org:8545",
        chainId: 97,
        gasPrice: 20000000000,
            accounts: [accounts.bsc.privateKey]
	  },
    sepolia: {
        url: accounts.sepolia.rpc,
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
        apiKey: {
            mainnet: process.env.ETHERSCAN_TOKEN,
            ropsten: process.env.ETHERSCAN_TOKEN,
            rinkeby: process.env.ETHERSCAN_TOKEN,
            goerli: process.env.ETHERSCAN_TOKEN,
            kovan: process.env.ETHERSCAN_TOKEN,
            polygon: process.env.POLYGONSCAN_TOKEN,
            polygonMumbai: process.env.POLYGONSCAN_TOKEN,
            bsc: process.env.BSCSCAN_TOKEN,
            bscTestnet: process.env.BSCSCAN_TOKEN,
        }
    }
};
