// Worked example — the ONLY correct way to fund a Rider Battle match.
// Escrow is transfer-based: transfer the stake in FIRST, then createMatch/joinMatch.
// No approve. Uses bankr.tx.prepare (writes) + bankr.chain.readContract (reads).

const ESCROW = "0x55c2847003A9e254b8312bf3C75520e06528aBa6";
const RIDER  = "0x544e6E53a9E5Ce11712647c893B3dD10c1d1CBa3";

// selectors
const SEL_TRANSFER = "a9059cbb"; // transfer(address,uint256)
const SEL_CREATE   = "df1888ec"; // createMatch(uint256,address,uint256)
const SEL_JOIN     = "feb8c438"; // joinMatch(uint256)

const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const addr = (a) => pad(a.toLowerCase());
const uint = (n) => pad(BigInt(n).toString(16));

// wagerWei = whole RIDER tokens * 10^18
function toWei(wholeTokens) { return (BigInt(wholeTokens) * (10n ** 18n)).toString(); }

async function readStatus(matchId) {
  const abi = [{ type:"function", name:"matches", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}],
    outputs:[{name:"creator",type:"address"},{name:"opponent",type:"address"},{name:"token",type:"address"},
             {name:"wager",type:"uint256"},{name:"createdAt",type:"uint64"},{name:"fundedAt",type:"uint64"},
             {name:"status",type:"uint8"}] }];
  const r = await bankr.chain.readContract({ chain:"base", address:ESCROW, abi, functionName:"matches", args:[String(matchId)] });
  return Number((r && (r.status ?? r[6])) || 0);
}

// FUND + CREATE  (matchId must equal the Supabase row id)
async function createBattle(matchId, wagerWholeTokens) {
  const wei = toWei(wagerWholeTokens);
  // 1) transfer stake INTO the escrow
  const transferData = "0x" + SEL_TRANSFER + addr(ESCROW) + uint(wei);
  await bankr.tx.prepare({ chain:"base", to:RIDER, data:transferData, label:"Rider deposit" });
  // 2) after it mines, createMatch credits it
  const createData = "0x" + SEL_CREATE + uint(matchId) + addr(RIDER) + uint(wei);
  await bankr.tx.prepare({ chain:"base", to:ESCROW, data:createData, label:"Create Rider battle" });
  // 3) confirm Open(1); if not, the deposit is safe — retry createMatch (do NOT transfer again)
  return await readStatus(matchId); // expect 1
}

// FUND + JOIN
async function acceptBattle(matchId, wagerWholeTokens) {
  const wei = toWei(wagerWholeTokens);
  const transferData = "0x" + SEL_TRANSFER + addr(ESCROW) + uint(wei);
  await bankr.tx.prepare({ chain:"base", to:RIDER, data:transferData, label:"Rider deposit" });
  const joinData = "0x" + SEL_JOIN + uint(matchId);
  await bankr.tx.prepare({ chain:"base", to:ESCROW, data:joinData, label:"Accept Rider battle" });
  return await readStatus(matchId); // expect 2 (Funded)
}
