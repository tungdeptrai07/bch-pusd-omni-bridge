import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex, decodeCashAddress, hexToBin, sha256 } from '@bitauth/libauth';
import {
  Contract,
  MockNetworkProvider,
  Network,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
} from 'cashscript';
import {
  buildMerkleTree8,
  buildPusdAttestationPayload,
  createBchNostrDidBinding,
  deriveBchIdentity,
  getMerkleProof8,
  signBchDataSig,
  verifyBchNostrDidBinding,
} from './src/crypto.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.join(__dirname, 'web');
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');
const XO_PATH = path.join(__dirname, 'xo', 'pusd-bridge-template.xo.json');

const pusdArtifact = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'PusdBridgeVault.json'), 'utf8'));
const didArtifact = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'NostrDidBinder.json'), 'utf8'));
const merkleArtifact = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'MerkleRewardVault.json'), 'utf8'));
const xoTemplate = JSON.parse(fs.readFileSync(XO_PATH, 'utf8'));

// Demo keys for live local VM execution (never use with real mainnet funds)
const DEMO_ORACLE_PRIV = hexToBin('1111111111111111111111111111111111111111111111111111111111111111');
const DEMO_GUARDIAN_PRIV = hexToBin('2222222222222222222222222222222222222222222222222222222222222222');
const DEMO_USER_PRIV = hexToBin('3333333333333333333333333333333333333333333333333333333333333333');
const DEMO_NOSTR_PRIV = hexToBin('4444444444444444444444444444444444444444444444444444444444444444');

const PUSD_CAT_HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DID_CAT_HEX = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FLDCH_CAT_HEX = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const PUSD_CAT_BYTES = hexToBin(PUSD_CAT_HEX).reverse();
const DID_CAT_BYTES = hexToBin(DID_CAT_HEX).reverse();
const FLDCH_CAT_BYTES = hexToBin(FLDCH_CAT_HEX).reverse();
const REFUND_LOCKTIME = 1800000000n;

const oracleMainnet = deriveBchIdentity(DEMO_ORACLE_PRIV, 'bitcoincash');
const guardianMainnet = deriveBchIdentity(DEMO_GUARDIAN_PRIV, 'bitcoincash');
const userMainnet = deriveBchIdentity(DEMO_USER_PRIV, 'bitcoincash');

const oracleMock = deriveBchIdentity(DEMO_ORACLE_PRIV, 'bchtest');
const guardianMock = deriveBchIdentity(DEMO_GUARDIAN_PRIV, 'bchtest');
const userMock = deriveBchIdentity(DEMO_USER_PRIV, 'bchtest');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

async function seedUtxo(provider, address, opts) {
  const raw = randomUtxo(opts);
  provider.addUtxo(address, raw);
  const all = await provider.getUtxos(address);
  return all.find((u) => u.txid === raw.txid && u.vout === raw.vout);
}

function getMainnetContractsInfo() {
  const mockProvider = new MockNetworkProvider({ network: Network.MAINNET });
  const pusdVault = new Contract(
    pusdArtifact,
    [oracleMainnet.pubkey, guardianMainnet.pubkey, PUSD_CAT_BYTES, DID_CAT_BYTES, REFUND_LOCKTIME],
    { provider: mockProvider },
  );
  const didBinder = new Contract(didArtifact, [userMainnet.pubkey, DID_CAT_BYTES], { provider: mockProvider });
  const sampleTree = buildMerkleTree8([
    { recipientPkh: userMainnet.pkh, rewardAmount: 500_000n },
    { recipientPkh: oracleMainnet.pkh, rewardAmount: 300_000n },
  ]);
  const merkleVault = new Contract(
    merkleArtifact,
    [sampleTree.root, FLDCH_CAT_BYTES, guardianMainnet.pubkey, REFUND_LOCKTIME],
    { provider: mockProvider },
  );

  return {
    emberDonationAddress: userMainnet.tokenAddress,
    contracts: [
      {
        name: pusdArtifact.contractName,
        compiler: `${pusdArtifact.compiler.name} ${pusdArtifact.compiler.version}`,
        opcodes: pusdArtifact.bytecode.trim().split(/\s+/).length,
        mainnetAddress: pusdVault.address,
        mainnetTokenAddress: pusdVault.tokenAddress,
        functions: pusdArtifact.abi.map((f) => f.name),
      },
      {
        name: didArtifact.contractName,
        compiler: `${didArtifact.compiler.name} ${didArtifact.compiler.version}`,
        opcodes: didArtifact.bytecode.trim().split(/\s+/).length,
        mainnetAddress: didBinder.address,
        mainnetTokenAddress: didBinder.tokenAddress,
        functions: didArtifact.abi.map((f) => f.name),
      },
      {
        name: merkleArtifact.contractName,
        compiler: `${merkleArtifact.compiler.name} ${merkleArtifact.compiler.version}`,
        opcodes: merkleArtifact.bytecode.trim().split(/\s+/).length,
        mainnetAddress: merkleVault.address,
        mainnetTokenAddress: merkleVault.tokenAddress,
        functions: merkleArtifact.abi.map((f) => f.name),
      },
    ],
    xoTemplate,
  };
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, {
          status: 'ok',
          project: 'BCH Blaze Hub',
          hackathon: 'BCH BLAZE 2026',
          compiler: `${pusdArtifact.compiler.name} ${pusdArtifact.compiler.version}`,
          contractsCompiled: 3,
        });
      }

      if (url.pathname === '/api/contracts') {
        return sendJson(res, 200, getMainnetContractsInfo());
      }

      if (url.pathname === '/api/bridge/simulate' && req.method === 'POST') {
        const body = await readBody(req);
        const amountCents = BigInt(Math.max(1, Math.min(999_00, Math.round(Number(body.amountPusd ?? 250) * 100))));
        const nonce = BigInt(Math.max(1, Number(body.nonce ?? 1)));
        const secretText = String(body.secretPhrase || 'bch-blaze-2026-atomic-htlc');
        const tamperAttack = Boolean(body.tamperAttack);

        const provider = new MockNetworkProvider();
        const vault = new Contract(
          pusdArtifact,
          [oracleMock.pubkey, guardianMock.pubkey, PUSD_CAT_BYTES, DID_CAT_BYTES, REFUND_LOCKTIME],
          { provider },
        );
        const vaultBalance = 1000_00n;
        const vaultUtxo = await seedUtxo(provider, vault.tokenAddress, {
          satoshis: 10000n,
          token: { category: PUSD_CAT_HEX, amount: vaultBalance },
        });

        const didBinding = createBchNostrDidBinding({
          bchPrivkey: DEMO_USER_PRIV,
          nostrPrivkey: DEMO_NOSTR_PRIV,
          networkPrefix: 'bchtest',
        });
        const userDidUtxo = await seedUtxo(provider, userMock.tokenAddress, {
          satoshis: 5000n,
          token: {
            category: DID_CAT_HEX,
            amount: 0n,
            nft: { capability: 'none', commitment: didBinding.nftCommitmentHex },
          },
        });

        const htlcSecret = sha256.hash(new TextEncoder().encode(secretText));
        const htlcHash = sha256.hash(htlcSecret);
        const payload = buildPusdAttestationPayload({
          htlcHash,
          recipientPkh: userMock.pkh,
          bridgeAmount: amountCents,
          transferNonce: nonce,
        });
        const oracleDataSig = signBchDataSig(DEMO_ORACLE_PRIV, payload);
        const claimedAmount = tamperAttack ? amountCents + 100_00n : amountCents;
        const remaining = vaultBalance - claimedAmount;

        try {
          const builder = new TransactionBuilder({ provider })
            .addInput(
              vaultUtxo,
              vault.unlock.settleBridgeTransfer(
                oracleDataSig,
                htlcSecret,
                htlcHash,
                userMock.pkh,
                claimedAmount,
                nonce,
              ),
            )
            .addInput(userDidUtxo, new SignatureTemplate(DEMO_USER_PRIV).unlockP2PKH())
            .addOutput({
              to: userMock.tokenAddress,
              amount: 1000n,
              token: { category: PUSD_CAT_HEX, amount: claimedAmount },
            });
          if (remaining > 0n) {
            builder.addOutput({
              to: vault.tokenAddress,
              amount: 8000n,
              token: { category: PUSD_CAT_HEX, amount: remaining },
            });
          }
          builder.addOutput({
            to: userMock.tokenAddress,
            amount: 4000n,
            token: userDidUtxo.token,
          });
          const tx = await builder.send();
          return sendJson(res, 200, {
            ok: true,
            vmResult: 'ACCEPTED_IN_BCH_VM',
            txid: tx.txid,
            htlcHashHex: binToHex(htlcHash),
            oracleDataSigHex: binToHex(oracleDataSig),
            didNpub: didBinding.npub,
            settledPusd: (Number(claimedAmount) / 100).toFixed(2),
            vaultRemainingPusd: (Number(remaining) / 100).toFixed(2),
            vaultAddress: vault.tokenAddress,
          });
        } catch (vmErr) {
          return sendJson(res, 200, {
            ok: false,
            vmResult: 'REJECTED_BY_COVENANT',
            tamperBlocked: tamperAttack,
            reason: vmErr.message,
            htlcHashHex: binToHex(htlcHash),
          });
        }
      }

      if (url.pathname === '/api/did/bind' && req.method === 'POST') {
        const body = await readBody(req);
        const useRandom = Boolean(body.freshKeys);
        const bchPriv = useRandom ? crypto.randomBytes(32) : DEMO_USER_PRIV;
        const nostrPriv = useRandom ? crypto.randomBytes(32) : DEMO_NOSTR_PRIV;

        const bindingMainnet = createBchNostrDidBinding({
          bchPrivkey: bchPriv,
          nostrPrivkey: nostrPriv,
          networkPrefix: 'bitcoincash',
        });
        const verification = verifyBchNostrDidBinding(bindingMainnet);

        // Also anchor on-chain inside real CashScript VM
        const bchMock = deriveBchIdentity(bchPriv, 'bchtest');
        const provider = new MockNetworkProvider();
        const binder = new Contract(didArtifact, [bchMock.pubkey, DID_CAT_BYTES], { provider });
        const batonUtxo = await seedUtxo(provider, binder.tokenAddress, {
          satoshis: 10000n,
          token: { category: DID_CAT_HEX, amount: 0n, nft: { capability: 'minting', commitment: '' } },
        });
        const tx = await new TransactionBuilder({ provider })
          .addInput(
            batonUtxo,
            binder.unlock.bindNostrIdentity(
              new SignatureTemplate(bchPriv),
              bindingMainnet.bchCrossBindingSig,
              bindingMainnet.nostrXOnlyPubkey,
              bindingMainnet.nip01EventHash,
            ),
          )
          .addOutput({
            to: bchMock.tokenAddress,
            amount: 2000n,
            token: {
              category: DID_CAT_HEX,
              amount: 0n,
              nft: { capability: 'none', commitment: bindingMainnet.nftCommitmentHex },
            },
          })
          .addOutput({
            to: binder.tokenAddress,
            amount: 7000n,
            token: batonUtxo.token,
          })
          .send();

        return sendJson(res, 200, {
          ok: true,
          didUri: bindingMainnet.didUri,
          npub: bindingMainnet.npub,
          bchAddress: bindingMainnet.bchAddress,
          bchTokenAddress: bindingMainnet.bchTokenAddress,
          bchPubkeyHex: bindingMainnet.bchPubkeyHex,
          nostrPubkeyHex: bindingMainnet.nostrPubkeyHex,
          nftCommitmentHex: bindingMainnet.nftCommitmentHex,
          bchCrossBindingSigHex: bindingMainnet.bchCrossBindingSigHex,
          nip01Event: bindingMainnet.nip01Event,
          verification,
          onChainAnchorTxid: tx.txid,
        });
      }

      if (url.pathname === '/api/merkle/claim' && req.method === 'POST') {
        const body = await readBody(req);
        const leafIdx = Math.max(0, Math.min(3, Number(body.claimantIndex ?? 0)));
        const entries = [
          { label: 'Folder #0 (User)', recipientPkh: userMock.pkh, address: userMock.tokenAddress, rewardAmount: 500_000n },
          { label: 'Folder #1 (Oracle)', recipientPkh: oracleMock.pkh, address: oracleMock.tokenAddress, rewardAmount: 300_000n },
          { label: 'Folder #2 (Guardian)', recipientPkh: guardianMock.pkh, address: guardianMock.tokenAddress, rewardAmount: 200_000n },
          { label: 'Folder #3 (Community)', recipientPkh: userMock.pkh, address: userMock.tokenAddress, rewardAmount: 100_000n },
        ];
        const tree = buildMerkleTree8(entries);
        const proof = getMerkleProof8(tree, leafIdx);
        const provider = new MockNetworkProvider();
        const rewardVault = new Contract(
          merkleArtifact,
          [tree.root, FLDCH_CAT_BYTES, guardianMock.pubkey, REFUND_LOCKTIME],
          { provider },
        );
        const poolTotal = 1_100_000n;
        const poolUtxo = await seedUtxo(provider, rewardVault.tokenAddress, {
          satoshis: 10000n,
          token: { category: FLDCH_CAT_HEX, amount: poolTotal },
        });
        const remaining = poolTotal - proof.entry.rewardAmount;
        const tx = await new TransactionBuilder({ provider })
          .addInput(
            poolUtxo,
            rewardVault.unlock.claimReward(
              proof.entry.recipientPkh,
              proof.entry.rewardAmount,
              proof.sibling0,
              proof.isRight0,
              proof.sibling1,
              proof.isRight1,
              proof.sibling2,
              proof.isRight2,
            ),
          )
          .addOutput({
            to: proof.entry.address,
            amount: 1000n,
            token: { category: FLDCH_CAT_HEX, amount: proof.entry.rewardAmount },
          })
          .addOutput({
            to: rewardVault.tokenAddress,
            amount: 8000n,
            token: { category: FLDCH_CAT_HEX, amount: remaining },
          })
          .send();

        return sendJson(res, 200, {
          ok: true,
          claimant: proof.entry.label,
          claimedFldch: proof.entry.rewardAmount.toString(),
          remainingPoolFldch: remaining.toString(),
          merkleRootHex: tree.rootHex,
          proofSiblings: [binToHex(proof.sibling0), binToHex(proof.sibling1), binToHex(proof.sibling2)],
          txid: tx.txid,
        });
      }

      if (url.pathname === '/api/mainnet/tx-preview' && req.method === 'POST') {
        const body = await readBody(req);
        const recipient = String(body.recipient || userMainnet.tokenAddress).trim();
        const satoshis = Math.max(546, Math.round(Number(body.satoshis ?? 1000)));
        const memo = String(body.memo || 'BCH BLAZE 2026 Mainnet PUSD Bridge Ping').slice(0, 120);

        const decoded = decodeCashAddress(recipient);
        if (typeof decoded === 'string') {
          return sendJson(res, 400, { ok: false, error: `Invalid BCH CashAddress: ${decoded}` });
        }

        const amountBch = (satoshis / 1e8).toFixed(8);
        const bip21Uri = `${recipient}?amount=${amountBch}&message=${encodeURIComponent(memo)}`;
        const opReturnHex = Buffer.from(memo, 'utf8').toString('hex');

        // Official CashConnect / WalletConnect v2 `bch_signTransaction` JSON-RPC request compatible with WizardConnect, Cashonize & Paytaca
        const wc2Request = {
          chainId: 'bch:bitcoincash',
          request: {
            method: 'bch_signTransaction',
            params: {
              transaction: {
                version: 2,
                locktime: 0,
                outputs: [
                  {
                    to: recipient,
                    satoshis,
                  },
                  {
                    opReturn: ['0x6d02', `0x${opReturnHex}`],
                    satoshis: 0,
                  },
                ],
              },
              sourceOutputs: [],
              broadcast: true,
              userPrompt: `BCH Blaze Hub Mainnet Tx: ${memo}`,
            },
          },
        };

        return sendJson(res, 200, {
          ok: true,
          network: 'bitcoincash (mainnet)',
          recipient,
          addressType: decoded.type,
          satoshis,
          amountBch,
          bip21Uri,
          opReturnHex,
          wc2Request,
          explorerUrl: `https://explorer.salemkode.com/address/${encodeURIComponent(recipient)}`,
        });
      }

      // Serve static files from web/ or root SLIDES.pdf / xo/
      let targetPath = path.join(WEB_DIR, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
      if (url.pathname === '/SLIDES.pdf') targetPath = path.join(__dirname, 'SLIDES.pdf');
      if (url.pathname === '/xo/pusd-bridge-template.xo.json') targetPath = XO_PATH;

      if (!targetPath.startsWith(__dirname) || !fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const ext = path.extname(targetPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(targetPath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = Number(process.env.PORT || 8097);
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`BCH Blaze Hub running at http://127.0.0.1:${PORT}`);
  });
}
