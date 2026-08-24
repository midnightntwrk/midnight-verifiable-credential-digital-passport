--!strict
--
-- .ponos/stacked-pr.luau
--
-- Review -> fix -> merge the stacked PRs 12 -> 14 -> 13 (dependency order;
-- GitHub retargets each PR's base as the branch below it is deleted).
--
-- Actors:
--   * Reviewer  — Claude Code, invoked per cycle by the opencode session via
--     the claude-pr-review skill (`claude -p "/code-review <N>" ...`).
--   * Fixer     — the opencode session itself (holds the review in context,
--     edits files, runs repo checks, commits, pushes).
--
-- Verdicts come back as typed results (resultSchema): approve | block |
-- unfixable, with blockingIssues[] and feedback (Claude's review verbatim).
--
-- Blocking bar: correctness bugs, security vulnerabilities, breaking
-- API/contract changes, failing CI/repo tests. Nits (style, naming, refactor
-- preferences) are never blocking and are left alone.
--
-- Abort conditions (exit 1, with a report): pre-flight failure, agent turn
-- timeout (60 min), agent declares an issue unfixable, identical blocking-
-- issue set two review cycles in a row, merge/comment failure.
--
-- Requirements: run from the repository root; `opencode` agent registered in
-- the ponos registry (user-level config); `claude` and `gh` CLIs installed
-- and authenticated.
--
-- Success: PRs are squash-merged (--auto, poll until MERGED) with Claude's
-- final review posted verbatim as a PR comment; after each merge the next
-- branch is rebased onto develop and force-pushed so its diff stays clean.

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

local PR_ORDER: { number } = { 14, 13 } -- bottom of the stack first
local BASE_BRANCH = "develop"

local TURN_TIMEOUT_MS: number = 60 * 60 * 1000 -- 60 min per agent turn
local SETUP_TIMEOUT_MS: number = 15 * 60 * 1000 -- 15 min for pre-flight / rebase turns
local REVIEW_RETRIES: number = 3 -- retries when the review turn submits no typed result
local STEP_RETRIES: number = 2 -- retries for upkeep / fix / merge turns

-- Per-session model config for the opencode agent (verified via
-- session:configOptions(): option ids are `model` and `effort`, with
-- effort choices low | high | max).
local SESSION_CONFIG = {
	model = "zai-coding-plan/glm-5.3",
	effort = "high",
}

-- ---------------------------------------------------------------------------
-- Typed-result contract
-- ---------------------------------------------------------------------------

-- verdict semantics per turn kind:
--   review turn : approve | block | unfixable (operational failure)
--   fix turn    : approve (all fixed + pushed) | unfixable
--   upkeep turn : approve (rebased + pushed) | block (rebase conflict)
--   merge turn  : approve (state MERGED) | block (comment/merge failed)
local resultSchema = {
	type = "object",
	properties = {
		verdict = { type = "string", enum = { "approve", "block", "unfixable" } },
		blockingIssues = { type = "array", items = { type = "string" } },
		feedback = { type = "string" },
	},
	required = { "verdict", "feedback" },
}

type Outcome = {
	verdict: string,
	blockingIssues: { string },
	feedback: string,
}

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

local function fail(msg: string)
	ponos.log("ABORT: " .. msg)
	ponos.exit(1)
end

local RETRY_SUFFIX = "\n\nREMINDER: your previous turn did not deliver a valid typed result. Submit it now via the ponos result_submit tool."

local function asOutcome(raw: any): Outcome?
	if type(raw) ~= "table" then
		return nil
	end
	local verdict = raw.verdict
	local feedback = raw.feedback
	if type(verdict) ~= "string" or type(feedback) ~= "string" then
		return nil
	end
	local issues: { string } = {}
	if type(raw.blockingIssues) == "table" then
		local rawIssues = raw.blockingIssues
		for _, issue in ipairs(rawIssues :: { any }) do
			if type(issue) == "string" then
				table.insert(issues, issue)
			end
		end
	end
	return { verdict = verdict, blockingIssues = issues, feedback = feedback }
end

-- Prompt the session and require a typed result; retry when the turn ends
-- without one. A turn timeout aborts the run immediately (stall guard).
local function ask(session: Session, promptText: string, retries: number, timeoutMs: number): Outcome
	local why = "unknown"
	for attempt = 1, retries do
		local text = promptText
		if attempt > 1 then
			text = promptText .. RETRY_SUFFIX
		end
		local ok, res = pcall(function()
			return session:prompt(text, { timeoutMs = timeoutMs })
		end)
		if not ok then
			fail("agent turn failed or timed out: " .. tostring(res))
		elseif res.stopReason ~= "end_turn" then
			why = "unexpected stopReason '" .. res.stopReason .. "'"
		else
			local parsed = asOutcome(res.result)
			if parsed ~= nil then
				return parsed
			end
			why = "no valid typed result submitted"
		end
	end
	fail("giving up after " .. retries .. " attempts: " .. why)
	error("unreachable")
end

-- Canonical key for a set of blocking issues (order-insensitive).
local function issueKey(issues: { string }): string
	local copy: { string } = {}
	for _, issue in ipairs(issues) do
		table.insert(copy, issue)
	end
	table.sort(copy)
	return table.concat(copy, "\x1f")
end

-- ---------------------------------------------------------------------------
-- Prompts
-- ---------------------------------------------------------------------------

local function preflightPrompt(): string
	local prList = ""
	for _, n in ipairs(PR_ORDER) do
		prList = prList .. ("  gh pr view %d --json number,title,state,mergeable,headRefName,baseRefName\n"):format(n)
	end
	return ([[
Run these READ-ONLY pre-flight checks in this repository. Do not modify anything.

1. Clean working tree:
   git status --porcelain
   -> must print nothing.

2. Synced checkout:
   git fetch origin --prune
   git rev-parse --abbrev-ref HEAD
   git rev-list --left-right --count %s...origin/%s
   -> branch must be "%s" and the count must be "0	0".

3. Every stacked PR open and mergeable:
%s   -> each must show state OPEN and mergeable MERGEABLE.

Then submit a typed result via the ponos result_submit tool:
- verdict "approve" and feedback = the raw check outputs, when everything passes
- verdict "block" and feedback = which check failed and its output, otherwise
]]):format(BASE_BRANCH, BASE_BRANCH, BASE_BRANCH, prList)
end

local function upkeepPrompt(prNum: number): string
	return ([[
The previous PR in this stack just merged into %s (squash merge) and its branch was deleted; GitHub has retargeted PR #%d's base to %s. Rebase PR #%d's branch so its diff contains only its own changes.

1. git fetch origin --prune
2. gh pr checkout %d
   (skip if already on the PR's head branch)
3. git rebase origin/%s
   Commits whose patches already landed via the squash merge drop out automatically.
4. If the rebase hits conflicts: run `git rebase --abort`, then submit verdict "block" with a feedback summary of the conflicting files.
5. git push --force-with-lease
6. Verify: gh pr view %d --json state,mergeable  -> must still be OPEN.

Then submit a typed result via the ponos result_submit tool:
- verdict "approve" and feedback = one-line summary, when rebased, pushed, and still OPEN
- verdict "block" and feedback = what failed, otherwise
]]):format(BASE_BRANCH, prNum, BASE_BRANCH, prNum, prNum, BASE_BRANCH, prNum)
end

local function reviewPrompt(prNum: number): string
	return ([[
Get a fresh code review of PR #%d and deliver a verdict.

Step 1 - Claude's review. Use your claude-pr-review skill (see ~/.config/opencode/skill/claude-pr-review/SKILL.md) to run Claude Code's /code-review on PR #%d. Run it fresh this cycle; do not reuse output from an earlier cycle. Keep Claude's COMPLETE review text - you will need it verbatim. If the claude invocation itself fails (error result, empty output), submit verdict "unfixable" with feedback describing the failure.

Step 2 - CI status. Run `gh pr checks %d`. If checks are still pending, poll every 30 seconds until they finish (budget: 15 minutes). Failing checks are blocking.

Step 3 - Verdict. BLOCKING issues are exactly:
- correctness bugs
- security vulnerabilities
- breaking API/contract changes
- failing CI checks or failing repo tests
Everything else (style, naming, refactor preferences, minor docs polish) is a nit - NEVER blocking.

Step 4 - Submit a typed result via the ponos result_submit tool:
- verdict "approve" when Claude's review raises no blocking issues and CI is green
- verdict "block" when there are blocking issues
- blockingIssues: one short line per blocking issue (Claude findings plus any failing checks); empty array when approving
- feedback: Claude's COMPLETE review output, verbatim, unedited
]]):format(prNum, prNum, prNum)
end

local function fixPrompt(prNum: number, issues: { string }): string
	local list = ""
	for i, issue in ipairs(issues) do
		list = list .. ("  %d. %s\n"):format(i, issue)
	end
	return ([[
Fix the blocking issues in PR #%d - and nothing else. Leave every nit alone (style, naming, refactor preferences).

Blocking issues:
%s
Workflow:
1. gh pr checkout %d
   (skip if already on the PR's head branch)
2. Fix each blocking issue listed above.
3. Run this repository's own checks (lint, typecheck, tests, build - whatever the repo defines) and make sure they pass.
4. Stage and commit everything as ONE conventional commit whose type matches the change (fix:, test:, ci:, docs:, chore:). Plain message; no AI-attribution footers.
5. git push  (the PR branch already tracks origin)

Then submit a typed result via the ponos result_submit tool:
- verdict "approve", blockingIssues empty, feedback = one-line summary of the commit, once everything is fixed, checks pass, and the commit is pushed
- verdict "unfixable", blockingIssues = the issues you cannot fix, feedback = why, if you determine an issue cannot be fixed without human judgment
]]):format(prNum, list, prNum)
end

local function mergePrompt(prNum: number): string
	return ([[
PR #%d passed review. Finalize it.

1. Post Claude's final review as a PR comment, VERBATIM. The review text is what you submitted as `feedback` in the review turn that approved this PR - post exactly that text, no edits, no omissions, under this header:

## 🤖 Claude code-review (final pass)

Write the body to a file first to avoid shell-quoting problems:
  cat > /tmp/pr-%d-final-review.md <<'PONOS_EOF'
  ## 🤖 Claude code-review (final pass)

  <Claude's final review verbatim>
  PONOS_EOF
  gh pr comment %d --body-file /tmp/pr-%d-final-review.md

2. Merge:
   gh pr merge %d --squash --auto
   (This repo allows squash only; the branch auto-deletes on merge and the stacked PR above gets retargeted automatically.)

3. Poll the merge (with --auto GitHub merges as soon as checks are green):
   gh pr view %d --json state --jq .state
   every 30 seconds, budget 30 minutes, until state is MERGED.

4. Submit a typed result via the ponos result_submit tool:
- verdict "approve" and feedback = the comment URL and final PR state, once state is MERGED
- verdict "block" and feedback = what went wrong (comment failure, merge failure, poll budget exhausted, last state seen), otherwise
]]):format(prNum, prNum, prNum, prNum, prNum, prNum)
end

-- ---------------------------------------------------------------------------
-- Main
-- ---------------------------------------------------------------------------

local function processPr(agent: Agent, prNum: number, isFirst: boolean)
	local s = agent:session({
		id = "pr-" .. prNum,
		resultSchema = resultSchema
	})
	s:setConfig("model", SESSION_CONFIG.model)
	s:setConfig("effort", SESSION_CONFIG.effort)

	-- Stack upkeep: rebase onto the base branch after the previous merge.
	if not isFirst then
		ponos.log(("PR %d: rebasing onto %s after previous merge"):format(prNum, BASE_BRANCH))
		local up = ask(s, upkeepPrompt(prNum), STEP_RETRIES, SETUP_TIMEOUT_MS)
		if up.verdict ~= "approve" then
			fail(("PR %d: stack upkeep failed: %s"):format(prNum, up.feedback))
		end
	end

	-- Review -> fix loop. Unlimited cycles, stall-guarded.
	local prevIssueKey: string? = nil
	local cycle = 0
	while true do
		cycle += 1
		ponos.log(("PR %d: review cycle %d"):format(prNum, cycle))
		local rev = ask(s, reviewPrompt(prNum), REVIEW_RETRIES, TURN_TIMEOUT_MS)

		if rev.verdict == "unfixable" then
			fail(("PR %d: review could not be obtained: %s"):format(prNum, rev.feedback))
		elseif rev.verdict == "approve" then
			ponos.log(("PR %d: approved after %d cycle(s)"):format(prNum, cycle))
			break
		elseif rev.verdict == "block" then
			if #rev.blockingIssues == 0 then
				rev.blockingIssues = { "(review blocked but no issues listed)" }
			end
			local key = issueKey(rev.blockingIssues)
			if key == prevIssueKey then
				fail(("PR %d: stall - identical blocking issues two cycles in a row:\n  - %s"):format(
					prNum,
					table.concat(rev.blockingIssues, "\n  - ")
				))
			end
			prevIssueKey = key
			ponos.log(("PR %d: %d blocking issue(s):\n  - %s"):format(
				prNum,
				#rev.blockingIssues,
				table.concat(rev.blockingIssues, "\n  - ")
			))

			local fix = ask(s, fixPrompt(prNum, rev.blockingIssues), STEP_RETRIES, TURN_TIMEOUT_MS)
			if fix.verdict == "unfixable" then
				fail(("PR %d: agent declared an issue unfixable: %s"):format(prNum, fix.feedback))
			elseif fix.verdict ~= "approve" then
				fail(("PR %d: fix turn failed: %s"):format(prNum, fix.feedback))
			end
			-- loop back around: fresh Claude review of the updated PR
		else
			fail(("PR %d: unexpected verdict '%s'"):format(prNum, rev.verdict))
		end
	end

	-- Comment Claude's final review verbatim, squash-merge, poll until MERGED.
	ponos.log(("PR %d: posting final review comment and merging"):format(prNum))
	local m = ask(s, mergePrompt(prNum), STEP_RETRIES, TURN_TIMEOUT_MS)
	if m.verdict ~= "approve" then
		fail(("PR %d: merge failed: %s"):format(prNum, m.feedback))
	end
	ponos.log(("PR %d: merged (%s)"):format(prNum, m.feedback))

	s:close()
end

local agent = ponos.agent("opencode")

-- Pre-flight: one dedicated session; abort before any mutation.
local pre = agent:session({ id = "preflight", resultSchema = resultSchema })
pre:setConfig("model", SESSION_CONFIG.model)
pre:setConfig("effort", SESSION_CONFIG.effort)
ponos.log("pre-flight checks")
local pf = ask(pre, preflightPrompt(), REVIEW_RETRIES, SETUP_TIMEOUT_MS)
if pf.verdict ~= "approve" then
	fail("pre-flight failed:\n" .. pf.feedback)
end
ponos.log("pre-flight OK:\n" .. pf.feedback)
pre:close()

for i, prNum in ipairs(PR_ORDER) do
	processPr(agent, prNum, i == 1)
end

ponos.log(("stack complete: PRs %s reviewed, fixed, and merged into %s"):format(
	table.concat(PR_ORDER, " -> "),
	BASE_BRANCH
))
