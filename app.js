const EMBER_ADDRESS = 'bitcoincash:zqau9rtdjtvsw0a4uwklfqtet6h5g67wa5psj4rk4g';
let apiAvailable = false;

const FALLBACK_CONTRACTS = {
  emberDonationAddress: EMBER_ADDRESS,
  contracts: [
    {
      name: 'PusdBridgeVault',
      compiler: 'cashc 0.14.0',
      opcodes: 138,
      mainnetTokenAddress: 'bitcoincash:p...',
      functions: ['settleBridgeTransfer', 'reclaimExpired'],
    },
    {
      name: 'NostrDidBinder',
      compiler: 'cashc 0.14.0',
      opcodes: 54,
      mainnetTokenAddress: 'bitcoincash:p...',
      functions: ['bindNostrIdentity', 'rotateBinder'],
    },
    {
      name: 'MerkleRewardVault',
      compiler: 'cashc 0.14.0',
      opcodes: 169,
      mainnetTokenAddress: 'bitcoincash:p...',
      functions: ['claimReward', 'sweepExpired'],
    },
  ],
};

async function sha256HexBrowser(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setOutput(id, obj) {
  const el = document.getElementById(id);
  el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

async function initBackend() {
  const modeEl = document.getElementById('runtime-mode');
  try {
    const res = await fetch('/api/contracts');
    if (!res.ok) throw new Error('offline');
    const data = await res.json();
    apiAvailable = true;
    modeEl.textContent = 'LIVE CashScript 0.14.0 VM';
    renderContractsTable(data);
    if (data.xoTemplate) {
      setOutput('xo-output', data.xoTemplate);
    }
  } catch {
    apiAvailable = false;
    modeEl.textContent = 'Static Browser Preview (WebCrypto)';
    renderContractsTable(FALLBACK_CONTRACTS);
  }
}

function renderContractsTable(data) {
  const tbody = document.getElementById('contracts-tbody');
  tbody.innerHTML = data.contracts
    .map(
      (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td><code>${c.compiler}</code></td>
        <td>${c.opcodes} ops</td>
        <td><code>${c.functions.join(', ')}</code></td>
        <td><code>${c.mainnetTokenAddress}</code></td>
      </tr>`,
    )
    .join('');
}

async function runBridgeSimulation(tamperAttack = false) {
  const amountPusd = Number(document.getElementById('bridge-amount').value || 250);
  const nonce = Number(document.getElementById('bridge-nonce').value || 1);
  const secretPhrase = document.getElementById('bridge-secret').value || 'bch-blaze-2026-atomic-htlc';

  if (apiAvailable) {
    const res = await fetch('/api/bridge/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountPusd, nonce, secretPhrase, tamperAttack }),
    });
    const data = await res.json();
    setOutput('bridge-output', data);
    return;
  }

  const htlcHashHex = await sha256HexBrowser(secretPhrase);
  setOutput('bridge-output', {
    ok: !tamperAttack,
    mode: 'static-preview',
    vmResult: tamperAttack ? 'REJECTED_BY_COVENANT (Invalid bridge oracle data signature)' : 'ACCEPTED_IN_BCH_VM',
    settledPusd: amountPusd.toFixed(2),
    vaultRemainingPusd: (1000 - amountPusd).toFixed(2),
    htlcHashHex,
    note: 'Run `npm run serve` locally for live CashScript MockNetworkProvider VM txid execution.',
  });
}

async function runDidBind(freshKeys = false) {
  if (apiAvailable) {
    const res = await fetch('/api/did/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freshKeys }),
    });
    const data = await res.json();
    setOutput('did-output', data);
    return;
  }
  const pseudoPub = await sha256HexBrowser(`nostr-${freshKeys ? Date.now() : 'demo'}`);
  setOutput('did-output', {
    ok: true,
    mode: 'static-preview',
    didUri: `did:bch:nostr:${pseudoPub}`,
    bchTokenAddress: EMBER_ADDRESS,
    nftCommitmentHex: pseudoPub,
    note: 'Run `npm run serve` for live BIP-340 Schnorr + CashScript NostrDidBinder.cash VM anchoring.',
  });
}

async function runMerkleClaim() {
  const claimantIndex = Number(document.getElementById('merkle-index').value || 0);
  if (apiAvailable) {
    const res = await fetch('/api/merkle/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimantIndex }),
    });
    const data = await res.json();
    setOutput('merkle-output', data);
    return;
  }
  setOutput('merkle-output', {
    ok: true,
    mode: 'static-preview',
    claimantIndex,
    note: 'Run `npm run serve` for live 3-level SHA-256 MerkleRewardVault.cash VM claim execution.',
  });
}

async function buildMainnetTx() {
  const recipient = document.getElementById('mainnet-recipient').value.trim() || EMBER_ADDRESS;
  const satoshis = Math.max(546, Number(document.getElementById('mainnet-sats').value || 1000));
  const memo = document.getElementById('mainnet-memo').value.trim() || 'BCH BLAZE 2026 Mainnet PUSD Bridge';

  let payload;
  if (apiAvailable) {
    const res = await fetch('/api/mainnet/tx-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, satoshis, memo }),
    });
    payload = await res.json();
  } else {
    const amountBch = (satoshis / 1e8).toFixed(8);
    const bip21Uri = `${recipient}?amount=${amountBch}&message=${encodeURIComponent(memo)}`;
    payload = {
      ok: true,
      network: 'bitcoincash (mainnet)',
      recipient,
      satoshis,
      amountBch,
      bip21Uri,
      wc2Request: {
        chainId: 'bch:bitcoincash',
        request: {
          method: 'bch_signTransaction',
          params: {
            transaction: { version: 2, locktime: 0, outputs: [{ to: recipient, satoshis }] },
            broadcast: true,
            userPrompt: memo,
          },
        },
      },
      explorerUrl: `https://explorer.salemkode.com/address/${encodeURIComponent(recipient)}`,
    };
  }

  setOutput('mainnet-output', payload);
  const openBtn = document.getElementById('open-wallet-link');
  const expBtn = document.getElementById('explorer-link');
  if (payload.ok) {
    openBtn.href = payload.bip21Uri;
    openBtn.style.display = 'inline-block';
    expBtn.href = payload.explorerUrl;
    expBtn.style.display = 'inline-block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  initBackend();

  document.getElementById('copy-ember-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(EMBER_ADDRESS);
    document.getElementById('copy-ember-btn').textContent = 'Copied!';
    setTimeout(() => {
      document.getElementById('copy-ember-btn').textContent = 'Copy';
    }, 1500);
  });

  document.getElementById('btn-bridge-run').addEventListener('click', () => runBridgeSimulation(false));
  document.getElementById('btn-bridge-tamper').addEventListener('click', () => runBridgeSimulation(true));
  document.getElementById('btn-did-demo').addEventListener('click', () => runDidBind(false));
  document.getElementById('btn-did-fresh').addEventListener('click', () => runDidBind(true));
  document.getElementById('btn-merkle-claim').addEventListener('click', runMerkleClaim);
  document.getElementById('btn-mainnet-build').addEventListener('click', buildMainnetTx);

  buildMainnetTx();
});
