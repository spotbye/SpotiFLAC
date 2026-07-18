import { useState } from "react";
import { CircleCheck, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openExternal } from "@/lib/utils";
import KofiLogo from "@/assets/ko-fi.gif";
import KofiSvg from "@/assets/kofi_symbol.svg";
import LynkDarkLogo from "@/assets/lynk_d.png";
import LynkLightLogo from "@/assets/lynk_l.png";
import PatreonLogo from "@/assets/patreon.svg";
import PatreonSymbol from "@/assets/patreon_symbol.svg";
import UsdtTronQr from "@/assets/usdt.jpg";
import UsdtEvmQr from "@/assets/usdt_evm.jpg";
import UsdcEvmQr from "@/assets/usdc.jpg";
type CryptoCoin = "usdt" | "usdc";
type CryptoNetwork = "ethereum" | "bsc" | "polygon" | "base" | "tron";
const EVM_ADDRESS = "0xB563a7F39770C151e2FacE26926081a00c5EF349";
const TRON_ADDRESS = "THnzAAwZgp2Sq5CAXLP2njQDhTvgZG9EWs";
const NETWORKS: Record<Exclude<CryptoNetwork, "tron">, {
    value: CryptoNetwork;
    label: string;
    shortLabel: string;
}> = {
    ethereum: { value: "ethereum", label: "Ethereum (ERC20)", shortLabel: "ERC20" },
    bsc: { value: "bsc", label: "BNB Smart Chain (BEP20)", shortLabel: "BEP20" },
    polygon: { value: "polygon", label: "Polygon", shortLabel: "Polygon" },
    base: { value: "base", label: "Base", shortLabel: "Base" },
};
const EVM_NETWORKS: Array<{
    value: CryptoNetwork;
    label: string;
    shortLabel: string;
}> = [
    NETWORKS.bsc,
    NETWORKS.polygon,
    NETWORKS.ethereum,
    NETWORKS.base,
];
const USDT_NETWORKS: Array<{
    value: CryptoNetwork;
    label: string;
    shortLabel: string;
}> = [
    NETWORKS.ethereum,
    NETWORKS.bsc,
    { value: "tron", label: "Tron (TRC20)", shortLabel: "TRC20" },
    NETWORKS.polygon,
];
export function SupportPage() {
    const [selectedCoin, setSelectedCoin] = useState<CryptoCoin>("usdt");
    const [selectedNetwork, setSelectedNetwork] = useState<CryptoNetwork>("tron");
    const [copiedAddress, setCopiedAddress] = useState(false);
    const [copiedEmail, setCopiedEmail] = useState(false);
    const networkOptions = selectedCoin === "usdt" ? USDT_NETWORKS : EVM_NETWORKS;
    const activeNetwork = networkOptions.find((network) => network.value === selectedNetwork) || EVM_NETWORKS[0];
    const selectedNetworkLabel = activeNetwork.label;
    const selectedNetworkShortLabel = activeNetwork.shortLabel;
    const isTron = selectedNetwork === "tron";
    const cryptoAddress = isTron ? TRON_ADDRESS : EVM_ADDRESS;
    const cryptoQr = isTron ? UsdtTronQr : selectedCoin === "usdt" ? UsdtEvmQr : UsdcEvmQr;
    const handleCoinChange = (coin: CryptoCoin) => {
        setSelectedCoin(coin);
        setCopiedAddress(false);
        const nextNetworkOptions = coin === "usdt" ? USDT_NETWORKS : EVM_NETWORKS;
        if (!nextNetworkOptions.some((network) => network.value === selectedNetwork)) {
            setSelectedNetwork("ethereum");
        }
    };
    return (<div className="flex flex-col space-y-2">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-2xl font-bold tracking-tight">Support Me</h2>
        <Button variant="outline" size="sm" className="h-9 w-24 px-4" aria-label="Open LYNK.id" onClick={() => openExternal("https://tinyurl.com/tip-with-lynk")}>
          <span role="img" aria-label="LYNK.id" className="flex h-4 items-center justify-center">
            <img src={LynkLightLogo} alt="" aria-hidden="true" className="h-4 w-auto object-contain dark:hidden"/>
            <img src={LynkDarkLogo} alt="" aria-hidden="true" className="hidden h-4 w-auto object-contain dark:block"/>
          </span>
        </Button>
      </div>

      <div className="flex flex-col items-center justify-center">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-3">
          <div className="flex min-h-84 flex-col items-center justify-between space-y-4 border-b p-4 md:border-b-0 md:border-r">
            <div className="flex flex-col items-center space-y-2">
              <div className="relative flex h-32 w-full items-center justify-center">
                <img src={KofiLogo} className="pointer-events-none absolute w-64" alt="Ko-fi"/>
              </div>
              <h4 className="text-lg font-semibold text-foreground">Support via Ko-fi</h4>
              <p className="px-2 text-center text-sm leading-relaxed text-muted-foreground">
                Buy me a coffee to help keep development going.
              </p>
            </div>
            <Button className="h-9 w-4/5 gap-2 bg-[#72a4f2] text-sm font-semibold text-white hover:bg-[#5f8cd6]" onClick={() => openExternal("https://ko-fi.com/afkarxyz")}>
              <img src={KofiSvg} className="h-6 w-6 shrink-0" alt="" aria-hidden="true"/>
              Support me on Ko-fi
            </Button>
          </div>

          <div className="flex min-h-84 flex-col items-center justify-between space-y-4 border-b p-4 md:border-b-0 md:border-r">
            <div className="flex w-full flex-col items-center space-y-2">
              <div className="flex h-32 w-full items-center justify-center px-4">
                <img src={PatreonLogo} className="w-56 max-w-full brightness-0 dark:brightness-100" alt="Patreon"/>
              </div>
              <h4 className="text-lg font-semibold text-foreground">Support via Patreon</h4>
              <p className="px-2 text-center text-sm leading-relaxed text-muted-foreground">
                Join on Patreon to help fund the project and follow updates.
              </p>
            </div>
            <Button className="h-9 w-4/5 gap-2 bg-[#ff424d] text-sm font-semibold text-white hover:bg-[#e63945]" onClick={() => openExternal("https://www.patreon.com/cw/afkarxyz")}>
              <img src={PatreonSymbol} className="h-5 w-5 shrink-0" alt="" aria-hidden="true"/>
              Support me on Patreon
            </Button>
          </div>

          <div className="flex min-h-84 flex-col items-center justify-between gap-3 p-4">
            <div className="flex w-full flex-col items-center space-y-2">
              <div className="flex h-32 items-center justify-center">
                <div className="rounded-lg border bg-white p-1.5 shadow-sm">
                  <img src={cryptoQr} className="h-28 w-28 object-contain" alt={`${selectedCoin.toUpperCase()} ${selectedNetworkLabel} QR code`}/>
                </div>
              </div>
              <h4 className="text-lg font-semibold text-foreground">Support via Crypto</h4>
              <p className="px-2 text-center text-sm leading-relaxed text-muted-foreground">
                Prefer crypto? Use the QR code or wallet address below.
              </p>
            </div>

            <div className="w-full space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Coin</label>
                  <Select value={selectedCoin} onValueChange={(value: CryptoCoin) => handleCoinChange(value)}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usdt">USDT</SelectItem>
                      <SelectItem value="usdc">USDC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Network</label>
                  <Select value={selectedNetwork} onValueChange={(value: CryptoNetwork) => {
            setSelectedNetwork(value);
            setCopiedAddress(false);
        }}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue>{selectedNetworkShortLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {networkOptions.map((network) => (<SelectItem key={network.value} value={network.value}>{network.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-muted/50 py-1 pl-3 pr-1">
                <code className="truncate text-xs font-mono text-muted-foreground" title={cryptoAddress}>
                  {cryptoAddress}
                </code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:bg-background" aria-label="Copy wallet address" onClick={() => {
            navigator.clipboard.writeText(cryptoAddress);
            setCopiedAddress(true);
            setTimeout(() => setCopiedAddress(false), 500);
        }}>
                  {copiedAddress ? <CircleCheck className="h-3.5 w-3.5 text-green-500"/> : <Copy className="h-3.5 w-3.5"/>}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 w-full max-w-5xl rounded-xl border bg-muted/30 px-3 py-2 text-center text-sm text-muted-foreground">
          If you have any questions or need help with donating, feel free to reach out via{" "}
          <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => openExternal("https://t.me/afkarxyz")}>
            Telegram
          </button>{" "}
          or{" "}
          <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => {
            navigator.clipboard.writeText("hi@afkarxyz.fyi");
            setCopiedEmail(true);
            setTimeout(() => setCopiedEmail(false), 500);
        }}>
            {copiedEmail ? "copied" : "hi@afkarxyz.fyi"}
          </button>
        </div>
      </div>
    </div>);
}
