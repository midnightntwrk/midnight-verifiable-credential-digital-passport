--!strict

const DEFAULT_MODEL = "qwencloud/qwen3.8-max"
const JUDGE_MODEL = "qwencloud/deepseek-v4-flash-0731"

const PR_URL = "https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/pull/26"
const MAX_ITERATIONS = 15

local predicateAgent = require("./predicate")

local pi: Agent = ponos.agent("pi")

local converged = false
local iteration = 0
while iteration < MAX_ITERATIONS do
	local reviewer: Session = pi:session({ id = `reviewer:{iteration}` })
	reviewer:setConfig("model", DEFAULT_MODEL)

	reviewer:prompt(`Please ask Claude CLI to review the PR {PR_URL}.`)
	local reviewVerdict = reviewer:prompt("Based on Claude's review feedback, determine which issues are blocking and which ones are non-blocking.")
	ponos.log("Review verdict: " .. reviewVerdict.text)

	if
		predicateAgent(
			"The review verdict does not contain blocking issues",
			reviewVerdict.text,
			{ sessionId = `judge-review:{iteration}`, model = JUDGE_MODEL }
		)
	then
		reviewer:prompt("Please comment on the PR with Claude's review.")
		converged = true
		break
	end

	local needHumanResult = reviewer:prompt(
		"For the blocking issues, do you know how to resolve them, or do you need human input?"
	)
	if
		predicateAgent(
			"The blocking issues require human input to resolve",
			needHumanResult.text,
			{ sessionId = `judge-human:{iteration}`, model = JUDGE_MODEL }
		)
	then
		error("The change needs human input to resolve the issue")
	end

	local fixResult = reviewer:prompt("Go ahead and resolve the blocking issues.")
	ponos.log("Fix result: " .. fixResult.text)

	reviewer:prompt("Commit the changes and push them to the PR branch so the next review sees them.")
	reviewer:prompt("Comment on the PR with Claude's review and describe what has been fixed.")
	iteration += 1
end

if not converged then
	error(`Review loop did not converge after {MAX_ITERATIONS} iterations`)
end
