--!strict
-- PR review workflow: run the convergent review→validate→fix→verify loop
-- against one pull request whose URL the caller injects through the
-- `PR_URL` environment variable.
--
-- The `pr` playbook (the PR review loop) owns the whole loop — the
-- discovery/delta review passes, the typed judge and its persistent ledger,
-- the batched fix-and-push turns, and the posted PR review report. This
-- shim owns only the local config (agent handles, model, cap) and the
-- `PR_URL` lookup, so a caller composes it as:
--
--   PR_URL=https://github.com/owner/repo/pull/123 \
--     ptah run .ptah/workflows/pr-review/main.luau
--
-- Environment requirements (declared by the playbook, not bundled here):
-- the `pi` agent must resolve in the ptah registry (.ptah/config.toml or
-- the user layer), and `gh` must be on PATH, authenticated, with the PR URL
-- a GitHub pull request URL. One loop per PR: two concurrent runs on one PR
-- corrupt the ledger comment.

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
-- repository context to fall back to.
local function injectedPrUrl(): string
	local url = os.getenv("PR_URL")
	if url == nil or url == "" then
		error("pr-review: PR_URL is not set; the caller must inject the pull request URL", 0)
	end
	return url
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
local reviewLoop = pr.new({
	agent = work,
	judgeAgent = judge,
	reporterAgent = reporter,
	sessionConfig = sessionConfig,
	judgeSessionConfig = judgeConfig,
	reporterSessionConfig = reporterConfig,
	dryRun = false,
	maxIterations = MAX_REVIEW_ITERATIONS,
	reviewInstruction = "Use claude cli to review the PR"
})

local prUrl = injectedPrUrl()
ptah.log(("pr-review: reviewing %s"):format(prUrl))

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
