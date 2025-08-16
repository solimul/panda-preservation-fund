
//nvm install --lts 
//npm install -g pnpm
// pnpm add node
import { FUNDME_CONTRACT_ADDRESS, FUNDME_CONTRACT_ABI, NETWORK } from "./contract-ts";
import {
    defineChain,
    parseEther,
    createWalletClient,
    custom,
    createPublicClient,
    formatEther,
    WalletClient,
    PublicClient,
    Address,
    Chain,
    getAddress,
    getContract
} from "viem";

import "viem/window"
import { mainnet, sepolia, optimism, arbitrum } from 'viem/chains';


const supportedChains: Record<number, Chain> = {
    1: mainnet,
    11155111: sepolia,
    10: optimism,
    42161: arbitrum,
    // Add other chains as needed
};

interface ChainInfo {
    name: string;
    blockExplorer: string;
}

const supportedChainInfo: Record<string, ChainInfo> = {
    "mainnet": {
        name: 'Ethereum Mainnet',
        blockExplorer: 'https://etherscan.io/address/'
    },
    "sepolia": {
        name: 'Sepolia Testnet',
        blockExplorer: 'https://sepolia.etherscan.io/address/'
    },
    "optimism": {
        name: 'Optimism',
        blockExplorer: 'https://optimistic.etherscan.io'
    },
    "arbitrum": {
        name: 'Arbitrum One',
        blockExplorer: 'https://arbiscan.io'
    },
    "polygon": {
        name: 'Polygon',
        blockExplorer: 'https://polygonscan.com'
    },
    "bnb": {
        name: 'BNB Chain',
        blockExplorer: 'https://bscscan.com'
    }
};



const contractAddress: Address = getAddress(FUNDME_CONTRACT_ADDRESS);
const abi = FUNDME_CONTRACT_ABI;
const network:string = NETWORK;
const connectWalletBtn = document.getElementById("connectWalletBtn") as HTMLButtonElement;
const fundBtn = document.getElementById("fundBtn") as HTMLButtonElement;
const fundAmount = document.getElementById("fundAmount") as HTMLInputElement;
const interactionStatus = document.getElementById("interactionStatus") as HTMLSpanElement;
const totalRaised = document.getElementById("totalRaised") as HTMLSpanElement;
const progressBar = document.getElementById("progressBar") as HTMLDivElement;
const totalFunders = document.getElementById("totalFunders") as HTMLSpanElement;
const yourContribution = document.getElementById("yourContribution") as HTMLSpanElement;
const withdrawFundsBtn = document.getElementById("withdrawFundsBtn") as HTMLButtonElement;
const contractAddressSpan = document.getElementById("contractAddress") as HTMLSpanElement;
const chainNameSpan = document.getElementById("chainName") as HTMLSpanElement;
const heroSpan = document.getElementById("heroSpan") as HTMLSpanElement;

let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;
let connectedAccount: `0x${string}` | null = null;
const minimum_fundable: number = 0.01

/** generic function */
async function readContract<T>(funName: string, requiresAccount: boolean): Promise<T> {
    await setUpPublicClients();
    if (requiresAccount)
        await setUpWalletClients();

    return await publicClient!.readContract({
        address: contractAddress,
        abi: abi,
        functionName: funName,
        ...(requiresAccount && { account: connectedAccount! })
        // in the above, ... (spread operator) in this context is used for conditionally including properties in an object
    }).then((result) => result as T)
        .catch((error) => {
            const err = error as { shortMessage?: string, details?: string };
            const message = err?.details || err?.shortMessage || "Contract read failed";
            updateStatus(`<span class="error-bold-italic">${message}</span>`);
            return undefined as T;
        });
}

async function writeContract(funName: string, requiresValue: boolean = false, value: bigint = 0n, args: any[] = []): Promise<`0x${string}`> {
    await setUpPublicClients();
    await setUpWalletClients();

    const currentChain: Chain = await getCurrentChain(publicClient!);
    const { request } = await publicClient!.simulateContract({
        address: contractAddress,
        abi: abi,
        functionName: funName,
        args: args,
        chain: currentChain,
        account: connectedAccount,
        ...(requiresValue && { value: value })
    }).catch(error => {
        const reason = error?.walk?.()?.shortMessage || "Read failed";
        updateStatus(`<span class="error-bold-italic">${reason}</span>`);
    });
    return await walletClient!.writeContract(request) as `0x${string}`;
}

/** getters */
async function getCurrentChainID(): Promise<number> {
    if (typeof window.ethereum === "undefined") {
        updateStatus(`<span class="error-bold-italic">Please install an Ethereum-compatible wallet (such as MetaMask or Coinbase Wallet) to fund panda conservation.</span>`);
        throw new Error("Wallet not installed");
    }
    const chainIdHex = await window.ethereum!.request({ method: 'eth_chainId' });
    return parseInt(chainIdHex, 16);
}

async function getCurrentChain(client: PublicClient | WalletClient): Promise<Chain> {
    const chainId = await client.getChainId();

    if (supportedChains[chainId]) {
        return supportedChains[chainId];
    }

    // Fallback for unsupported chains
    return {
        id: chainId,
        name: `Unknown Chain (${chainId})`,
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        rpcUrls: {
            default: { http: [''] },
            public: { http: [''] }
        },
        testnet: true
    };
}

async function getNumberOfFunders(): Promise<number> {
    if (!publicClient) {
        publicClient = await createPublicClient({ transport: custom(window.ethereum!!) });
    }
    const currentChain = await getCurrentChain(publicClient);
    const nFunders: number = await readContract<number>("getNumberOfFunders", false) as number;
    return nFunders;
}

async function getContractBalance(): Promise<bigint> {
    setUpPublicClients();
    return await publicClient!.getBalance({
        address: contractAddress
    }) as bigint;
}

async function getContribution(): Promise<number> {
    return await readContract<number>("getMyContribution", true) as number;;
}

/** setters */

async function setUpWalletClients(): Promise<void> {
    if (!walletClient)
        walletClient = createWalletClient({ transport: custom(window.ethereum!) });
    if (!connectedAccount)
        [connectedAccount] = await walletClient.requestAddresses();
}

async function setUpPublicClients(): Promise<void> {
    if (!publicClient)
        publicClient = createPublicClient({ transport: custom(window.ethereum!) });
}


async function disconnect(): Promise<void> {
    connectedAccount = null;
    walletClient = null;
    connectWalletBtn.innerText = "Connect Wallet";
    updateStatus("Not connected");
}

async function connect(): Promise<void> {
    if (typeof window.ethereum == "undefined") {
        updateStatus(`<span class="error-bold-italic">Please install an Ethereum-compatible wallet (such as MetaMask or Coinbase Wallet) to fund panda conservation.</span>`);
        return;
    }
    const accounts = await window.ethereum!.request({ method: 'eth_accounts' });

    if (accounts.length > 0 && connectedAccount) {
        disconnect();
    }
    walletClient = await createWalletClient({ transport: custom(window.ethereum!) });
    const [account] = await walletClient.requestAddresses();
    connectedAccount = account;
    connectWalletBtn.innerText = account.slice(0, 6) + "..." + account.slice(-4);
    updateStatus(`Connected to <strong>${account}</strong>`);
    setUp();
}

function setUp(): void {
    setProgress();
    setNFunders();
    setContribution();
}

async function setProgress(): Promise<void> {
    if (!publicClient) {
        publicClient = await createPublicClient({ transport: custom(window.ethereum!) });
    }
    publicClient = createPublicClient({ transport: custom(window.ethereum!) });
    const balance = await getContractBalance();
    totalRaised.innerText = `Total Raised: ${formatEther(balance)} ETH`;
    updateProgressBar(Math.min((Number(formatEther(balance)) / 100) * 100, 100));
}

async function setNFunders(): Promise<void> {

    const nFunders: number = await getNumberOfFunders();
    totalFunders.innerText = `${nFunders}`;
}

async function setContribution(): Promise<void> {
    if (!walletClient)
        return;
    const contribution: number = await getContribution();
    console.log("Your contribution:", contribution);
    yourContribution.innerText = `${formatEther(contribution)}`;
}

/** Misc */

function updateProgressBar(progressPercentage: number) {
    progressBar.style.width = `${progressPercentage}%`;
    progressBar.style.background = `
        linear-gradient(90deg,
        #ff4d4d 0%,
        #ffcc00 30%,
        #00cc66 70%
        )
    `;
    progressBar.style.backgroundSize = `${progressPercentage}% 100%`;
}

function updateStatus(msg: string): void {
    interactionStatus.innerHTML = msg;
    highlightStatusElement()
}

function highlightStatusElement(): void {
    // 1. Make sure the element is focusable
    interactionStatus.tabIndex = -1;

    // 2. Smooth scroll to the element
    interactionStatus.scrollIntoView({
        behavior: 'smooth',
        block: 'center' // Scrolls to center the element vertically
    });

    // 3. Add glowing animation
    interactionStatus.classList.add('glowing-alert');

    // 4. Remove the glow after animation completes
    setTimeout(() => {
        interactionStatus.classList.remove('glowing-alert');
    }, 3000); // Matches CSS animation duration

    // 5. Focus for accessibility
    interactionStatus.focus();
}


/** Cores */
async function fund(): Promise<void> {
    if (typeof window.ethereum == "undefined") {
        updateStatus(`<span class="error-bold-italic">Please install an Ethereum-compatible wallet (such as MetaMask or Coinbase Wallet) to fund panda conservation.</span>`);
        return;
    }
    let ethAmount: number = parseFloat(fundAmount.value);
    if (ethAmount < minimum_fundable) {
        updateStatus(`<span class="error-bold-italic">Please enter at least ${minimum_fundable} ETH to fund.</span>`);
        return;
    }
    const amountInWei = parseEther(fundAmount.value);
    const hash = await writeContract("fund", true, amountInWei, []);
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    let msg: string = `Thank you for your donation of <strong>${ethAmount} ETH</strong>! Your support means a lot.`;
    if (receipt.status !== 'success')
        msg = "Transaction failed. Please try again.";
    else
        setUp();
    updateStatus(msg);
}

async function withdraw(): Promise<void> {
    const hash = await writeContract("withdraw", false, 0n, []);
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    let msg: string = "Funds withdrawn successfully!";
    if (receipt.status !== 'success')
        msg = "Transaction failed";
    else
        setUp();
    updateStatus(msg);

}

async function main(): Promise<void> {
    heroSpan.innerHTML =  `Powered By Ethereum ${supportedChainInfo[network].name}`;
    chainNameSpan.innerHTML = supportedChainInfo[network].name;
    contractAddressSpan.innerHTML = `<a href="${supportedChainInfo[network].blockExplorer}/${contractAddress}" 
     target="_blank" 
     rel="noopener noreferrer"
     class="contract-link"> ${contractAddress}</a>`;


    if (typeof window.ethereum === 'undefined') {
        updateStatus(`<span class="error-bold-italic">Please install an Ethereum-compatible wallet (such as MetaMask or Coinbase Wallet) to fund panda conservation.</span>`);
        return;
    }
    setUp();
}


connectWalletBtn.onclick = connect
fundBtn.onclick = fund
withdrawFundsBtn.onclick = withdraw
main()