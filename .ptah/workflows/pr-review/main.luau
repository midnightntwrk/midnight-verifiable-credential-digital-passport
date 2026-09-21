--!strict
-- PR review workflow: run the convergent review→validate→fix→verify loop
-- against one pull request whose URL the caller injects through the
-- `PR_URL` environment variable.
--
-- The `pr` playbook (the PR review loop) owns the whole loop — the
-- discovery/delta review passes, the typed judge and its persistent ledger,
-- the batched fix-and-push turns, and the posted PR review report. This
-- shim owns the local config (agent handles, model, cap), the `PR_URL`
-- lookup, and the git context those fix turns need, so a caller composes it
-- as:
--
--   PR_URL=https://github.com/owner/repo/pull/123 \
--     ptah run .ptah/workflows/pr-review/main.luau
--
-- The git context is a provisioned worktree on the PR's head branch. The
-- playbook is git-agnostic (its `workingDir` is just a directory, and
-- provisioning it is the calling shim's business), and with `dryRun = false`
-- its fix turns commit and push from the sessions' working directory — so
-- every session runs in a checkout of the PR branch and the invocation
-- directory's own branch never matters. A caller must know: the PR's head
-- must live in this repository's origin (a fork head does not resolve and
-- provision fails loudly), the invocation checkout must not itself be on
-- the PR head branch (git refuses one branch in two worktrees — also a
-- loud failure), and the worktree is torn down after the loop (refuse
-- dirty: an uncommitted fix keeps it, logged; the branch survives
-- teardown).
--
-- Environment requirements (declared by the playbook, not bundled here):
-- the `pi` agent must resolve in the ptah registry (.ptah/config.toml or
-- the user layer), `gh` must be on PATH, authenticated, with the PR URL
-- a GitHub pull request URL, and `git` must be on PATH for the worktree
-- steps. One loop per PR: two concurrent runs on one PR corrupt the
-- ledger comment.

local libs = require("@ptah_libs")

local pr = libs.pr

-- ---------------------------------------------------------------------------
-- Local config
-- ---------------------------------------------------------------------------

-- The review model, shared by the reviewer, the judge, and the reporter.
-- The three configs stay split so a per-role model can be introduced without
-- rewiring the constructor below.
local MODEL = "zai/glm-5.3"

-- Convergence cap: at the cap with open blocking findings the loop ends
-- non-converged without pushing a final fix (every push is followed by at
-- least one review pass).
local MAX_REVIEW_ITERATIONS = 10

local sessionConfig = { { id = "model", value = MODEL } }
local judgeConfig = { { id = "model", value = MODEL } }
local reporterConfig = { { id = "model", value = MODEL } }

-- ---------------------------------------------------------------------------
-- The injected PR URL
-- ---------------------------------------------------------------------------

-- The caller injects the pull request through PR_URL. An unset or empty
-- variable is a loud misconfiguration: there is no PR to review and no
-- repository context to fall back on.
local function injectedPrUrl(): string
	local url = os.getenv("PR_URL")
	if url == nil or url == "" then
		error("pr-review: PR_URL is not set; the caller must inject the pull request URL", 0)
	end
	return url
end

-- The PR number from the URL, naming the worktree (`pr-<n>`) so it never
-- collides with the factory's per-issue worktrees (`issue-<n>`).
local function prNumber(prUrl: string): string
	local number = string.match(prUrl, "^https?://github%.com/[^/]+/[^/]+/pull/(%d+)")
	if number == nil then
		error(("pr-review: %s is not a GitHub pull request URL"):format(prUrl), 0)
	end
	return number
end

-- ---------------------------------------------------------------------------
-- The worktree on the PR head branch
-- ---------------------------------------------------------------------------

local gh = libs.std.gh
local worktree = libs.std.worktree

-- The head branch name, straight from the API, so the worktree is cut from
-- what the PR actually tracks. A fork PR's head lives in another repository,
-- so `origin/<branch>` does not resolve and provision fails loudly — the
-- documented same-repo restriction.
local function prHeadBranch(prUrl: string): string
	local outcome = gh.run({ "pr", "view", prUrl, "--json", "headRefName" }, { json = true })
	if not outcome.ok then
		error(("pr-review: could not read the head branch of %s: %s"):format(prUrl, outcome.stderr), 0)
	end
	local branch = outcome.json.headRefName
	if type(branch) ~= "string" or branch == "" then
		error(("pr-review: %s carried no head branch name"):format(prUrl), 0)
	end
	return branch
end

-- Provision the worktree the loop's sessions run in: on the PR head branch,
-- fetched, adopting an earlier run's worktree (same path, same branch) so an
-- interrupted review resumes. Fix turns commit and push from here; the
-- invocation directory is never touched.
local function prepareWorktree(prUrl: string): { path: string, branch: string, ref: string }
	local headBranch = prHeadBranch(prUrl)
	return worktree.provision({
		name = ("pr-%s"):format(prNumber(prUrl)),
		ref = ("origin/%s"):format(headBranch),
		branch = headBranch,
		fetch = true,
	})
end

-- ---------------------------------------------------------------------------
-- The loop
-- ---------------------------------------------------------------------------

local work = ptah.agent("pi")
local judge = ptah.agent("pi")
local reporter = ptah.agent("pi")

-- `reviewInstruction` is left nil, which selects the playbook's built-in
-- reviewer persona. Configure one (or the pointer pattern, e.g.
-- "Follow the reviewer instruction at .ptah/instructions/reviewer.md") to
-- fully replace it.
local prUrl = injectedPrUrl()
local wt = prepareWorktree(prUrl)

local reviewLoop = pr.new({
	agent = work,
	judgeAgent = judge,
	reporterAgent = reporter,
	sessionConfig = sessionConfig,
	judgeSessionConfig = judgeConfig,
	reporterSessionConfig = reporterConfig,
	workingDir = wt.path,
	dryRun = false,
	maxIterations = MAX_REVIEW_ITERATIONS,
	reviewInstruction = "Use claude cli to review the PR"
})

ptah.log(("pr-review: reviewing %s (worktree %s on branch %s)"):format(prUrl, wt.path, wt.branch))

local outcome = reviewLoop:review(prUrl)

-- The playbook counts convergence from the ledger's open blocking findings;
-- restate that count here for the run's tail log. The terminal report is
-- already posted as a marked PR comment and returned as `outcome.report`.
local openBlocking = 0
for _, finding in outcome.ledger.findings do
	if finding.severity == "blocking" and finding.status == "open" then
		openBlocking += 1
	end
end
ptah.log(("pr-review: %s (%d open blocking finding(s))"):format(outcome.status, openBlocking))

-- Tear the worktree down now the loop is done: refuse-dirty by default, so
-- an uncommitted fix keeps it (logged below) rather than losing state; the
-- branch survives teardown either way.
local removed = worktree.teardown(wt)
if not removed.ok then
	ptah.log(("pr-review: worktree kept at %s: %s"):format(wt.path, tostring(removed.stderr)))
end
