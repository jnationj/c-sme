// Browser-side x402 client. Bundled to web/client.js by scripts/build-web.mjs.
// The customer's own wallet (MetaMask etc.) signs a gasless USDC/USA₮ authorisation; no key ever touches our server.
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { createWalletClient, custom } from "viem";

declare global {
  interface Window {
    ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<any> };
    CP?: unknown;
  }
}

const hex = (n: number) => "0x" + n.toString(16);

async function connect(chainId: number) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet found. Install MetaMask (or open this page in a wallet browser).");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!address) throw new Error("No account selected");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(chainId) }] });
  } catch (e: any) {
    if (e?.code === 4902) {
      const sepolia = chainId === 11142220;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex(chainId),
            chainName: sepolia ? "Celo Sepolia" : "Celo",
            nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
            rpcUrls: [sepolia ? "https://forno.celo-sepolia.celo-testnet.org" : "https://forno.celo.org"],
            blockExplorerUrls: [sepolia ? "https://celo-sepolia.blockscout.com" : "https://celoscan.io"],
          },
        ],
      });
    } else throw e;
  }
  return address;
}

async function payFetch(address: `0x${string}`, url: string, init?: RequestInit) {
  const wallet = createWalletClient({ account: address, transport: custom(window.ethereum!) });
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: {
      address,
      signTypedData: (m) => wallet.signTypedData({ ...(m as any), account: address }),
    },
  });
  const pay = wrapFetchWithPayment(fetch, client);
  const res = await pay(url, init);
  const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let settlement: unknown;
  try {
    settlement = h ? decodePaymentResponseHeader(h) : undefined;
  } catch {
    settlement = undefined;
  }
  return { res, settlement };
}

window.CP = { connect, payFetch };
