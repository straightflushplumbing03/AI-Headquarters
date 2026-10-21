# Website intelligence (read-only snapshot)

Copied from **[straightflushplumbing03/-Up2datewebsiteseo](https://github.com/straightflushplumbing03/-Up2datewebsiteseo)**,
the repository behind the live site straightflushplumbingoc.com. `SOURCE.txt` records the exact commit.

**The website repository is the source of truth and is never modified from here.** Edit these files there; refresh
this copy with:

```
scripts/sync-website-intelligence.sh
```

The script only reads the website repo (shallow clone into a temp folder), refuses to copy anything that looks like a
credential, and overwrites the folders below. Local edits to this folder are lost on the next sync.

| Folder | What it is | How AI Headquarters uses it |
|---|---|---|
| `growth-engine/` | Business profile, service catalog, service areas, approved claims, brand voice, keyword universe, competitor directory, AI-visibility methodology and history, citation engine, daily/weekly reports | Reference knowledge for agents: what the business offers, what may be claimed, how it sounds, what is being measured |
| `ai-headquarters-blueprint/` | Original AI Headquarters agent prompt, implementation sketch, MCP/integration plan | Design reference for the workforce |
| `briefs/` | Planning brief | Reference |

## How agents act on the website

Agents never write to the website from this folder. Website changes go through the workforce engine
(`supabase/migrations/025`, `026`): an agent needs an explicit owner grant such as `website.edit` on
`site:straightflushplumbingoc.com`, owner approval (or a configured delegation), and the change itself is a pull
request to the website repo, recorded as a deliverable.
