# x-grok-to-obsidian

Reusable OpenClaw skill to export Grok conversations from X (x.com) and convert them into Obsidian-ready Markdown files.

## What it does

Two-stage workflow:

1. **Capture JSON from X/Grok** in browser (network-level capture of `GrokConversationItemsByRestId`).
2. **Convert captured JSON to Markdown** with role-separated turns (`User` / `Grok`) and Obsidian frontmatter.

## Skill structure

- `SKILL.md` — skill metadata + usage instructions
- `scripts/export_grok_items_capture.js` — browser capture script (run in DevTools)
- `scripts/convert_grok_capture_to_md.py` — JSON → Markdown converter

## Quick usage

### 1) Capture from X/Grok

- Open `https://x.com/i/grok` while logged in.
- Open browser DevTools Console.
- Paste/run `scripts/export_grok_items_capture.js`.
- Download output JSON: `grok-network-capture-<timestamp>.json`.

### 2) Convert to Markdown

```bash
python3 scripts/convert_grok_capture_to_md.py \
  --input /path/to/grok-network-capture-*.json \
  --out /path/to/output-folder
```

## Converter defaults

- Frontmatter: `URL`, `created`, optional `source_tweets`
- Turn headings: `## User` / `## Grok`
- Turn separator: `---`
- API item order reversed to conversation order
- Reasoning/deepsearch excluded by default

## Notes

- X history loading is lazy; multi-pass discovery improves completeness.
- This project intentionally avoids shipping personal data and auth artifacts.

## License

MIT
