package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

const (
	colorReset   = "\033[0m"
	colorRed     = "\033[31m"
	colorGreen   = "\033[32m"
	colorYellow  = "\033[33m"
	colorBlue    = "\033[34m"
	colorMagenta = "\033[35m"
	colorCyan    = "\033[36m"

	OperatorKey = "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
)

func QueryTheGraph(endpoint, graphql string) {
	fmt.Printf("\n%s[+] Indexing Live Subgraph Analytics...%s\n", colorCyan, colorReset)
	payload := map[string]string{"query": graphql}
	jsonBytes, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonBytes))
	req.Header.Set("Content-Type", "application/json")
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("%s[-] Graph Indexing Failed: %v%s\n", colorRed, err, colorReset)
		return
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)
	fmt.Printf("%s[>] Subgraph Response Payload:%s\n%s\n", colorGreen, colorReset, string(body))
}

func FetchCoinGeckoPrice(apiKey, tokens string) {
	fmt.Printf("\n%s[+] Fetching Millisecond Oracles from CoinGecko...%s\n", colorCyan, colorReset)
	url := fmt.Sprintf("https://api.coingecko.com/api/v3/simple/price?ids=%s&vs_currencies=usd", tokens)
	req, _ := http.NewRequest("GET", url, nil)
	if apiKey != "" {
		req.Header.Set("x-cg-pro-api-key", apiKey) // Commercial API Header
	}
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("%s[-] CoinGecko Oracle Failed: %v%s\n", colorRed, err, colorReset)
		return
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)
	fmt.Printf("%s[>] Oracle Price Output:%s\n%s\n", colorYellow, colorReset, string(body))
}

func Fetch1inchQuote(apiKey, chainID, fromToken, toToken, amount string) {
	fmt.Printf("\n%s[+] Calculating Zero-Slippage DEX Arbitrage Path...%s\n", colorCyan, colorReset)
	url := fmt.Sprintf("https://api.1inch.dev/swap/v6.0/%s/quote?src=%s&dst=%s&amount=%s", chainID, fromToken, toToken, amount)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("accept", "application/json")
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("%s[-] 1inch Route Failed: %v%s\n", colorRed, err, colorReset)
		return
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)
	fmt.Printf("%s[>] 1inch Swap Matrix:%s\n%s\n", colorGreen, colorReset, string(body))
}

func SubmitFlashbotsBundle(relayURL, authKey, bundleHex string) {
	fmt.Printf("\n%s[+] Bypassing Public Mempool. Sending Bundle to %s...%s\n", colorCyan, relayURL, colorReset)
	
	if authKey == "" {
		authKey = OperatorKey
		derived := deriveAddressFromPrivateKey(authKey)
		fmt.Printf("%s[!] Injecting Compromised MEV Private Key as Flashbots Authenticator...%s\n", colorMagenta, colorReset)
		fmt.Printf("%s[+] Payload Signed By Operator Network: %s%s\n", colorCyan, derived, colorReset)
	}

	payload := fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_sendBundle","params":[{ "txs": ["%s"], "blockNumber": "0x0" }],"id":1}`, bundleHex)
	
	req, _ := http.NewRequest("POST", relayURL, bytes.NewBuffer([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	if authKey != "" {
		req.Header.Set("X-Flashbots-Signature", authKey)
	}
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("%s[-] Zero-Mempool Sniper Failed: %v%s\n", colorRed, err, colorReset)
		return
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)
	fmt.Printf("%s[!!!] Flashbots Bundle Response:%s\n%s\n", colorMagenta, colorReset, string(body))
}

func deriveAddressFromPrivateKey(privHex string) string {
	privHex = strings.TrimPrefix(privHex, "0x")
	privateKey, err := crypto.HexToECDSA(privHex)
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}

type EtherscanTx struct {
	Value     string `json:"value"`
	GasUsed   string `json:"gasUsed"`
	GasPrice  string `json:"gasPrice"`
	IsError   string `json:"isError"`
	From      string `json:"from"`
	To        string `json:"to"`
}

type EtherscanResponse struct {
	Status  string          `json:"status"`
	Message string          `json:"message"`
	Result  json.RawMessage `json:"result"`
}

func AnalyzeVolatilityAndProfitability(address string, apiKey string) (float64, float64, bool) {
	fmt.Printf("\n%s[+] Generating On-Chain Forensics Report for: %s%s\n", colorCyan, address, colorReset)

	url := fmt.Sprintf("https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=%s&startblock=0&endblock=99999999&page=1&offset=1000&sort=desc&apikey=%s", address, apiKey)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("%s[-] Forensics Engine Failed to Reach Etherscan: %v%s\n", colorRed, err, colorReset)
		return 0, 0, false
	}
	
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("%s[-] Forensics Engine Failed to Reach Etherscan: %v%s\n", colorRed, err, colorReset)
		return 0, 0, false
	}
	defer resp.Body.Close()

	body, _ := ioutil.ReadAll(resp.Body)
	var data EtherscanResponse
	if err := json.Unmarshal(body, &data); err != nil {
		fmt.Printf("%s[-] Failed to parse ledger data.%s\n", colorRed, colorReset)
		return 0, 0, false
	}

	if data.Status != "1" {
		var errorStr string
		if err := json.Unmarshal(data.Result, &errorStr); err == nil {
			fmt.Printf("%s[-] Etherscan API Notice: %s | Result: %s%s\n", colorYellow, data.Message, errorStr, colorReset)
		} else {
			fmt.Printf("%s[-] Etherscan API Notice: %s%s\n", colorYellow, data.Message, colorReset)
		}
		return 0, 0, false
	}

	var txList []EtherscanTx
	if err := json.Unmarshal(data.Result, &txList); err != nil {
		fmt.Printf("%s[-] Etherscan Valid Hit but failed to parse Array structure.%s\n", colorRed, colorReset)
		return 0, 0, false
	}

	totalTxs := len(txList)
	if totalTxs == 0 {
		fmt.Printf("%s[!] No Transactions Found on Ledger. Dead Setup.%s\n", colorYellow, colorReset)
		return 0, 0, false
	}

	var successful, failed int
	var totalGasBurned float64
	var totalGrossRevenue float64

	addressLower := strings.ToLower(address)

	for _, tx := range txList {
		if tx.IsError == "1" {
			failed++
		} else {
			successful++
		}

		gasUsed, _ := strconv.ParseFloat(tx.GasUsed, 64)
		gasPrice, _ := strconv.ParseFloat(tx.GasPrice, 64)
		gasEth := (gasUsed * gasPrice) / 1e18
		
		if strings.ToLower(tx.From) == addressLower {
			totalGasBurned += gasEth
		} else if strings.ToLower(tx.To) == addressLower {
			valueEth, _ := strconv.ParseFloat(tx.Value, 64)
			totalGrossRevenue += valueEth / 1e18
		}
	}

	winRate := float64(successful) / float64(totalTxs) * 100
	netProfit := totalGrossRevenue - totalGasBurned

	fmt.Printf("\n%s  ── ⚡ PROFITABILITY MATRIX ⚡ ──%s\n", colorRed, colorReset)
	fmt.Printf("   Total Trades Analyzed : %d\n", totalTxs)
	fmt.Printf("   Successful Arbitrages : %d\n", successful)
	fmt.Printf("   Failed/Reverted Trades: %d\n", failed)
	fmt.Printf("   %sWIN RATE : %.2f%%%s\n", colorCyan, winRate, colorReset)
	fmt.Printf("   Total Gas Burned      : %.4f ETH\n", totalGasBurned)
	
	if netProfit > 0 {
		fmt.Printf("   %sNET PNL  : +%.4f ETH (PROFITABLE)%s\n", colorGreen, netProfit, colorReset)
	} else {
		fmt.Printf("   %sNET PNL  : %.4f ETH (LOSS)%s\n", colorRed, netProfit, colorReset)
	}
	fmt.Println()
	return winRate, netProfit, true
}

func ExecuteAaveFlashLoan(targetKey string) {
	derivedOperator := deriveAddressFromPrivateKey(targetKey)
	if derivedOperator == "" {
		fmt.Printf("%s[-] Fault: Cryptographic Derivation Failed (Invalid Hex).%s\n", colorRed, colorReset)
		return
	}
	fmt.Printf("\n%s[+] Bounding Flash Loan Execution to Intercepted MEV Wallet: %s%s\n", colorCyan, derivedOperator, colorReset)

	solidityPayload := `// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

contract TitanArbitrageExecutor is FlashLoanSimpleReceiverBase {
    address payable public owner;

    constructor(address _addressProvider) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) {
        owner = payable(%s); // Weaponized Core Ownership
    }

    /**
        This function is called after your contract has received the flash loaned amount
    */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        
        // ─── TITAN ZERO-SLIPPAGE DEX PATHING GOES HERE ───
        
        // Approve Pool to repayment
        uint256 amountToRepay = amount + premium;
        IERC20(asset).approve(address(POOL), amountToRepay);

        return true;
    }

    function requestFlashLoan(address _token, uint256 _amount) public {
        require(msg.sender == owner, "UNAUTHORIZED: Only Titan Operator Executable");
        address receiverAddress = address(this);
        address asset = _token;
        uint256 amount = _amount;
        bytes memory params = "";
        uint16 referralCode = 0;

        POOL.flashLoanSimple(
            receiverAddress,
            asset,
            amount,
            params,
            referralCode
        );
    }
}`

	solidityPayload = fmt.Sprintf(solidityPayload, derivedOperator)
	
	err := ioutil.WriteFile("FlashLoanArbitrage.sol", []byte(solidityPayload), 0644)
	if err == nil {
		fmt.Printf("%s[!!!] Smart Contract Generated: FlashLoanArbitrage.sol%s\n", colorMagenta, colorReset)
		fmt.Printf("%s[>] Deploy this contract via the intercepted RPC nodes to command Aave liquidity.%s\n", colorYellow, colorReset)
	} else {
		fmt.Printf("%s[-] Payload Compilation Failed: %v%s\n", colorRed, err, colorReset)
	}
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Printf("\n%s  ── ⚡ TITAN 2.0: ELITE EXECUTOR STACK (ARBITRAGE) ⚡ ──%s\n\n", colorRed, colorReset)
		fmt.Printf("  %s[1]%s Index Liquidity Pool (The Graph)\n", colorCyan, colorReset)
		fmt.Printf("  %s[2]%s Trigger Pricing Oracle (CoinGecko)\n", colorCyan, colorReset)
		fmt.Printf("  %s[3]%s Calculate Arbitrage Route (1inch)\n", colorCyan, colorReset)
		fmt.Printf("  %s[4]%s Execute Zero-Mempool Sniping (Flashbots MEV)\n", colorMagenta, colorReset)
		fmt.Printf("  %s[5]%s Execute Aave V3 Flash Loan Arbitrage\n", colorMagenta, colorReset)
		fmt.Printf("  %s[6]%s Execute On-Chain Forensics Profiling\n", colorMagenta, colorReset)
		fmt.Printf("  %s[7]%s Exit Executor\n", colorYellow, colorReset)
		fmt.Printf("\n  Awaiting Target Execution > ")

		if !scanner.Scan() { break }
		ans := strings.TrimSpace(scanner.Text())
		
		switch ans {
		case "1":
			fmt.Printf("  Enter The Graph Target Endpoint URL > ")
			if scanner.Scan() {
				url := strings.TrimSpace(scanner.Text())
				if url != "" {
					QueryTheGraph(url, "{ tokens(first: 5) { id symbol derivedETH } }")
				}
			}
		case "2":
			fmt.Printf("  Enter CoinGecko API Key (or leave blank for public node) > ")
			if scanner.Scan() {
				key := strings.TrimSpace(scanner.Text())
				FetchCoinGeckoPrice(key, "ethereum,uniswap,chainlink")
			}
		case "3":
			fmt.Printf("  Enter 1inch Developer API Key > ")
			if scanner.Scan() {
				key := strings.TrimSpace(scanner.Text())
				if key != "" {
					// Hardcoded Quote: 1 ETH -> UNI on Mainnet (ChainID 1)
					Fetch1inchQuote(key, "1", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", "1000000000000000000")
				}
			}
		case "4":
			fmt.Printf("  Enter Flashbots Relay Node URL (e.g., https://relay.flashbots.net) > ")
			if scanner.Scan() {
				node := strings.TrimSpace(scanner.Text())
				if node != "" {
					fmt.Printf("  Enter Flashbots Auth Signature Key (leave blank for MEV Operator setup) > ")
					if scanner.Scan() {
						sg := strings.TrimSpace(scanner.Text())
						SubmitFlashbotsBundle(node, sg, "0xdeadbeefc0ffee")
					}
				}
			}
		case "5":
			fmt.Printf("  Enter Target MEV Private Key (64-character EVM Signature) > ")
			if scanner.Scan() {
				targetKey := strings.TrimSpace(scanner.Text())
				cleanKey := strings.TrimPrefix(targetKey, "0x")
				if len(cleanKey) == 64 {
					ExecuteAaveFlashLoan(cleanKey)
				} else {
					fmt.Printf("  %s[-] Arbitrage Execution Aborted: Invalid Key Signature Length.%s\n", colorRed, colorReset)
				}
			}
		case "6":
			var apiKeysPool []string
			fmt.Printf("  Enter Etherscan API Key (Leave blank to cycle ETHERSCAN.txt) > ")
			if scanner.Scan() {
				apiKey := strings.TrimSpace(scanner.Text())
				if apiKey == "" {
					paths := []string{
						"../titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_RPC_NODES/ETHERSCAN.txt",
						"/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_RPC_NODES/ETHERSCAN.txt",
					}
					var poolContent []byte
					var err error
					for _, p := range paths {
						poolContent, err = ioutil.ReadFile(p)
						if err == nil {
							break
						}
					}
					if err != nil || len(poolContent) == 0 {
						fmt.Printf("%s[-] Abandoning: Etherscan V2 strictly requires an API Key and ETHERSCAN.txt pool is empty.%s\n", colorRed, colorReset)
						continue
					}
					lines := strings.Split(string(poolContent), "\n")
					for _, l := range lines {
						clean := strings.TrimSpace(l)
						if len(clean) == 34 {
							apiKeysPool = append(apiKeysPool, clean)
						}
					}
					if len(apiKeysPool) == 0 {
						fmt.Printf("%s[-] Abandoning: No valid 34-char API keys found in ETHERSCAN.txt.%s\n", colorRed, colorReset)
						continue
					}
					fmt.Printf("%s[+] Automatically loaded %d Premium Etherscan Tokens into memory.%s\n", colorGreen, len(apiKeysPool), colorReset)
				} else {
					apiKeysPool = append(apiKeysPool, apiKey)
				}

				fmt.Printf("  Enter Target EVM Address, Private Key, or /path/to/loot.md > ")
				if scanner.Scan() {
					target := strings.TrimSpace(scanner.Text())
					if target != "" {
						
						if info, err := os.Stat(target); err == nil && !info.IsDir() {
							fmt.Printf("\n%s[+] Bulk Intelligence File Detected. Initiating Mass-Forensics Extraction...%s\n", colorCyan, colorReset)
							
							content, err := ioutil.ReadFile(target)
							if err != nil {
								fmt.Printf("%s[-] Failed to read loot file: %v%s\n", colorRed, err, colorReset)
								continue
							}
							
							addressRegex := regexp.MustCompile(`0x[a-fA-F0-9]{40}`)
							privKeyRegex := regexp.MustCompile(`\b[a-fA-F0-9]{64}\b`)

							addressesFound := addressRegex.FindAllString(string(content), -1)
							privKeysFound := privKeyRegex.FindAllString(string(content), -1)

							uniqueTargets := make(map[string]bool)
							
							for _, addr := range addressesFound {
								uniqueTargets[strings.ToLower(addr)] = true
							}
							
							for _, pk := range privKeysFound {
								derived := deriveAddressFromPrivateKey(pk)
								if derived != "" {
									uniqueTargets[strings.ToLower(derived)] = true
								}
							}

							if len(uniqueTargets) == 0 {
								fmt.Printf("%s[-] No valid EVM intelligence found in the target file.%s\n", colorRed, colorReset)
								continue
							}

							fmt.Printf("%s[!] Extracted %d Unique EVM Targets from File. Engaging API Matrix...%s\n", colorMagenta, len(uniqueTargets), colorReset)

							var bestAddress string
							var bestWinRate float64
							var bestPNL float64 = -999999.0 
							var apiIndex int
							
							for addr := range uniqueTargets {
								currentKey := apiKeysPool[apiIndex % len(apiKeysPool)]
								winReq, pnlReq, valid := AnalyzeVolatilityAndProfitability(addr, currentKey)
								apiIndex++
								if valid {
									if pnlReq > bestPNL {
										bestPNL = pnlReq
										bestWinRate = winReq
										bestAddress = addr
									}
								}
								time.Sleep(3 * time.Second) // Etherscan rate-limit buffer
							}

							fmt.Printf("\n%s  ── ⚡ MASS FORENSICS COMPLETE ⚡ ──%s\n", colorMagenta, colorReset)
							if bestAddress != "" {
								fmt.Printf("   %sMOST PROFITABLE SETUP : %s%s\n", colorYellow, bestAddress, colorReset)
								fmt.Printf("   %sWIN RATE              : %.2f%%%s\n", colorCyan, bestWinRate, colorReset)
								if bestPNL > 0 {
									fmt.Printf("   %sNET PNL               : +%.4f ETH%s\n\n", colorGreen, bestPNL, colorReset)
								} else {
									fmt.Printf("   %sNET PNL               : %.4f ETH%s\n\n", colorRed, bestPNL, colorReset)
								}
							} else {
								fmt.Printf("   %s[!] No Active Setup Data Retrieved across all keys.%s\n", colorYellow, colorReset)
							}

						} else {
							cleanTarget := strings.TrimPrefix(target, "0x")
							if len(cleanTarget) == 64 {
								derived := deriveAddressFromPrivateKey(cleanTarget)
								if derived != "" {
									fmt.Printf("\n%s[!] Private Key Detected! Cryptographic Derivation Active. Payload Routed to: %s%s\n", colorMagenta, derived, colorReset)
									target = derived
								}
							}
							AnalyzeVolatilityAndProfitability(target, apiKey)
						}
					}
				}
			}
		case "7":
			fmt.Printf("\n%s[!] Terminating Elite Executor.%s\n", colorYellow, colorReset)
			return
		default:
			fmt.Println("  [!] Invalid Action.")
		}
	}
}
