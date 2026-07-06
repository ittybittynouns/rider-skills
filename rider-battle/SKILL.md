---
name: rider-battle
description: Create and accept $RIDER wager battles in the Bankr CryptoRider game on Base, claim winnings or refunds, see open challenges, and view monthly & all-time leaderboards — all from a tweet. Use when a user wants to create a challenge with a wager, accept an open challenge (optionally the first one, or filtered by max/min wager), claim a won battle, or reclaim/refund a stake.
tags: [gaming, wager, base, rider, escrow, pvp]
version: 5
visibility: private
metadata:
  clawdbot:
    emoji: "🏍️"
    homepage: "https://basescan.org/address/0x55c2847003A9e254b8312bf3C75520e06528aBa6"
---

# Rider Battle (Bankr CryptoRider PvP)

Run **CryptoRider** $RIDER wager battles by talking to Bankr (e.g. in a tweet).
Two backends are used together:

- **Supabase** (lobby/DB) — source of truth for match ids, open challenges, and the
  signed result used to claim. On-chain `matchId` **==** the Supabase row `id`.
  See `references/supabase.md`.
- **RiderBattleEscrow** (money) — on Base, holds stakes and pays out.
  See `references/riderbattleescrow.md`.

On-chain calls run through Bankr's script runner: reads via `bankr.chain.readContract`
(`scripts/readMatch.ts`), writes via `bankr.tx.prepare` (`scripts/prepareTx.ts`).

> 🚨 **CRITICAL — how funding works. Read before writing any create/accept.**
> This escrow is **transfer-based (V2)**: it does **NOT** use `approve` + `transferFrom`.
> The stake must be **transferred into the escrow first**, then the match call credits it.
> So funding a match is always **two transactions, in this exact order, from the user's
> wallet**:
> 1. `RIDER.transfer(escrow, wagerWei)` — move the stake INTO the escrow
> 2. wait until (1) is mined, THEN `createMatch(...)` / `joinMatch(...)`
>
> **Never call `createMatch` or `joinMatch` without a matching `transfer` of the exact
> wager immediately before it, in the same sequence.** The contract's on-chain guard
> (`_received >= wager`) reads the escrow's *shared* balance; if you skip the transfer it
> can still pass by consuming other users' funds, creating a "ghost" match funded by the
> pool while the creator keeps their tokens. There is **no `approve` step** — an approve
> here does nothing.

## Constants

| Name | Value |
| --- | --- |
| Chain | Base (chainId `8453`) |
| Escrow | `0x55c2847003A9e254b8312bf3C75520e06528aBa6` |
| $RIDER token | `0x544e6E53a9E5Ce11712647c893B3dD10c1d1CBa3` |
| RIDER decimals | `18` |
| Supabase URL | `https://kdqmnkuckhuaxqxkrevr.supabase.co` |
| Supabase key (publishable) | `sb_publishable_CZOntElcy0XxpJt0Ta1Mvg_PIKs8yTS` |
| Matches table | `matches` |
| Platform fee | 5% (winner nets 95% of the 2× pot) |
| Accept window | 24h · Play/settle window | 12h |

**Wager units.** DB `wager` is in **whole RIDER tokens** (`1M` → `1000000`); on-chain
`wagerWei = wager * 10^18`. Shorthand `k`=1e3, `M`=1e6, `B`=1e9. Supabase headers on every
call: `apikey: <key>` and `Authorization: Bearer <key>`.

> 🚨 **Wager token vs. track.** The stake is **ALWAYS `$RIDER`**. The `coin` column
> (e.g. `BNKR`, `BTC`, `SOL`) is only the **price chart / track** ridden in the game — never
> the wager token. Report `wager: {wager} $RIDER` and, separately, `track: {coin}`. Never
> print `{wager} ${coin}`.

## Safety

- Read `balanceOf(user, RIDER)` first; never try to stake more than the balance. If short, stop and say so.
- Above **5,000,000 RIDER**, restate the wager + match and require explicit confirmation before submitting anything.
- Only ever stake `$RIDER`. Refuse other tokens.
- Fund strictly with the **transfer→create/join** sequence above. If a `createMatch`/`joinMatch`
  ever succeeds without you having transferred the wager in the same sequence, stop and flag it —
  that's the ghost-match bug, not a success.
- Never fabricate a `settle_sig`. If it isn't on the row yet, the match isn't claimable.

## Actions

### Leaderboards — "monthly Rider leaderboard" / "all-time hall of fame" / "top 5 this month"
Read-only. Full dedupe/period logic + tagging rules in `references/leaderboard.md`.
1. `GET leaderboard?select=*&order=score.desc&limit=500`.
2. Period: **monthly** → keep rows with `ts` (unix ms; fall back `created_at`) ≥ start of the
   current month; **all-time** → keep all.
3. **Dedupe by `handle`** keeping each player's best `score`, sort desc, take top N (default 5, max 10).
4. Output `1. @{handle} — {score} pts (track {coin})`, 🥇🥈🥉 for top three; for monthly note the
   top 3 win the $RIDER prize pool.
5. **Tag only real X handles**: `@`-mention a row only if its `avatar` contains
   `unavatar.io/twitter/` or `twimg.com`; otherwise show plain text (Farcaster/wallet handle).
   Strip a leading `@`; never `@@`; only tag the players you list.

### See open challenges — "show open Rider battles" / "any challenges under X $RIDER?"
Read-only.
1. `GET matches?select=*&status=eq.open&order=created_at.desc&limit=100`.
2. Drop rows where `creator` == user's wallet; apply any wager filter.
3. List each: matchId, `wager: {wager} $RIDER`, `track: {coin}`, creator handle (or short wallet),
   time to expiry (`expires_at`). Never label the wager with `coin`. If none, say so.

### Create a challenge — "create a challenge with 1M $RIDER on the BNKR chart"
1. Parse wager → whole tokens `W`; `wagerWei = W * 10^18`. Check `balanceOf(user,RIDER) ≥ wagerWei`.
2. `INSERT` a `matches` row (POST, `Prefer: return=representation`):
   `creator`=user wallet, `creator_handle`=@handle|null, `wager`=`W` (RIDER, always),
   `coin`=the **track** the user names (`BNKR`/`BTC`/…; default `RIDER`), `status`='open',
   `seed`=`'S'+Date.now().toString(36)+random-base36`, `created_at`=now, `expires_at`=now+24h.
   Read back `row.id` → this is the **matchId**.
3. Optional guard: `matches(id).status` on-chain should be `0` (None). If not `0`, pick/insert a new id.
4. **FUND, then CREATE (two txs, in order, from the user's wallet):**
   a. `RIDER.transfer(escrow, wagerWei)` via `bankr.tx.prepare`.
   b. **Wait until (a) is mined** (get its tx hash / confirmation).
   c. `createMatch(row.id, RIDER, wagerWei)` via `bankr.tx.prepare`.
   Do NOT approve. Do NOT call `createMatch` before/without (a).
5. Confirm `matches(row.id).status == 1` (Open) on-chain. If the transfer landed but
   `createMatch` didn't (e.g. it reverted because the shared balance was briefly consumed),
   the deposit is **safe in the escrow**: retry `createMatch(row.id, RIDER, wagerWei)` — do NOT
   transfer again — or, if the user gives up, use the refund path to reclaim. Tell the user their
   deposit is safe and reclaimable.
6. On success reply with the matchId (needed to join), `wager $RIDER`, `track`, and the tx link.
   If it never confirms, leave the row `open` and tell the user how to complete/reclaim.

### Accept an open challenge — "accept the first open Rider battle under 500k $RIDER"
1. Get open matches (`GET matches?...status=eq.open`) or the specific `id`; require
   `status==open` and `creator != user`. Apply any wager predicate; pick the oldest passing.
2. `wagerWei = row.wager * 10^18`. Check `balanceOf(user,RIDER) ≥ wagerWei`.
3. **FUND, then JOIN (two txs, in order):**
   a. `RIDER.transfer(escrow, wagerWei)`; b. wait until mined; c. `joinMatch(row.id)`.
   No approve. Never `joinMatch` without the matching transfer first.
4. Confirm `matches(row.id).status == 2` (Funded). If transfer landed but join didn't, the deposit
   is safe in escrow: retry `joinMatch` (don't re-transfer) or reclaim via refund.
5. On success PATCH the row (`id=eq.<id>&status=eq.open`): `opponent`=user wallet,
   `opponent_handle`, `status`='funded', `accepted_at`=now, `play_deadline`=now+12h. (Empty
   response = someone joined first → treat as taken.)
6. Tell the user it's funded and that **both players now play the battle in the app**.

### Claim winnings — "claim match <id>"
Payout is in `settle(matchId, winner, sig)`; `sig` comes only from the game backend (written to
the row after both play). This does not deposit anything, so there's no transfer step.
1. `GET matches?id=eq.<id>&limit=1`; require `winner == user`. If `settle_sig` missing → not signed
   yet, tell the user to retry later. If `settle_tx` is a real hash (not `0xbankr`/`0xfarcaster`/
   `0xclaimed`) → already claimed.
2. Check on-chain `matches(id).status`: `2 (Funded)` → proceed; `3 (Settled)` → already claimed;
   `4 (Refunded)`/`0`/`1` → nothing to claim.
3. `settle(id, winner, settle_sig)`. On success PATCH `settle_tx`=hash, `status`='settled'.

### Refund / reclaim — "refund match <id>" / "cancel my match"
No transfer step (money leaves the escrow). Read the row + `matches(id)` + `acceptWindow`/`settleWindow`:
- `status Open(1)`, caller is creator, `now ≥ createdAt + acceptWindow` → `cancelUnaccepted(id)`;
  PATCH `status`='refunded'.
- `status Funded(2)`, `now ≥ fundedAt + settleWindow` → `refundStalled(id)` (both reclaim);
  PATCH `status`='refunded'.
- Also use this to reclaim a deposit from a create/join that transferred but never finished
  (funds are in escrow under that match id).
- Otherwise explain why it isn't refundable yet and when it will be.

## Match status enum
`0 None · 1 Open · 2 Funded · 3 Settled · 4 Refunded`.

## After any transaction
Return `https://basescan.org/tx/<hash>` + a one-line summary (action, matchId, `wager $RIDER`, track).
On revert, surface the contract error and meaning — see `references/riderbattleescrow.md`.
