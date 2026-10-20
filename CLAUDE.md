# CLAUDE.md

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues on `rosca-cristian/kuenta-app`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Commits

- Commits are authored by the user, not by Claude: author and committer `rosca-cristian <cristiancod98@gmail.com>` (set `user.name` and `user.email` in the repo's git config, or pass `--author`).
- Don't add any Claude attribution to commit messages: no `Co-Authored-By:` line for Claude and no `Claude-Session:` line.
