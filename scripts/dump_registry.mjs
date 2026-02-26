import fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.SJ_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.SJ_PROGRAM_ID ?? "89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd"
);
const REGISTRY_PDA = new PublicKey(
  process.env.SJ_REGISTRY_PDA ?? "FbpRxcpnxfHh5YgeDQuKvxuAE2yA4Pxziv4djmMFtaeS"
);
const IDL_PATH = process.env.SJ_IDL_PATH ?? "../target/idl/sj_registry_program.json";

function pickRegistryAccountName(idl) {
  const names = (idl.accounts ?? []).map((a) => a.name);
  const hit = names.find((n) => /registry/i.test(n));
  if (!hit) throw new Error(`IDL accounts: ${names.join(", ")} (aucun ne contient 'registry')`);
  return hit; // ex: "registryAccount"
}

function pickHead(entries) {
  if (!entries?.length) return null;
  const sample = entries[0] ?? {};
  const publishedKey = Object.keys(sample).find((k) => /published/i.test(k));
  if (publishedKey) {
    return [...entries].sort((a, b) => Number(a[publishedKey] ?? 0) - Number(b[publishedKey] ?? 0)).at(-1);
  }
  return entries[entries.length - 1];
}

function pickCid(entry) {
  if (!entry) return null;
  const k = Object.keys(entry).find((x) => /cid/i.test(x));
  return k ? entry[k] : null;
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const accountName = pickRegistryAccountName(idl);

  const connection = new Connection(RPC, "confirmed");
  const info = await connection.getAccountInfo(REGISTRY_PDA, "confirmed");
  if (!info) throw new Error("Registry account not found at PDA");

  if (!info.owner.equals(PROGRAM_ID)) {
    throw new Error(`Owner mismatch. account.owner=${info.owner.toBase58()} expected=${PROGRAM_ID.toBase58()}`);
  }

  const coder = new anchor.BorshAccountsCoder(idl);
  const decoded = coder.decode(accountName, info.data);

  const entries = decoded.entries ?? [];
  const head = pickHead(entries);
  const headCid = pickCid(head);

  const updatedAt = decoded.updatedAt ?? decoded.updated_at ?? null;
  const vaultId = decoded.vaultId ?? decoded.vault_id ?? null;

  console.log(
    JSON.stringify(
      {
        rpc: RPC,
        programId: PROGRAM_ID.toBase58(),
        registryPda: REGISTRY_PDA.toBase58(),
        accountName,
        vaultId,
        updatedAt: updatedAt?.toString?.() ?? updatedAt,
        entriesLength: entries.length,
        headCid,
        head,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
