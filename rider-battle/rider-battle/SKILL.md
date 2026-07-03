---
name: rider-battle
description: Create and accept $RIDER wager battles in the Bankr CryptoRider game on Base, claim winnings or refunds, see open challenges, and view monthly & all-time leaderboards — all from a tweet. Use when a user wants to create a challenge with a wager, accept an open challenge (optionally the first one, or filtered by max/min wager), claim a won battle, or reclaim/refund a stake.
tags: [gaming, wager, base, rider, escrow, pvp]
version: 3
visibility: private
metadata:
  clawdbot:
    emoji: "🏍️"
    homepage: "https://basescan.org/address/0x55c2847003A9e254b8312bf3C75520e06528aBa6"
---

# Rider Battle (Bankr CryptoRider PvP)

Run **CryptoRider** $RIDER wager battles by talking to Bankr (e.g. in a tweet).
There are two backends and BOTH are used together:

- **Supabase** (the lobby/database) — the source of truth for match ids, open
  challenges, and the signed result used to claim. Match id on-chain **==** the
  Supabase row id. See `references/supabase.md`.
- **RiderBattleEscrow** (the money) — on Base, holds the stakes and pays out.
  See `references/riderbattleescrow.md`.

On-chain calls use Bankr's built-in script-runner primitives (available at runtime
regardless of what's pulled in on install):
- reads → `bankr.chain.readContract` (ABI in `references/riderbattleescrow.md`;
  `scripts/readMatch.ts` is a worked example)
- writes → `bankr.tx.prepare` builds a transaction button the user approves in the
  Bankr chat (`scripts/prepareTx.ts` is a worked example). Encode calldata from the
  ABI/selectors in the references file.

> ⚠️ **Gameplay happens in the app, not in the tweet.** A tweet can *create*,
> *accept* (fund), *claim*, or *refund*. The actual battle rounds that decide the
> winner are played in the CryptoRider app by both players; only then does the
> `settle-battle` edge function write `winner` + `settle_sig` to the row, making
> the match claimable. Never imply a winner before that signature exists.

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
| Accept window | 24h (creator can reclaim if nobody joins) |
| Play window | 12h (draw / no-play → both reclaim) |

**Wager units.** The DB `wager` column is in **whole RIDER tokens** (`1M` → `1000000`).
On-chain amounts are `wager * 10^18`. Shorthand: `k`=1e3, `M`=1e6, `B`=1e9.
Supabase REST headers on every call: `apikey: <key>` and `Authorization: Bearer <key>`.

> 🚨 **Wager token vs. track — do not confuse them.** The stake is **ALWAYS `$RIDER`**
> (the escrow only ever holds RIDER). The `coin` column on a match (e.g. `BNKR`, `BTC`,
> `SOL`) is only the **price chart / track** the two players ride — it is **never** the
> wager token. When reporting a match, always say `wager: {wager} $RIDER` and, separately,
> `track: {coin}`. Never print `{wager} ${coin}`.

## Safety

- Never stake more than the user's RIDER balance (read `balanceOf` first).
- Above **5,000,000 RIDER**, restate the wager + match and require explicit confirmation before submitting.
- Only stake `$RIDER`. Refuse other tokens.
- Before any `createMatch`/`joinMatch`, ensure the RIDER allowance to the escrow ≥ wager; if not, prepare an ERC-20 `approve` tx first, then the main tx.
- Never fabricate a `settle_sig`. If it isn't on the row yet, the match isn't claimable.

## Actions

### Leaderboards — "monthly Rider leaderboard" / "all-time hall of fame" / "top 5 this month"
Read-only. Details + exact dedupe logic in `references/leaderboard.md`.
1. `GET leaderboard?select=*&order=score.desc&limit=500` (Supabase headers).
2. Pick the period:
   - **Monthly** (default when the user says "monthly"/"this month"): keep only rows whose
     `ts` (unix ms; fall back to `created_at`) is ≥ the start of the current calendar month.
   - **All-time / Hall of Fame**: keep everything.
3. **Dedupe by `handle`**, keeping each player's single best `score`. Then sort by `score` desc.
4. Take the top N the user asked for (default 5, max 10). Reply as a ranked list:
   `1. @{handle} — {score} pts (track {coin})`, using 🥇🥈🥉 for the top three.
   For the monthly board, note the top 3 win that month's live $RIDER prize pool.
5. **Tagging:** `handle` is the player's X/Farcaster @handle, so tag them directly
   (`@{handle}`). If a row has no handle, show `anon` and don't tag. Don't invent handles.
   Keep it to the number requested so you don't mass-tag people unprompted.

### See open challenges — "show open Rider battles" / "any challenges under X $RIDER?"
Read-only, no transaction.
1. `GET matches?select=*&status=eq.open&order=created_at.desc&limit=100` (Supabase headers).
2. Drop rows where `creator` == the user's wallet; apply any wager filter the user gave.
3. Reply with a short list: for each, the matchId, `wager: {wager} $RIDER` (always RIDER),
   `track: {coin}` (the chart to ride), creator handle (or shortened wallet), and how long
   until it expires (`expires_at`). Never label the wager with the `coin` symbol. If empty,
   say there are no open challenges right now. Optionally offer to accept one.

### Create a challenge — "create a challenge with 1M $RIDER" / "X $RIDER"
1. Parse wager → whole tokens `W` (and `wagerWei = W * 10^18`).
2. `INSERT` a row into `matches` (POST, `Prefer: return=representation`) with:
   `creator` = user's wallet, `creator_handle` = tweeter's @handle (or null),
   `wager` = `W` (whole RIDER — the stake is always RIDER),
   `coin` = the **track** to ride, i.e. the chart symbol the user names (`BNKR`, `BTC`,
   `SOL`, …); default `'RIDER'` if unspecified. `coin` is not the stake token.
   `seed` = `'S' + Date.now().toString(36) + random-base36`,
   `status` = `'open'`, `created_at` = now ISO,
   `expires_at` = now + 24h ISO. Read back `row.id` → this is the **matchId**.
3. Ensure allowance ≥ `wagerWei` (approve if needed).
4. On-chain `createMatch(row.id, RIDER, wagerWei)` via `bankr.tx.prepare`.
5. Reply with the matchId (needed to join), the wager, and the tx link.
   If the on-chain create fails, PATCH the row `status='refunded'` so it never shows.

### Accept an open challenge
Handles: "accept the first available challenge", "accept a challenge with wager max X",
"accept a challenge with wager under X".
1. `GET matches?select=*&status=eq.open&order=created_at.desc&limit=100`.
2. Filter: drop rows where `creator` == user's wallet; apply the wager predicate on
   the `wager` column (`<= X`, `< X`, or none for "first available").
3. Take the **oldest** match that passes (list is desc, so pick the last match that
   passes, i.e. earliest `created_at`). If none passes, say so and stop — never join a different one.
4. `wagerWei = row.wager * 10^18`. Ensure allowance ≥ wagerWei (approve if needed).
5. On-chain `joinMatch(row.id)`.
6. On success, PATCH the row (`id=eq.<id>&status=eq.open`) with:
   `opponent` = user wallet, `opponent_handle`, `status='funded'`,
   `accepted_at` = now, `play_deadline` = now + 12h. (Empty response = someone else took it first.)
7. Tell the user it's funded and that **both players now play the battle in the app**.

### Claim winnings — "claim match <id>" / "claim my win"
1. `GET matches?id=eq.<id>&limit=1`. Require `winner` == user's wallet.
2. If `settle_sig` is missing → the battle isn't signed yet; tell the user to try again shortly. Stop.
3. If `settle_tx` is a real tx hash (not `0xbankr`/`0xfarcaster`/`0xclaimed`) → already claimed. Stop.
4. Read on-chain `matches(id).status` first:
   `2 (Funded)` → proceed; `3 (Settled)` → already claimed; `4 (Refunded)` → nothing to claim;
   `1 (Open)`/`0` → opponent never funded / not on-chain, not claimable.
5. On-chain `settle(id, winner, settle_sig)` (winner gets 95% of the 2× pot).
6. On success, PATCH `settle_tx` = the tx hash, `status='settled'`.

### Refund / reclaim — "refund match <id>" / "cancel my match"
Read the row + on-chain `matches(id)` + `acceptWindow`/`settleWindow`, then:
- `status Open(1)`, caller is creator, `now ≥ createdAt + acceptWindow` →
  `cancelUnaccepted(id)`; PATCH row `status='refunded'`.
- `status Funded(2)`, `now ≥ fundedAt + settleWindow` (draw / nobody played) →
  `refundStalled(id)` (both reclaim); PATCH row `status='refunded'`.
- Otherwise explain why it isn't refundable yet and when it will be.

## After every tx
Return `https://basescan.org/tx/<hash>` + a one-line summary (action, matchId, wager).
On revert, surface the contract error string and its meaning — see the references file
(`exists`, `token not allowed`, `not open`, `not funded`, `not creator`, `too early`, `bad sig`, …).
