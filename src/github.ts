/**
 * The REST API of GitHub, and its GraphQL API for the reply in a discussion, as the
 * GitHub App of the pager and, for the two things that act in the maintainer's
 * name, with their own token. Each token of the app is made for one repository and
 * only the permissions of its call, and lives in memory for less than its hour.
 */
import { base64, base64url, utf8 } from "./crypto.ts";
import type { Payload } from "./rules.ts";
import type { Discussion } from "./store.ts";
import type { Fetch } from "./telegram.ts";

const API = "https://api.github.com";
const AGENT = "repo-pager";

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

/** GitHub refuses GITHUB_USER_TOKEN with a 401: it expired, or it was revoked. */
export class UserTokenRefused extends GitHubError {
  constructor(detail: string) {
    super(401, detail);
  }
}

/** What GitHub says of a call that it refused: its message, or the start of its text. */
async function detailOf(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (
      (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 200)
    );
  } catch {
    // Not JSON: the start of the text says enough.
    return text.slice(0, 200);
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

/**
 * The JWT of the app, by its id, while it has two minutes left: one signature of
 * RSA serves every call of a run of the schedule, which keeps its time of CPU low.
 */
const jwts = new Map<string, { jwt: string; until: number }>();
/** The tokens of installations, by installation, repository and permissions. */
const tokens = new Map<string, { token: string; until: number }>();
/** The required checks of a branch, by repository and branch, for ten minutes. */
const required = new Map<string, { checks: string[]; until: number }>();

/** Forget every token and every cached answer, as a new isolate would. */
export function forget(): void {
  jwts.clear();
  tokens.clear();
  required.clear();
}

export interface PullRequest {
  number: number;
  state?: string;
  title?: string;
  /** The description, which holds the notes of a release pull request. */
  body?: string | null;
  draft?: boolean;
  mergeable_state?: string;
  html_url?: string;
  user?: { login?: string; type?: string };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  base?: {
    ref?: string;
    repo?: { full_name?: string; default_branch?: string };
  };
}

/**
 * One attempt to deliver an event of the app's webhook, as GitHub lists them: each
 * attempt has an id of its own, and all attempts of an event share its guid.
 */
export interface Delivery {
  id: number;
  guid: string;
  delivered_at: string;
  /** Whether it was asked for again, on the app's Advanced page or by the pager. */
  redelivery: boolean;
  /** The status of the pager's answer, or 0 when none came in time. */
  status_code: number;
  event: string;
  action: string | null;
  /** The repository of the event, or null for one of none, such as of the app itself. */
  repository_id: number | null;
}

/** A page of the deliveries, newest first, and the cursor of the next page, if any. */
export interface Deliveries {
  deliveries: Delivery[];
  cursor: string | null;
}

/** The cursor of the next page of the deliveries, from the Link header of GitHub. */
export function nextCursor(link: string | null): string | null {
  for (const part of (link ?? "").split(",")) {
    const match = /<([^>]*)>\s*;\s*rel="next"/.exec(part);
    if (match !== null) {
      return new URL(String(match[1]), API).searchParams.get("cursor");
    }
  }
  return null;
}

/** An artifact of a run of GitHub Actions: its id, its name and its size in bytes. */
export interface Artifact {
  id: number;
  name: string;
  size: number;
}

/**
 * The body of an answer, read up to max bytes: one that would be larger stops
 * at once, so that no answer takes more of the memory of the Worker.
 */
async function readCapped(
  response: Response,
  max: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new GitHubError(413, `the artifact is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * A run of GitHub Actions as its newest attempt stands: what 🔁 Rerun and the
 * schedule read, and the fields of a run that the rules read in an event.
 */
export type WorkflowRun = NonNullable<Payload["workflow_run"]> & {
  status?: string;
};

/** A job of an attempt of a run, as its run lists it. */
export interface RunJob {
  name: string;
  /** The address of its log. */
  url: string;
  conclusion: string;
}

export type Permissions = Record<string, "read" | "write">;

/**
 * The branch of the control repository that keeps the answers to the questions of
 * the maintainer's agents, as answers/<id>.json: it has no parent and no code of
 * the repository, so no workflow runs on it.
 */
export const ANSWERS = "pager-answers";

/** The one file of the branch of the answers when the pager makes it. */
const ANSWERS_README = `# The answers of the pager

Each file \`answers/<id>.json\` is the answer of the maintainer to the question \`<id>\` of one of their agents, saved by the GitHub App of the pager when its button was pressed or the maintainer wrote the answer in its topic. The pager's documentation describes how an agent asks and reads: https://dennis-otto.github.io/repo-pager/how-it-works.html
`;

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
    redirect: RequestInit["redirect"] = "follow",
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      redirect,
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
      throw new GitHubError(response.status, await detailOf(response));
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

  /** The JWT of the app itself, for the calls that act as the app and not as an installation. */
  private async jwt(): Promise<string> {
    const cached = jwts.get(this.appId);
    if (cached !== undefined && cached.until > this.now()) {
      return cached.jwt;
    }
    const jwt = await appJwt(this.appId, this.appKey, this.now());
    // appJwt() makes it for 9 minutes; it serves 7 of them.
    jwts.set(this.appId, { jwt, until: this.now() + 7 * 60 * 1000 });
    return jwt;
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
    const jwt = await this.jwt();
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
    const jwt = await this.jwt();
    const response = await this.call(jwt, "GET", `/repos/${repo}/installation`);
    if (response.status === 404) {
      return null;
    }
    return (await this.json<{ id: number }>(response)).id;
  }

  /**
   * A page of 100 deliveries of the app's webhook, newest first: the first one, or
   * the one that a cursor of the page before names. Only the cursor is taken from
   * GitHub's Link header, so the JWT of the app goes to no other address.
   */
  async deliveries(cursor: string | null): Promise<Deliveries> {
    const query =
      cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await this.call(
      await this.jwt(),
      "GET",
      `/app/hook/deliveries?per_page=100${query}`,
    );
    const link = response.headers.get("link");
    return {
      deliveries: await this.json<Delivery[]>(response),
      cursor: nextCursor(link),
    };
  }

  /** Have GitHub deliver an event again, as Redeliver on the app's Advanced page does. */
  async redeliver(delivery: number): Promise<void> {
    const response = await this.call(
      await this.jwt(),
      "POST",
      `/app/hook/deliveries/${delivery}/attempts`,
    );
    if (!response.ok) {
      await this.json(response);
    }
  }

  /** The page of the app's settings, by its slug, under its owner's settings. */
  async appSettings(): Promise<string> {
    const app = await this.json<{
      slug: string;
      owner?: { login?: string; type?: string } | null;
    }>(await this.call(await this.jwt(), "GET", "/app"));
    const owner = app.owner;
    const settings =
      owner?.type === "Organization"
        ? `https://github.com/organizations/${owner.login}/settings`
        : "https://github.com/settings";
    return `${settings}/apps/${app.slug}`;
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

  /**
   * The jobs of an attempt of a run, the first hundred, each with its name, the
   * address of its log and its conclusion, which is empty while it runs.
   */
  async jobs(
    installation: number,
    repo: string,
    run: number,
    attempt: number,
  ): Promise<RunJob[]> {
    const token = await this.token(installation, repo, { actions: "read" });
    const answer = await this.json<{
      jobs?: { name?: unknown; html_url?: unknown; conclusion?: unknown }[];
    }>(
      await this.call(
        token,
        "GET",
        `/repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,
      ),
    );
    return (answer.jobs ?? []).flatMap(({ name, html_url, conclusion }) =>
      typeof name === "string" && typeof html_url === "string"
        ? [
            {
              name,
              url: html_url,
              conclusion: typeof conclusion === "string" ? conclusion : "",
            },
          ]
        : [],
    );
  }

  /** The artifacts of a run that didn't expire, the first hundred. */
  async artifacts(
    installation: number,
    repo: string,
    run: number,
  ): Promise<Artifact[]> {
    const token = await this.token(installation, repo, { actions: "read" });
    const answer = await this.json<{
      artifacts?: {
        id?: unknown;
        name?: unknown;
        size_in_bytes?: unknown;
        expired?: boolean;
      }[];
    }>(
      await this.call(
        token,
        "GET",
        `/repos/${repo}/actions/runs/${run}/artifacts?per_page=100`,
      ),
    );
    return (answer.artifacts ?? []).flatMap(
      ({ id, name, size_in_bytes, expired }) =>
        Number.isSafeInteger(id) &&
        typeof name === "string" &&
        Number.isSafeInteger(size_in_bytes) &&
        expired !== true
          ? [{ id: id as number, name, size: size_in_bytes as number }]
          : [],
    );
  }

  /**
   * The ZIP of an artifact, of at most max bytes. GitHub answers with the address
   * of its storage, signed for a minute, which the pager follows without its token:
   * the token goes to GitHub alone.
   */
  async artifactZip(
    installation: number,
    repo: string,
    id: number,
    max: number,
  ): Promise<Uint8Array> {
    const token = await this.token(installation, repo, { actions: "read" });
    const answer = await this.call(
      token,
      "GET",
      `/repos/${repo}/actions/artifacts/${id}/zip`,
      undefined,
      "manual",
    );
    const location = answer.headers.get("location") ?? "";
    if (answer.status !== 302 || !location.startsWith("https://")) {
      if (answer.status >= 400) {
        // GitHub's own reason, such as an artifact that expired.
        await this.json(answer);
      }
      throw new GitHubError(answer.status, "no address of the artifact");
    }
    const file = await this.fetch(location, {
      method: "GET",
      headers: { "user-agent": AGENT },
    });
    if (!file.ok) {
      throw new GitHubError(file.status, "the storage of the artifact refused");
    }
    return readCapped(file, max);
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

  /**
   * The file in which secret scanning first found the secret of an alert, or none
   * when it found it in something else, such as the text of an issue. It reads
   * the places of the alert, which name no secret, never the alert itself, whose
   * answer holds the secret.
   */
  async secretPath(
    installation: number,
    repo: string,
    alert: number,
  ): Promise<string | undefined> {
    const token = await this.token(installation, repo, {
      secret_scanning_alerts: "read",
    });
    const places = await this.json<
      { type?: string; details?: { path?: string } }[]
    >(
      await this.call(
        token,
        "GET",
        `/repos/${repo}/secret-scanning/alerts/${alert}/locations?per_page=1`,
      ),
    );
    const first = places[0];
    return first?.type === "commit" || first?.type === "wiki_commit"
      ? first.details?.path
      : undefined;
  }

  /**
   * The state of a security advisory of a repository, such as triage: the one
   * field that the pager reads of it, never its summary or its description.
   */
  async advisoryState(
    installation: number,
    repo: string,
    ghsa: string,
  ): Promise<string | undefined> {
    const token = await this.token(installation, repo, {
      repository_advisories: "read",
    });
    const advisory = await this.json<{ state?: string }>(
      await this.call(
        token,
        "GET",
        `/repos/${repo}/security-advisories/${ghsa}`,
      ),
    );
    return advisory.state;
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

  /**
   * Keep the answer to a question of an agent as answers/<id>.json on the branch of
   * the answers of a repository, the control repository, where the agent reads it
   * with its own gh. The first answer makes the branch; an answer again, such as to
   * a question asked again after its record expired, replaces the file.
   */
  async saveAnswer(
    installation: number,
    repo: string,
    id: string,
    answer: unknown,
  ): Promise<void> {
    const token = await this.token(installation, repo, { contents: "write" });
    const branch = await this.call(
      token,
      "GET",
      `/repos/${repo}/git/ref/heads/${ANSWERS}`,
    );
    if (branch.status === 404) {
      await this.answersBranch(token, repo);
    } else {
      await this.json(branch);
    }
    const path = `/repos/${repo}/contents/answers/${id}.json`;
    const before = await this.call(token, "GET", `${path}?ref=${ANSWERS}`);
    const sha =
      before.status === 404
        ? undefined
        : (await this.json<{ sha: string }>(before)).sha;
    await this.json(
      await this.call(token, "PUT", path, {
        message: `The answer to ${id}`,
        content: base64(`${JSON.stringify(answer, null, 2)}\n`),
        branch: ANSWERS,
        ...(sha === undefined ? {} : { sha }),
      }),
    );
  }

  /** Make the branch of the answers: one commit without a parent, with its README. */
  private async answersBranch(token: string, repo: string): Promise<void> {
    const tree = await this.json<{ sha: string }>(
      await this.call(token, "POST", `/repos/${repo}/git/trees`, {
        tree: [
          {
            path: "README.md",
            mode: "100644",
            type: "blob",
            content: ANSWERS_README,
          },
        ],
      }),
    );
    const commit = await this.json<{ sha: string }>(
      await this.call(token, "POST", `/repos/${repo}/git/commits`, {
        message: "The branch of the answers of the pager",
        tree: tree.sha,
        parents: [],
      }),
    );
    await this.json(
      await this.call(token, "POST", `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${ANSWERS}`,
        sha: commit.sha,
      }),
    );
  }

  /**
   * A call in the maintainer's name, with GITHUB_USER_TOKEN: a 401 says that
   * GitHub refuses the token, because it expired or was revoked.
   */
  private async asUser(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    if (this.userToken === null) {
      throw new NoUserToken();
    }
    const response = await this.call(this.userToken, method, path, body);
    if (response.status === 401) {
      throw new UserTokenRefused(await detailOf(response));
    }
    return response;
  }

  /**
   * When GITHUB_USER_TOKEN expires, as GitHub names it in the header
   * github-authentication-token-expiration of each answer, such as
   * "2026-12-03 10:00:00 UTC", or null for a token without a day. GET /rate_limit
   * counts against no limit of the API.
   */
  async userTokenExpiration(): Promise<string | null> {
    const response = await this.asUser("GET", "/rate_limit");
    await this.json(response);
    return response.headers.get("github-authentication-token-expiration");
  }

  /** Post a comment in the maintainer's name. Returns its address. */
  async comment(repo: string, number: number, body: string): Promise<string> {
    const answer = await this.json<{ html_url: string }>(
      await this.asUser("POST", `/repos/${repo}/issues/${number}/comments`, {
        body,
      }),
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
    const response = await this.asUser(
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
