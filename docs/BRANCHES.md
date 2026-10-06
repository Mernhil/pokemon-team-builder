# Branches and PRs

- One PR per piece of work, never one per fix.
- Workflow-only fixes (release, CI) batch into a single PR instead of a chain of them. The 0.25.0 release needed four of them (#42 to #45).
- Finished work goes into a PR in the same session, so it isn't left on a branch nobody merges. The Sticker look sat unmerged through a release that way.
- When a PR is merged its branch is deleted: GitHub → Settings → General → "Automatically delete head branches" is on.
- A branch with no open PR and nothing ahead of the default branch (`git rev-list --count origin/claude/pokemon-team-builder-otextg..origin/<branch>` is 0) is stale: delete it.
- A branch that looks unmerged but is old may have been squash-merged: check that its feature exists in the default branch before deleting it.
