# How to Create Cards

Spec for producing import-ready flashcard JSON.

## JSON schema

The Manage → Import dialog accepts:

```json
{
  "cards": [
    { "front": "...", "back": "...", "tags": ["..."] }
  ]
}
```

- `front` (string, markdown) — prompt shown first.
- `back` (string, markdown) — answer revealed on click.
- `tags` (string[]) — see rules below.

Do **not** include scheduling fields (`interval`, `due`, `easeFactor`, `repetitions`, `lastReview`, `id`, `created`). The app adds them on first import.

## Content rules

- Both fields accept GitHub-flavored markdown (headings, lists, tables, code fences, `**bold**`, blockquotes).
- One question per card. Split multi-fact cards.
- `front` is a single question. Examples, context, and mnemonics go on `back`.
- Bold the key term being learned with `**...**`.

## Tagging rules

Each card carries **3–9 tags** across three tiers:

| Tier | Per card | What it is | Example |
| --- | --- | --- | --- |
| High-level | 1–3 | Broad domain | `photography`, `history`, `statistics` |
| Medium-level | 1–3 | Sub-area / cross-cutting concept | `optics`, `late-empire`, `inference` |
| Specific | 1–3 | Concrete topic of this card | `golden-hour`, `bayes-theorem` |

Default to **2 + 2 + 2 = 6 tags**.

Conventions:

- Lowercase, hyphenated: `data-structures`, not `dataStructures`.
- Singular: `algorithm`, not `algorithms`.
- No shorthand: `javascript`, not `js-stuff`.
- Reuse existing tags aggressively — a tag is only useful if it appears on more than one card.
- For large domains use a prefix: `sw/databases`, `fin/investing`.
- Tag order in the array: high → medium → specific, left to right.

## Example

```json
{
  "cards": [
    {
      "front": "How does **aperture** control depth of field?",
      "back": "Wider aperture (lower f-number, e.g. f/1.8) → shallower DOF. Narrower (f/11+) → more of the scene in focus.",
      "tags": ["photography", "optics", "exposure", "aperture", "depth-of-field"]
    },
    {
      "front": "Why does **diffraction** soften images at f/16 and beyond?",
      "back": "Light waves bend around the aperture blades; the resulting Airy disks exceed pixel size, reducing acutance regardless of lens quality.",
      "tags": ["photography", "optics", "image-quality", "aperture", "diffraction"]
    }
  ]
}
```

`photography` (high) anchors both cards. `optics` (medium) bridges them. `aperture` (specific) is shared by both, creating a tight cluster.

## Checklist before emitting JSON

- [ ] Every card has `front`, `back`, and `tags`.
- [ ] Each card has 3–9 tags spread across all three tiers.
- [ ] At least one specific or medium tag is shared with another card in the batch.
- [ ] No new tag is invented when an existing one fits — reuse aggressively.
- [ ] No scheduling fields are included.
