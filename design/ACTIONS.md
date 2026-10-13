# git-huh — everything you can do on GitHub, and where it is

This lists what a person can *do* on github.com, grouped by object, with where
each action lives in the app, or why it doesn't. Keep it current: an action
added or removed changes this file in the same commit.

**yes** means it works in the app. **link** means the app opens the page on
github.com. **no** means it is left out on purpose, with the reason.

The `host` section's actions (restart, stop, a service's own verbs) are not
GitHub's and are not listed here: they are whatever the `hostd` server's
config allows, and that server's repository documents them.

Every write goes through `Composer` (`src/components/Composer.tsx`). The
functions behind them are in `src/lib/writes.ts`, plus `src/lib/checks.ts` for
Actions. Each one was checked against GitHub's live GraphQL schema when it was
added.

## Pull requests

| action | | where |
|---|---|---|
| read the description, conversation, diff, checks | yes | `pull`: brief · talk · files · checks |
| comment | yes | `talk` → `comment` |
| approve · request changes · review comment | yes | `talk`, on someone else's open pull request |
| comment on any line, changed or not | yes | `files`, tap the line |
| reply inside a review thread | yes | `reply in thread` under the thread |
| resolve · unresolve a thread | yes | under the thread, when GitHub allows it |
| dismiss a review | yes | under an approving or blocking review, for people who can push |
| react to the pull request or any comment | yes | `react`; reactions are words (`+1`, `heart`), not emoji |
| edit · delete your own comment | yes | `edit` / `delete` under it (delete is pressed twice) |
| edit title and description | yes | brief → details → `edit title and description` (pencil) |
| labels · assignees · reviewers · milestone | yes | brief → details → the pencil on each row |
| assign yourself | yes | brief → details → `assign me` |
| lock · unlock the conversation | yes | brief → details → `lock` (pressed twice) |
| merge · squash · rebase | yes | talk → merge box; only the methods the repository allows; pressed twice; pinned to the head you looked at |
| merge when ready (auto-merge) · cancel it | yes | merge box, when the repository allows it |
| update branch | yes | merge box, when it is behind |
| ready for review · back to draft | yes | merge box |
| close · reopen | yes | merge box |
| delete the head branch after merging | yes | merge box |
| re-run failed jobs · approve a held run · approve or reject a deployment | yes | `checks` |
| open a pull request | yes | repository → `pulls` → `new pull request`; `code` → `pull request` on a branch; any `/compare/` link |
| edit a file into a pull request (through a fork if needed) | yes | a file → `edit` |
| suggested changes (` ```suggestion `) | partly | written as Markdown in a line comment; applying one is not supported |
| a pending review with several line comments | no | each line comment is sent on its own; the website's batching needs a draft-review state the phone would have to hold |
| resolve merge conflicts | no | needs an editor across several files at once; the merge box says to resolve them first |
| change the base branch | no | rare, and easy to get wrong on a phone |
| follow · unfollow a thread | no | GitHub's mutation needs the `notifications` scope, which the app never asks for |

## Issues

| action | | where |
|---|---|---|
| read, comment | yes | `thread` |
| close as done · close as not planned · reopen | yes | the composer at the end |
| react, edit or delete your comments | yes | under each comment |
| edit title and body | yes | the pencil on the title card |
| labels · assignees · milestone · assign yourself | yes | details |
| lock · unlock | yes | details → `lock` (pressed twice) |
| pin · unpin to the repository | yes | details → `pin` |
| open a new issue, templates and forms included | yes | repository → `issues` → `new issue` |
| list open and closed | yes | repository → `issues` |
| transfer to another repository | no | an admin action, rare on a phone |
| delete an issue | no | admin-only and permanent |
| sub-issues · issue types · projects | no | not read anywhere else in the app yet |

## Discussions

| action | | where |
|---|---|---|
| read, reply | yes | `thread` |
| reply to a reply | yes | `reply to this` under a top-level reply |
| vote up the discussion or a reply | yes | `▲ n` |
| mark · unmark as the answer | yes | under a reply, in a Q&A category |
| react, edit or delete your replies | yes | under each reply |
| edit the title and post | yes | the pencil on the title card |
| close · reopen | yes | the composer at the end |
| start a discussion | yes | repository → `discussions` → `new discussion` |
| polls, convert to an issue | no | rare, and polls cannot be created through the API |

## Repositories

| action | | where |
|---|---|---|
| browse files on any branch, search the code | yes | `repo` → `code` |
| star · unstar | yes | under the repository's name |
| watch · ignore · back to participating | yes | under the name (REST, so `repo` scope is enough) |
| fork | yes | under the name, on repositories that are not yours; pressed twice; opens the fork |
| switch branch · new branch · delete branch | yes | `code` → the branch pill |
| new file | yes | `code` → `+` beside the path (commits to the branch you are on) |
| edit a file (commit, or branch and pull request) | yes | a file → `edit` |
| delete a file | yes | a file → `delete`, for people who can push; pressed twice |
| list pull requests, open and closed | yes | `pulls` |
| releases: read · publish · draft · delete | yes | `releases`; notes can be written from the merged pull requests |
| download release assets | link | `assets on github` |
| Actions: list workflows, run one by hand (with inputs) | yes | `actions` → `run`, for `workflow_dispatch` workflows |
| Actions: re-run · re-run failed · cancel · approve a held run | yes | `actions` → latest runs |
| Actions: full logs | link | `logs on github`; the end of a failing job's log is in a pull request's `checks` |
| Dependabot alerts: read · dismiss with a reason | yes | `security` |
| create a repository | yes | the account page → `new repository`, your profile, or an idea → `make a repository` (named after it and linked back) |
| settings, collaborators, branch protection, webhooks, secrets | no | settings stay on the website; nobody asked for them on a phone (`STORIES.md` §4) |
| delete · archive · rename · transfer a repository | no | permanent, and admin-only; needs a scope (`delete_repo`) the app should not hold |
| wiki · projects · Pages · packages · codespaces | link | they open on github.com |
| code scanning and secret scanning alerts | no | only Dependabot is read |

## People and you

| action | | where |
|---|---|---|
| open a profile from any `~name` | yes | `user` |
| follow · unfollow | yes | `user` (needs `user:follow`) |
| an organisation's profile and repositories | yes | `user`, for an organisation login |
| your contributions, languages, pull requests, reviews | yes | the five sections |
| several accounts, added together | yes | the account page |
| edit your profile or status | no | needs the `user` scope, which also allows changing your email; not worth holding for a bio |
| SSH keys, tokens, billing, settings | no | the website |

## Gists

| action | | where |
|---|---|---|
| list yours (secret ones too) or someone else's | yes | account page → `your gists`; any profile → `gists` |
| read | yes | `gist` |
| create (public or secret) | yes | `your gists` → `new gist` (needs `gist`) |
| star · unstar | yes | `gist` |
| delete your own | yes | `gist`, pressed twice |
| edit · fork · comment on a gist | no | rare on a phone; the website does it |

## Search

| action | | where |
|---|---|---|
| repositories · issues · pull requests · people, with the site's qualifiers | yes | the search glyph on the `repos` block, or the account page |
| code, across your repositories or inside one | yes | `repos` block; repository → `code` |
| commits, topics, discussions, packages | no | not yet |

## Notifications

| action | | where |
|---|---|---|
| what wants you (review requests, mentions, comments on your work) | yes | `inbox`, built from search and each pull request's talk |
| done · snooze, kept on the device | yes | swipe a row in `inbox` |
| background check and local notifications | yes | the account page → notifications |
| GitHub's own notifications list, mark read, unsubscribe | no | needs the `notifications` scope; the inbox is built without it on purpose (`CLAUDE.md`) |

## Scopes

The token form and the OAuth device flow ask for: `read:user`, `repo`,
`read:discussion`, `write:discussion`, `security_events`, `user:follow`,
`gist`. Each screen still works with fewer scopes. When a write is refused,
the composer says the token needs more scope instead of a generic failure.
