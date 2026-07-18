# Story Blueprint

Story Blueprint is a lightweight story-structure layer for Group Director.

It does not decide narrative policy in code. The framework only stores a dynamic outline, exposes the current step through providers, and advances by one step when the Director sets one boolean variable.

## Core Protocol

```text
completion variable: gd_story_chapter_done
true once = advance one progression step
doneSignals.length = completed step count
current step = flatten(nodes)[doneSignals.length]
doneSignals.length >= steps.length = blueprint complete
```

The Director should set:

```json
{
  "variable_update": {
    "global": {
      "gd_story_chapter_done": true
    }
  }
}
```

Only set it when the current Story Blueprint step is complete.

## Blueprint Shape

```json
{
  "version": 1,
  "title": "Story title",
  "meta": {
    "premise": "Short premise",
    "style": "Genre, tone, pacing"
  },
  "nodes": [
    {
      "id": "node_001",
      "type": "chapter",
      "title": "Chapter title",
      "content": {
        "purpose": "Why this block exists",
        "director_prompt": "How the Director should guide this block",
        "completion_rule": "When this block counts as complete"
      },
      "children": []
    }
  ]
}
```

`nodes` is a dynamic tree. Users can write one layer, chapters and sections, or deeper structures. The framework only requires `nodes` and optional `children`; `content` is free-form and belongs to prompt authors.

## Progression Modes

```text
leaf  - advance only leaf nodes
all   - advance every node in depth-first order
level - advance nodes at a chosen depth
```

Default mode is `leaf`.

## Providers

```text
{{storyBlueprintCurrent}}
{{storyBlueprintCurrentJson}}
{{storyBlueprintProgress}}
{{storyBlueprintSchemaHint}}
{{storyBlueprintFullJson}}
```

The default Director prompt includes `{{storyBlueprintCurrent}}`. When Story Blueprint is disabled, providers return nothing and no progression is consumed.

## Prompt Rendering

Story Blueprint generation and continuation prompts are rendered through the normal Group Director provider pipeline before calling the LLM. Prompt authors can use any provider in those prompt boxes, such as summaries, variables, character profiles, ledger data, or custom providers.

## State

Blueprint content and progress are stored per chat:

```text
chat_metadata[group-director].storyBlueprint
```

Global settings store only configuration such as enable state, progression mode, provider template, prompt text, and completion variable name.
