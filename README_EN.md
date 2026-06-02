# SillyTavern Group Director

A director layer for SillyTavern group chats.

Group Director does more than deciding who speaks next.

It acts as a scene director that can:

* Decide which characters should respond
* Control speaking order
* Suppress unnecessary interruptions
* Generate character-specific stage directions
* Maintain multi-turn narrative continuity
* Inject World Info into decision making

All without modifying SillyTavern core code.

---

## Why?

Most group chats eventually suffer from one problem:

Everyone talks.

A single user message can trigger responses from every activated character, causing:

* Conversation spam
* Repetitive reactions
* Broken pacing
* Important characters getting buried

Group Director introduces a decision layer between activation and generation.

Instead of asking:

> "Who is activated?"

it asks:

> "Who actually has a reason to speak right now?"

---

# Features

## Formula Director

Local scoring-based speaker selection.

No API calls.
No extra token cost.

Characters are scored using:

* Mentions
* Context triggers
* Speaking recency
* Consecutive speaking penalties
* Talkativeness
* Initiative randomness

Only the highest-scoring characters are allowed to speak.

Perfect for large groups and long-running chats.

---

## LLM Director

Use an LLM as a scene director.

The Director receives:

* Recent conversation
* Character descriptions
* World information
* Previous plans (optional)

And decides:

* Who should speak
* In what order
* Why

Example:

```json
{
  "speakers": [
    "Knight",
    "Mage",
    "King"
  ],
  "reason": "The king should respond last after hearing advice."
}
```

---

## Ordered Generation

Group Director can enforce Director-selected speaking order.

Instead of relying on activation order:

```text
Knight
Mage
King
```

The Director can explicitly produce:

```text
Mage
Knight
King
```

and generation will follow that order.

---

## Director Script

The Director can provide private stage directions to each character.

Example:

```json
{
  "scripts": {
    "Alice": "Remain calm externally, but show subtle hesitation.",
    "Bob": "Attempt to hide your frustration."
  }
}
```

Each character receives only their own script.

Characters never see:

* Other scripts
* Director reasoning
* Full planning data

This allows the Director to shape performance without breaking immersion.

---

## Script Continuity

The Director can remember and continue previous plans.

Instead of treating every generation round independently, the Director can maintain scene-level continuity across multiple turns.

Useful for:

* Story arcs
* Investigations
* Romance scenes
* Political intrigue
* Long-running campaigns

---

## World Info Integration

Group Director can automatically include activated Lorebook / World Info entries when making decisions.

The Director gains awareness of:

* Setting lore
* Faction information
* Character relationships
* Current world state

before deciding who should speak.

---

# Modes

## Off

No intervention.

SillyTavern behaves normally.

---

## Formula

Local scoring system.

* Fast
* Deterministic
* Zero token cost

Recommended for most users.

---

## LLM

Director-driven scene management.

* Context-aware
* Order-aware
* Narrative-focused

Recommended for roleplay-heavy groups.

---

# Architecture

Group Director uses SillyTavern's official Extension API.

No core modifications.

Key integrations:

* Generate Interceptor
* Group Wrapper Events
* generateRaw()
* Extension Prompt Injection
* World Info APIs

The extension remains fully compatible with future SillyTavern updates.

---

# Installation

Extension Manager:

```text
https://github.com/Windy-Sora/SillyTavern-GroupDirector
```

Or clone manually:

```bash
git clone https://github.com/Windy-Sora/SillyTavern-GroupDirector.git
```

into:

```text
SillyTavern/public/scripts/extensions/third-party/
```

---

# Philosophy

Group Director is not a speaker filter.

It is a narrative control layer.

The goal is not to make fewer characters speak.

The goal is to make the right characters speak, at the right time, for the right reason.
