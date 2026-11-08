# The control repository comes from a public template, which every copy follows

- Status: accepted
- Date: 2026-11-08

## Context

Repo Pager is self-hosted ([decision 0018](0018-the-pager-is-repo-pager-which-everyone-runs-as-an-instance-of-their-own.md)): everyone runs their own bot, Worker, GitHub App and private control repository. The Worker is public, but the control repository, the half that runs Claude Code, existed only as the maintainer's own private `Dennis-Otto/repo-pager-control`. Step 7 of [Set up](../setup.md) told the reader to write a workflow of their own by the contract of [How it works](../how-it-works.md), and pointed to a README that nobody else can read, so nobody else could finish the set-up.

A copy has to stay private, because the logs of Actions in a public repository are public, and these logs show issues, drafts and what Claude read. Its code can be public, and has to keep up with the Worker: a change of the contract changes both sides. On 2026-11-08 the maintainer decided that the control repository gets a public template.

## Options

1. **A guide only.** The contract is public and each user writes their workflow. Nobody does that for a pager that they want to try in half an hour, and every fix of a security rule, such as the egress firewall of the job of Claude, stays in one repository.
2. **A template, and the maintainer's own repository stays the source.** A workflow of the private repository copies the generic files into the template. The development happens where nobody can see it, the copy has to tell generic from personal files on every change, and the users' copies never hear of a change.
3. **A template that is the source of every copy.** `Dennis-Otto/repo-pager-control-template` holds the code, and every control repository, the maintainer's own included, is made from it with *Use this template* and takes its changes by a pull request of a workflow of its own. The files that belong to one owner, such as the voice of their drafts, are listed apart and never taken.

## Decision

Option 3. The template is public, and a control repository is a private copy of it:

- **One source:** a change of the control repository's code, such as a new kind of job for a new body of the contract, is a pull request of the template. The maintainer's own repository is a copy like any other, so a change that it needs reaches every copy, and the template is tested by its tests on every pull request.
- **The copies follow:** `.github/template.json` of each copy names the template, the commit of it that the copy took last, and `own`, the files of its own. The workflow *Template* of each copy runs every week and by hand, compares the copy's files with those of the template's newest commit, and brings each file that differs, and deletes each that the template deleted since the commit taken last, as one pull request of the branch `template-sync`. Its commit comes through the API, which GitHub signs, with `PAGER_FIX_TOKEN`, since only a token with *Workflows* may change a workflow, and the pull request runs the tests of the copy, its smoke test of Claude included, before the owner merges it. The pager gets a report with the link, since the owner gets no notification of a pull request of their own token. Without the token, the run fails with what waits, so that GitHub tells the owner.
- **What is one owner's own:** the README, which describes their instance, and `pager/voice.md`, the voice of their drafts, which the template gives as an example. The rules of the jobs, `pager/rules.md`, are the template's: they keep Claude to data that is never an instruction, so a better rule must reach every copy. A file that a copy changed and doesn't list in `own` goes back to the template's with the next pull request, which shows it in its diff.
- **Nothing of one instance in the template:** the texts and the prompts speak of the maintainer, the variable `PAGER_APP` names the owner's GitHub App, the command line of the agents finds its control repository by the remote `origin` of its checkout, and no address of a Worker, id or token is in it.

## Consequences

- Anyone can finish the set-up: [Set up](../setup.md) creates the control repository from the template with `gh repo create --template`, and the template's README is its guide.
- The workflow of the maintainer's own control repository is public as code and private as logs, as everyone's is.
- `PAGER_FIX_TOKEN` gets the control repository itself among its repositories, so that the workflow *Template* can open its pull request; its day is already watched by *Health*.
- A change of the contract still changes both sides, the Worker first, since it refuses a body that it doesn't know; the second side is now the template, and each copy takes it with its next pull request of the template.
- The workflow *Template* writes its commit with the API of GitHub, which can't set the mode of a file: the template holds no executable file, and its workflows run their scripts with `node` and `bash`.
