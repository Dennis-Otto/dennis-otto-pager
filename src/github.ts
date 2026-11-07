/**
 * The REST API of GitHub, and its GraphQL API for the reply in a discussion, as the
 * GitHub App of the pager and, for the two things that act in the maintainer's
 * name, with their own token. Each token of the app is made for one repository and
 * only the permissions of its call, and lives in memory for less than its hour.
 */
import { base64url, utf8 } from "./crypto.ts";
import type { Discussion } from "./store.ts";
import type { Fetch } from "./telegram.ts";

const API = "https://api.github.com";
const AGENT = "dennis-otto-pager";

export class GitHubError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`GitHub answered ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

/** A call in the maintainer's name without GITHUB_USER_TOKEN, which never reaches GitHub. */
export class NoUserToken extends GitHubError {
  constructor() {
    super(
      401,
      "GITHUB_USER_TOKEN isn't set, so nothing can act in the maintainer's name",
    );
  }
}

/** The DER length of n bytes. */
function derLength(length: number): number[] {
  if (length < 0x80) {
    return [length];
  }
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * A key of PKCS #1, as GitHub hands out the private key of an app, wrapped as
 * PKCS #8, which Web Crypto imports.
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const octets = [0x04, ...derLength(pkcs1.length)];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octets];
  const total = body.length + pkcs1.length;
  const der = new Uint8Array([0x30, ...derLength(total), ...body, ...pkcs1]);
  return der;
}

/** The bytes of a key in PEM, as PKCS #8, whether GitHub's PKCS #1 or PKCS #8. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const match =
    /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END \1?PRIVATE KEY-----/.exec(
      pem.replace(/\\n/g, "\n"),
    );
  if (match === null) {
    throw new Error("GITHUB_APP_PRIVATE_KEY holds no private key in PEM");
  }
  const binary = atob(String(match[2]).replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return match[1] === undefined ? bytes : pkcs1ToPkcs8(bytes);
}

/** The JWT with which the app asks for the token of an installation, for 9 minutes. */
export async function appJwt(
  appId: string,
  pem: string,
  now: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const seconds = Math.floor(now / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8(unsigned),
  );
  return `${unsigned}.${base64url(signature)}`;
}

/** The tokens of installations, by installation, repository and permissions. */
const tokens = new Map<string, { token: string; until: number }>();
/** The required checks of a branch, by repository and branch, for ten minutes. */
const required = new Map<string, { checks: string[]; until: number }>();

/** Forget every token and every cached answer, as a new isolate would. */
export function forget(): void {
  tokens.clear();
  required.clear();
}

export interface PullRequest {
  number: number;
  state?: string;
  title?: string;
  draft?: boolean;
  mergeable_state?: string;
  html_url?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; repo?: { default_branch?: string } };
}

/** The parts of a run of GitHub Actions that 🔁 Rerun reads: those of its newest attempt. */
export interface WorkflowRun {
  status?: string;
  conclusion?: string | null;
}

export type Permissions = Record<string, "read" | "write">;

/** The thread of a comment of a discussion: that of its parent, for a reply. */
const THREAD = `query($comment: ID!) {
  node(id: $comment) { ... on DiscussionComment { replyTo { id } } }
}`;

/** A comment on a discussion, or a reply in the thread of one of its comments. */
const REPLY = `mutation($discussion: ID!, $replyTo: ID, $body: String!) {
  addDiscussionComment(input: {discussionId: $discussion, replyToId: $replyTo, body: $body}) {
    comment { id }
  }
}`;

export class GitHub {
  private readonly appId: string;
  private readonly appKey: string;
  private readonly userToken: string | null;
  private readonly fetch: Fetch;
  private readonly now: () => number;

  constructor(
    appId: string,
    appKey: string,
    userToken: string | null,
    fetcher: Fetch,
    now: () => number,
  ) {
    this.appId = appId;
    this.appKey = appKey;
    this.userToken = userToken;
    this.fetch = fetcher;
    this.now = now;
  }

  private async call(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": AGENT,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return this.fetch(`${API}${path}`, init);
  }

  private async json<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      let detail = text.slice(0, 200);
      try {
        detail = (JSON.parse(text) as { message?: string }).message ?? detail;
      } catch {
        // Not JSON: the start of the text says enough.
      }
      throw new GitHubError(response.status, detail);
    }
    return response.json<T>();
  }

  /**
   * A query or a mutation of the GraphQL API. GitHub answers 200 also when it
   * refuses one, with its reasons in errors: the first of them is the detail.
   */
  private async graphql<T>(
    token: string,
    query: string,
    variables: Record<string, unknown>,
    /** A type of error, such as NOT_FOUND, whose data still answers the query. */
    allowed?: string,
  ): Promise<T> {
    const answer = await this.json<{
      data?: T;
      errors?: { type?: string; message?: string }[];
    }>(await this.call(token, "POST", "/graphql", { query, variables }));
    const error = answer.errors?.[0];
    const answers =
      allowed !== undefined &&
      error?.type === allowed &&
      answer.data !== undefined;
    if (error !== undefined && !answers) {
      throw new GitHubError(200, error.message ?? "the GraphQL API refused");
    }
    return answer.data as T;
  }

  /** A token of the app for one repository, with only the permissions of a call. */
  async token(
    installation: number,
    repo: string,
    permissions: Permissions,
  ): Promise<string> {
    const name = repo.split("/")[1] ?? repo;
    const cacheKey = `${installation}|${repo}|${JSON.stringify(permissions)}`;
    const cached = tokens.get(cacheKey);
    if (cached !== undefined && cached.until > this.now()) {
      return cached.token;
    }
    const jwt = await appJwt(this.appId, this.appKey, this.now());
    const answer = await this.json<{ token: string; expires_at: string }>(
      await this.call(
        jwt,
        "POST",
        `/app/installations/${installation}/access_tokens`,
        { repositories: [name], permissions },
      ),
    );
    tokens.set(cacheKey, {
      token: answer.token,
      until: Date.parse(answer.expires_at) - 5 * 60 * 1000,
    });
    return answer.token;
  }

  /** The installation of the app on a repository, or null where it isn't installed. */
  async installation(repo: string): Promise<number | null> {
    const jwt = await appJwt(this.appId, this.appKey, this.now());
    const response = await this.call(jwt, "GET", `/repos/${repo}/installation`);
    if (response.status === 404) {
      return null;
    }
    return (await this.json<{ id: number }>(response)).id;
  }

  async pullRequest(
    installation: number,
    repo: string,
    number: number,
  ): Promise<PullRequest> {
    const token = await this.token(installation, repo, {
      pull_requests: "read",
    });
    return this.json<PullRequest>(
      await this.call(token, "GET", `/repos/${repo}/pulls/${number}`),
    );
  }

  /** Squash-merge a pull request, only while its head is still sha. */
  async merge(
    installation: number,
    repo: string,
    number: number,
    sha: string,
  ): Promise<void> {
    // Merging needs to write the contents: the squash commit lands on the branch.
    const token = await this.token(installation, repo, { contents: "write" });
    await this.json(
      await this.call(token, "PUT", `/repos/${repo}/pulls/${number}/merge`, {
        merge_method: "squash",
        sha,
      }),
    );
  }

  /** A run of GitHub Actions, as its newest attempt stands. */
  async workflowRun(
    installation: number,
    repo: string,
    id: number,
  ): Promise<WorkflowRun> {
    const token = await this.token(installation, repo, { actions: "read" });
    return this.json<WorkflowRun>(
      await this.call(token, "GET", `/repos/${repo}/actions/runs/${id}`),
    );
  }

  /** Run the failed jobs of a run again, and the jobs that need them, as a new attempt. */
  async rerunFailedJobs(
    installation: number,
    repo: string,
    id: number,
  ): Promise<void> {
    const token = await this.token(installation, repo, { actions: "write" });
    const response = await this.call(
      token,
      "POST",
      `/repos/${repo}/actions/runs/${id}/rerun-failed-jobs`,
    );
    if (!response.ok) {
      await this.json(response);
    }
  }

  /** The checks that the rulesets of a branch require, for ten minutes. */
  async requiredChecks(
    installation: number,
    repo: string,
    branch: string,
  ): Promise<string[]> {
    const cacheKey = `${repo}|${branch}`;
    const cached = required.get(cacheKey);
    if (cached !== undefined && cached.until > this.now()) {
      return cached.checks;
    }
    const token = await this.token(installation, repo, { metadata: "read" });
    const rules = await this.json<
      {
        type?: string;
        parameters?: { required_status_checks?: { context?: string }[] };
      }[]
    >(
      await this.call(
        token,
        "GET",
        `/repos/${repo}/rules/branches/${encodeURIComponent(branch)}`,
      ),
    );
    const checks = rules
      .filter((rule) => rule.type === "required_status_checks")
      .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
      .flatMap((check) => (check.context === undefined ? [] : [check.context]));
    required.set(cacheKey, { checks, until: this.now() + 10 * 60 * 1000 });
    return checks;
  }

  /** Send an event to the workflows of a repository, such as the control repository. */
  async dispatch(
    installation: number,
    repo: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const token = await this.token(installation, repo, { contents: "write" });
    const response = await this.call(
      token,
      "POST",
      `/repos/${repo}/dispatches`,
      {
        event_type: eventType,
        client_payload: payload,
      },
    );
    if (!response.ok) {
      await this.json(response);
    }
  }

  private user(): string {
    if (this.userToken === null) {
      throw new NoUserToken();
    }
    return this.userToken;
  }

  /** Post a comment in the maintainer's name. Returns its address. */
  async comment(repo: string, number: number, body: string): Promise<string> {
    const answer = await this.json<{ html_url: string }>(
      await this.call(
        this.user(),
        "POST",
        `/repos/${repo}/issues/${number}/comments`,
        { body },
      ),
    );
    return answer.html_url;
  }

  /**
   * Reply in a discussion, as the app: in the thread of the comment that it answers,
   * which for a reply is the thread of its parent, since GitHub nests one level
   * only, or as a comment of its own on the discussion itself.
   */
  async reply(
    installation: number,
    repo: string,
    discussion: Discussion,
    body: string,
  ): Promise<void> {
    const token = await this.token(installation, repo, {
      discussions: "write",
    });
    let replyTo: string | null = null;
    if (discussion.comment !== undefined) {
      // A comment that is gone resolves to no node, with an error NOT_FOUND:
      // the approved reply then goes on the discussion itself.
      const found = await this.graphql<{
        node: { replyTo: { id: string } | null } | null;
      }>(token, THREAD, { comment: discussion.comment }, "NOT_FOUND");
      replyTo =
        found.node === null
          ? null
          : (found.node.replyTo?.id ?? discussion.comment);
    }
    await this.graphql(token, REPLY, {
      discussion: discussion.node,
      replyTo,
      body,
    });
  }

  /**
   * Start the issue assistant on an issue past its rule of one comment, in the
   * maintainer's name: the workflow asks GitHub for the role of the person who
   * started it, and an app has none.
   */
  async issueAssistant(repo: string, issue: number): Promise<void> {
    const response = await this.call(
      this.user(),
      "POST",
      `/repos/${repo}/actions/workflows/issue-assistant.yml/dispatches`,
      {
        ref: "main",
        inputs: {
          issue: String(issue),
          mode: "triage",
          override: "true",
          dry_run: "false",
        },
      },
    );
    if (!response.ok) {
      await this.json(response);
    }
  }
}
