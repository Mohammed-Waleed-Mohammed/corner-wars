# 12 — Balancing

Every number in these files is a **dial**, not a law. Real balance comes from playtesting; these are anchors for adjusting safely.

## Anchors

- **Cost vs power:** a unit's rough value ≈ `HP × DPS`. Keep `value / cost` in a similar band across units. Range and speed are worth extra, so ranged/fast units can sit a bit "below curve" on this metric and still be fair.
- **Economy baseline:** 1 Worker ≈ 2.5 gold/s; that one figure anchors all costs and timings. If you rescale the economy, rescale costs with it.

## Common adjustments

| Symptom | First fix | Then |
|---|---|---|
| A unit is too strong | Raise its **cost** or **build time** (least disruptive) | Trim HP or DPS |
| Games end too fast | Raise base HP or unit cost; lower starting gold | — |
| Games drag too long | Lower base HP or cost; raise starting gold | — |
| One unit dominates the meta | Confirm the **+50% counter** is actually applied and the counter unit can reach/kite | Adjust the loser's speed/range |
| Citadel feels too snowbally | Lower its passive bonuses or energy rate; raise power costs | Shorten the 120 s win timer's reset conditions |
| Citadel feels irrelevant | Raise its bonuses/energy rate; lower power costs | — |

## Method

- Change **one dial at a time**, then playtest. Changing several at once makes it impossible to know what helped.
- Keep the design files and the code's `config/constants` in sync — update the file first, then the constant.
- The Citadel should feel **decisive but never uncontestable**: a player who holds it should be winning, but everyone else should always have a realistic path to break the hold.
