# SillyTavern Group Director

An AI Narrative Director for SillyTavern Group Roleplay.

Group Director does more than decide who speaks next.

It acts as a narrative layer above group chat generation, helping coordinate characters, maintain story continuity, direct performances, and manage long-running roleplay campaigns.

No core modifications required. Built entirely on SillyTavern's Extension API.

---

# What is Group Director?

Traditional group chat systems answer one question:

> Which characters are active?

Group Director answers a different question:

> Which characters should respond right now, in what order, and for what narrative purpose?

Before any character generates a reply, the Director evaluates the scene and decides:

* Who should speak
* Who should stay silent
* Speaking order
* Scene pacing
* Character guidance
* Narrative continuity

The result is a cleaner, more focused and more story-driven group roleplay experience.

---

# Core Features

## Formula Director

A lightweight local scoring system.

No API calls.
No additional token cost.

The Director evaluates:

* Character mentions
* Trigger keywords
* Recent activity
* Consecutive speaking penalties
* Talkativeness
* Initiative rolls

Then selects the most relevant speakers.

Best for:

* Large group chats
* Long-running sessions
* Low-cost setups

---

## LLM Director

Uses a language model as a narrative director.

The Director evaluates:

* Recent conversation context
* Character descriptions
* World Info / Lorebooks
* Previous Director plans
* Story state

And decides:

* Who should speak
* Speaking order
* How the scene should progress

Example:

{
"speakers": [
"Knight",
"Mage",
"King"
],
"reason": "The King should make the final decision after hearing both perspectives."
}

---

## Director Scripts

The Director can provide hidden stage directions for each selected character.

Example:

{
"scripts": {
"Alice": "Remain calm on the surface, but gradually reveal anxiety.",
"Bob": "Suppress your anger and avoid direct confrontation."
}
}

Each character only receives their own instructions.

Characters never see:

* Other scripts
* Director plans
* Internal reasoning

This enables:

* Emotional control
* Scene direction
* Dramatic pacing
* Coordinated multi-character performances

---

## Director Ledger

Director decisions can be permanently stored inside chat metadata.

Unlike ordinary speaker selection systems, the Director can maintain persistent narrative state across sessions.

Example:

{
"speakers": ["Alice"],
"story_state": {
"chapter": 3
},
"relationship_state": {
"Alice-Bob": 75
}
}

Custom fields are preserved automatically.

This allows users to build:

* Story progression systems
* Relationship tracking
* Quest states
* Campaign metadata
* Custom narrative memory

without modifying the extension itself.

---

## Story Continuity

The Director can reference previous plans when making future decisions.

Instead of treating every round independently, the Director can maintain:

* Story arcs
* Character relationships
* Emotional development
* Long-term goals
* Narrative consistency

Ideal for long-running roleplay campaigns.

---

## World Info Integration

The Director can perform a World Info scan before making decisions.

Activated lore entries become part of the Director's reasoning context.

This allows the Director to understand:

* Setting information
* Political factions
* Historical events
* Locations
* Current environmental conditions

before assigning speakers.

---

## Ordered Generation

Group Director can fully control generation order.

Instead of:

Knight
Mage
King

The Director may decide:

Mage
Knight
King

and enforce that order during generation.

This allows scenes to unfold naturally according to narrative logic rather than activation order.

---

# Modes

## Off

No intervention.

SillyTavern behaves normally.

## Formula Director

Fast.
Stable.
Token-free.

Recommended for most users.

## LLM Director

Narrative-aware decision making.

Recommended for story-focused roleplay.

---

# Example Workflow

User Message
↓
Director Evaluation
↓
World Info Scan
↓
Story Ledger Lookup
↓
Speaker Selection
↓
Director Scripts
↓
Character Generation

---

# Ideal Use Cases

Group Director is especially effective for:

* Tavern scenes
* School settings
* Adventure parties
* Political intrigue
* Family roleplay
* Long-form campaigns
* Ensemble casts
* Multi-character storytelling

The more characters involved, the more noticeable the benefits become.

---

# Installation

Extension Manager:

https://github.com/Windy-Sora/SillyTavern-GroupDirector

Manual Installation:

git clone https://github.com/Windy-Sora/SillyTavern-GroupDirector.git

Place inside:

SillyTavern/public/scripts/extensions/third-party/

Restart SillyTavern.

---

# Philosophy

Group Director is not a speaker filter.

It is a narrative director.

The goal is not to make fewer characters speak.

The goal is to make the right characters speak,
at the right moment,
for the right reason.
