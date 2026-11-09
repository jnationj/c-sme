import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("src/web/index.html"), "utf8");
const app = readFileSync(resolve("src/web/app.js"), "utf8");
const client = readFileSync(resolve("src/web/client.ts"), "utf8");
const styles = readFileSync(resolve("src/web/styles.css"), "utf8");

describe("wallet interface UI", () => {
  it("adds the landing hero, audience cards, and working CTA anchors without disturbing question entry", () => {
    expect(html).toContain("<h1>Know what works on Instagram and TikTok before you spend on it.</h1>");
    expect(html).toContain("Ask a real question about your niche. cPilot buys current data about public posts and accounts, counts what it finds, and writes you a cited report. You see the proposed price first and decide whether to approve a paid run in your wallet.");
    expect(html).toContain('href="#askTitle">Ask your first question</a>');
    expect(html).toContain('href="#how">See how it works</a>');
    expect(html).toContain("<h2 id=\"audienceTitle\">Who it's for</h2>");
    expect(html).toContain("Incoming settlement is not independently verified on-chain.");
    expect(html).toContain("See what posts and accounts get attention in your niche, from fashion and beauty to food and gadgets, before you plan your next drop.");
    expect(html).toContain("Find which hooks, formats and hashtags are working for accounts like yours, without scrolling through hundreds of videos.");
    expect(html).toContain("Check who is active in your market and how they post, so you spend on ads with a clearer picture.");
    expect(html).toContain("cPilot reads public posts and accounts only. It does not see anyone's sales or private data.");

    const heroIndex = html.indexOf('<section class="hero">');
    const askIndex = html.indexOf('<section id="vAsk"');
    const audienceIndex = html.indexOf('<section class="audience"');
    const howIndex = html.indexOf('<section id="how"');
    expect(heroIndex).toBeGreaterThan(-1);
    expect(askIndex).toBeGreaterThan(heroIndex);
    expect(audienceIndex).toBeGreaterThan(heroIndex);
    expect(audienceIndex).toBeGreaterThan(askIndex);
    expect(howIndex).toBeGreaterThan(audienceIndex);
    expect(html).toContain('<h2 id="howTitle">How it works</h2>');
    expect(html).toContain("<h3>1 · Ask</h3><p>Type a real question about your market, or start from an example.</p>");
    expect(html).toContain("<h3>2 · Review</h3><p>See which data it will buy, what each source adds, and the exact price.</p>");
    expect(html).toContain("<h3>3 · Pay</h3><p>Review the quote and approve a paid run in your wallet. Check the settlement status shown in the receipt.</p>");
    expect(html).toContain("<h3>4 · Read</h3><p>Get a cited report with the limits stated and a receipt for every purchase.</p>");
    expect(html.match(/id="askTitle"/g)).toHaveLength(1);
    expect(html.match(/id="how"/g)).toHaveLength(1);
    expect(html).toContain('<h2 id="askTitle">What do you want to know?</h2>');
    expect(html).toContain('<textarea id="q" maxlength="500"');
    expect(html).toContain('id="go" class="btn btn-primary"');

    expect(styles).toContain(".audience-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(styles).toContain(".how-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));");
    const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 560px)"));
    expect(mobileStyles).toContain(".audience-cards { grid-template-columns: 1fr; }");
    expect(mobileStyles).toContain(".how-steps { grid-template-columns: 1fr; }");
  });

  it("does not render a Celo portfolio section or portfolio balances in the home or wallet dialog", () => {
    const dialogStart = html.indexOf('<dialog id="signin"');
    const dialogEnd = html.indexOf("</dialog>", dialogStart);
    const walletBox = html.indexOf('<div id="walletBox"');
    const mainStart = html.indexOf('<main id="main">');
    const mainEnd = html.indexOf("</main>", mainStart);

    expect(walletBox).toBeGreaterThan(dialogStart);
    expect(walletBox).toBeLessThan(mainStart);
    expect(html.slice(dialogStart, dialogEnd)).not.toContain("Celo Mainnet assets");
    expect(html.slice(dialogStart, dialogEnd)).not.toContain("portfolioAssets");
    expect(html.slice(dialogStart, dialogEnd)).not.toContain("portfolioRefresh");
    expect(html.slice(mainStart, mainEnd)).not.toContain("CELO");
    expect(html.slice(mainStart, mainEnd)).not.toContain("portfolioAssets");
    expect(html).not.toContain('id="wbStopNote"');
    expect(html.slice(walletBox, dialogEnd)).toContain('id="wbAddr"');
    expect(html.slice(walletBox, dialogEnd)).toContain('id="wbNet"');
    expect(html.slice(walletBox, dialogEnd)).toContain('id="wbBal"');
  });

  it("renders from the shared wallet subscription when either wallet source activates", () => {
    expect(client).toContain('bridge.registerSource("injected"');
    expect(client).toContain('bridge.registerSource("privy"');
    expect(client).toMatch(/function useProvider\(source: WalletSource/);
    expect(client).toContain("void wallet.connect()");
    expect(app).toContain("W.subscribe(renderWallet)");
    expect(app).toContain('$("siTitle").textContent = connected ? "Wallet" : "Connect to pay";');
    expect(app).toContain('if (W.getState().conn === "connected") { showSignIn(); return; }');
    expect(app).toContain("cb.disabled = st.busy || (!connected && st.config && !st.config.ok);");
  });

  it("does not add portfolio refresh behavior to the wallet interface", () => {
    const showSignIn = app.slice(app.indexOf("function showSignIn()"), app.indexOf("function initAuthUI()"));
    expect(showSignIn).not.toContain("refreshPortfolio");
    expect(app.match(/W\.subscribe\(renderWallet\)/g)).toHaveLength(1);
    expect(app).not.toContain('$("portfolioRefresh").addEventListener');
    expect(app).toContain('$("siClose").addEventListener("click", function () { $("signin").close(); });');
  });

  it("retains wallet controls without portfolio-specific styling", () => {
    expect(html).toContain('id="wbStop"');
    expect(html).toContain('id="wbRefresh"');
    expect(html).toContain('id="wbSwitch"');
    const walletBox = html.indexOf('<div id="walletBox"');
    const signOut = html.indexOf('id="siSignOut"');
    const dialogEnd = html.indexOf("</dialog>");
    expect(walletBox).toBeLessThan(signOut);
    expect(signOut).toBeLessThan(dialogEnd);
    expect(app).toContain('$("siSignOut").hidden = status !== "ready";');
    expect(styles).not.toContain(".wallet-portfolio");
    expect(styles).not.toContain(".portfolio-assets");
  });
});
