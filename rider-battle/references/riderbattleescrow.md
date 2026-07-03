# RiderBattleEscrow — contract reference

- Network: **Base** (chainId `8453`)
- Address: `0x55c2847003A9e254b8312bf3C75520e06528aBa6` (verified, Solidity 0.8.34)
- Stake token $RIDER: `0x544e6E53a9E5Ce11712647c893B3dD10c1d1CBa3`
- Settler (backend signer): `0xcfbF2aE4103334E21600d9C38fcB42e488371071`
- Treasury (fees): `0x673081c90db2d04187eBF740899110f15D690BF2`

## The match lifecycle

```
createMatch ──▶ Open ──joinMatch──▶ Funded ──settle──▶ Settled
                 │                     │
     cancelUnaccepted            refundStalled
     (after acceptWindow)        (after settleWindow)
                 ▼                     ▼
              Refunded              Refunded
```

`Status` enum: `0 = None`, `1 = Open`, `2 = Funded`, `3 = Settled`, `4 = Refunded`.

## Write functions

All are `nonpayable`. The caller must have approved RIDER to the escrow for at least `wager`
before `createMatch`/`joinMatch` (standard ERC-20 `approve(escrow, amount)`).

| Function | Signature | Notes |
| --- | --- | --- |
| createMatch | `createMatch(uint256 matchId, address token, uint256 wager)` | Caller chooses `matchId` (must be unused). Pulls `wager` of `token` from caller. Reverts `exists`, `token not allowed`, `wager=0`. |
| joinMatch | `joinMatch(uint256 matchId)` | Match must be `Open`. Pulls `wager` from caller. |
| settle | `settle(uint256 matchId, address winner, bytes sig)` | Match must be `Funded`. `sig` must be an EIP-191 personal-sign by the **settler** over `keccak256(abi.encode(block.chainid, address(escrow), matchId, winner))`. Pays `winner` the pot minus fee; fee → treasury. Anyone may submit the tx if `sig` is valid. |
| cancelUnaccepted | `cancelUnaccepted(uint256 matchId)` | Creator only, match `Open`, only after `createdAt + acceptWindow`. Refunds creator. |
| refundStalled | `refundStalled(uint256 matchId)` | Match `Funded`, only after `fundedAt + settleWindow`. Refunds creator and opponent. |

Owner/settler-only admin functions also exist (`setWindows`, `setTokenAllowed`, `setTokenFee`,
`setDefaultFee`, `setSettler`, `setTreasury`, `sweepUnaccounted`, `transferOwnership`,
`renounceOwnership`) — not used by this skill.

## Read (view) functions

| Function | Returns |
| --- | --- |
| `matches(uint256 matchId)` | `(address creator, address opponent, address token, uint256 wager, uint64 createdAt, uint64 fundedAt, uint8 status)` |
| `allowedToken(address token)` | `bool` |
| `feeBps(address token)` | `uint16` (0 → falls back to `defaultFeeBps`) |
| `defaultFeeBps()` | `uint16` (deployed default 500 = 5%) |
| `MAX_FEE_BPS()` | `uint16` (1000 = 10% cap) |
| `acceptWindow()` | `uint256` seconds (deployed default 86400 = 24h) |
| `settleWindow()` | `uint256` seconds (deployed default 43200 = 12h) |

To test whether a match id is free before creating: `matches(id).status == 0 (None)`.

## Events (for indexing open matches)

| Event | Signature |
| --- | --- |
| MatchCreated | `MatchCreated(uint256 indexed matchId, address indexed creator, address token, uint256 wager)` |
| MatchJoined | `MatchJoined(uint256 indexed matchId, address indexed opponent)` |
| MatchSettled | `MatchSettled(uint256 indexed matchId, address indexed winner, uint256 toWinner, uint256 fee)` |
| MatchRefunded | `MatchRefunded(uint256 indexed matchId)` |

**Finding open matches on-chain (fallback when no app endpoint exists):**
1. Fetch logs for `MatchCreated` from the escrow (topic0 = keccak of the signature above);
   `matchId` = topic1, `creator` = topic2, `token`+`wager` in data.
2. For each `matchId`, read `matches(matchId)` and keep only `status == 1 (Open)`.
   (A match leaves `Open` as soon as it is joined, cancelled, or refunded.)
3. Filter by `token == RIDER` and the requested wager predicate, sort by `createdAt` asc.

## Revert reason strings

| String | Meaning |
| --- | --- |
| `exists` | `matchId` already used → pick another |
| `token not allowed` | token not whitelisted via `allowedToken` |
| `wager=0` | wager must be > 0 |
| `deposit first` | escrow didn't receive the expected token amount (approve/allowance issue) |
| `not open` | action needs status `Open` |
| `not funded` | action needs status `Funded` |
| `not creator` | only the match creator may call this |
| `self` | cannot join / settle-to a match in a way that targets yourself where disallowed |
| `too early` | window (accept/settle) has not elapsed yet |
| `bad winner` | `winner` is not a participant of the match |
| `bad sig` | settle signature is not from the settler |

## Function selectors (for raw calldata via `bankr.tx.prepare`)

Calldata = selector + args, each arg left-padded to 32 bytes (uint256 as hex; address = 24 zero
bytes + 20-byte address). For `settle`, the `bytes sig` is a dynamic arg: head = `matchId(32)` +
`winner(32)` + `offset(32)=0x60`, then tail = `len(32)` + `sig` right-padded to a 32-byte multiple.

| Call | Selector |
| --- | --- |
| `createMatch(uint256,address,uint256)` | `0xdf1888ec` |
| `joinMatch(uint256)` | `0xfeb8c438` |
| `settle(uint256,address,bytes)` | `0x9abe08e6` |
| `cancelUnaccepted(uint256)` | `0x955c1247` |
| `refundStalled(uint256)` | `0xdd5d4496` |
| ERC-20 `approve(address,uint256)` | `0x095ea7b3` (spender = escrow) |
| ERC-20 `allowance(address,address)` | `0xdd62ed3e` (owner, escrow) |
| ERC-20 `balanceOf(address)` | `0x70a08231` |

Prefer `bankr.chain.readContract` with the ABI below for reads; use raw calldata only for the
`bankr.tx.prepare` writes.

## Minimal ABI (for encoding calls)

```json
[
  {"type":"function","name":"createMatch","stateMutability":"nonpayable","inputs":[{"name":"matchId","type":"uint256"},{"name":"token","type":"address"},{"name":"wager","type":"uint256"}],"outputs":[]},
  {"type":"function","name":"joinMatch","stateMutability":"nonpayable","inputs":[{"name":"matchId","type":"uint256"}],"outputs":[]},
  {"type":"function","name":"settle","stateMutability":"nonpayable","inputs":[{"name":"matchId","type":"uint256"},{"name":"winner","type":"address"},{"name":"sig","type":"bytes"}],"outputs":[]},
  {"type":"function","name":"cancelUnaccepted","stateMutability":"nonpayable","inputs":[{"name":"matchId","type":"uint256"}],"outputs":[]},
  {"type":"function","name":"refundStalled","stateMutability":"nonpayable","inputs":[{"name":"matchId","type":"uint256"}],"outputs":[]},
  {"type":"function","name":"matches","stateMutability":"view","inputs":[{"name":"","type":"uint256"}],"outputs":[{"name":"creator","type":"address"},{"name":"opponent","type":"address"},{"name":"token","type":"address"},{"name":"wager","type":"uint256"},{"name":"createdAt","type":"uint64"},{"name":"fundedAt","type":"uint64"},{"name":"status","type":"uint8"}]},
  {"type":"function","name":"allowedToken","stateMutability":"view","inputs":[{"name":"","type":"address"}],"outputs":[{"name":"","type":"bool"}]},
  {"type":"function","name":"acceptWindow","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint256"}]},
  {"type":"function","name":"settleWindow","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint256"}]},
  {"type":"function","name":"defaultFeeBps","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint16"}]},
  {"type":"function","name":"feeBps","stateMutability":"view","inputs":[{"name":"token","type":"address"}],"outputs":[{"name":"","type":"uint16"}]}
]
```
