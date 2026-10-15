import {
  ProviderError,
  type FetchLike,
  type NewPullRequest,
  type ProviderKind,
  type PullRequestRef,
  type PullRequestStatus,
  type RepoProvider,
  type RepoRef,
  type Reviewer,
} from "./types.js";

const MAX_REVIEWERS = 20;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAzureHost(host: string): boolean {
  return host === "dev.azure.com" || host.endsWith(".visualstudio.com");
}

export function detectProvider(upstreamUrl: string): ProviderKind {
  const url = upstreamUrl.trim();
  if (/^git@github\.com:/i.test(url)) return "github";
  if (!/^https?:\/\//i.test(url)) return "local";
  const host = hostOf(url);
  if (host === "github.com" || host === "www.github.com") return "github";
  if (host && isAzureHost(host)) return "azure-devops";
  return "local";
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRepoUrl(upstreamUrl: string): RepoRef {
  const url = upstreamUrl.trim();
  const kind = detectProvider(url);
  if (kind === "local") {
    throw new ProviderError("only GitHub and Azure DevOps repositories are supported for pull requests");
  }
  const bad = () => new ProviderError(`cannot parse the ${kind === "github" ? "GitHub" : "Azure DevOps"} repository URL`);

  if (kind === "github") {
    const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
    if (ssh) return { provider: "github", apiBase: "https://api.github.com", owner: ssh[1]!, repo: ssh[2]! };
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    if (segments.length !== 2) throw bad();
    return {
      provider: "github",
      apiBase: "https://api.github.com",
      owner: decode(segments[0]!),
      repo: decode(segments[1]!).replace(/\.git$/i, ""),
    };
  }

  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean).map(decode);
  let org: string;
  let apiBase: string;
  if (host === "dev.azure.com") {
    org = segments.shift() ?? "";
    apiBase = `https://dev.azure.com/${org}`;
  } else {
    org = host.slice(0, -".visualstudio.com".length);
    apiBase = `https://${host}`;
    if (segments[0]?.toLowerCase() === "defaultcollection") segments.shift();
  }
  // Expected: {project}/_git/{repo}, or the short form _git/{repo} that Azure DevOps shows when the
  // project and the repository share a name.
  if (segments.length === 2 && segments[0] === "_git") segments.unshift(segments[1]!.replace(/\.git$/i, ""));
  if (!org || segments.length !== 3 || segments[1] !== "_git") throw bad();
  return { provider: "azure-devops", apiBase, owner: org, project: segments[0]!, repo: segments[2]!.replace(/\.git$/i, "") };
}

export function stripCredentials(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@\s]*@/i, "$1");
}

export function gitAuthHeader(provider: "github" | "azure-devops", token: string): string {
  const raw = provider === "github" ? `x-access-token:${token}` : `:${token}`;
  return `Authorization: Basic ${Buffer.from(raw).toString("base64")}`;
}

export function createProvider(
  ref: RepoRef,
  token: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): RepoProvider {
  return ref.provider === "github" ? new GitHubProvider(ref, token, fetchImpl) : new AzureDevOpsProvider(ref, token, fetchImpl);
}

const SCOPE_HINT =
  "check the token and its scopes (GitHub: Pull requests read/write and Contents read/write; Azure DevOps: Code (Read & Write) and Identity (Read))";

/** Sends a request and returns the parsed JSON body; every failure becomes a token-free ProviderError. */
async function call(
  fetchImpl: FetchLike,
  token: string,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const host = hostOf(url) ?? "the host";
  const scrub = (text: string) => (token ? text.split(token).join("***") : text);
  let res;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new ProviderError(scrub(`cannot reach ${host}: ${err instanceof Error ? err.message : String(err)}`));
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`${host} refused the credential (HTTP ${res.status}): ${SCOPE_HINT}`, res.status);
  }
  if (res.status === 404) throw new ProviderError(`repository or pull request not found on ${host}`, 404);
  if (!res.ok) {
    throw new ProviderError(`${host} API error HTTP ${res.status}: ${scrub(text.slice(0, 200))}`, res.status);
  }
  try {
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    // Azure DevOps answers a bad token with an HTML sign-in page and a 2xx status.
    throw new ProviderError(`${host} refused the credential (HTTP ${res.status}, non-JSON response): ${SCOPE_HINT}`, 401);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

class GitHubProvider implements RepoProvider {
  constructor(
    readonly ref: RepoRef,
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  private request(path: string, method?: string, body?: unknown): Promise<unknown> {
    return call(this.fetchImpl, this.token, `${this.ref.apiBase}/repos/${encodeURIComponent(this.ref.owner)}/${encodeURIComponent(this.ref.repo)}${path}`, {
      method,
      body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "forgehall",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
    });
  }

  async searchReviewers(query: string): Promise<Reviewer[]> {
    const data = await this.request("/collaborators?per_page=100");
    const q = query.trim().toLowerCase();
    const out: Reviewer[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      const u = asRecord(item);
      const login = typeof u.login === "string" ? u.login : "";
      const name = typeof u.name === "string" && u.name ? u.name : null;
      if (!login) continue;
      if (q && !login.toLowerCase().includes(q) && !(name ?? "").toLowerCase().includes(q)) continue;
      out.push({ id: login, displayName: name ?? login, uniqueName: login });
      if (out.length >= MAX_REVIEWERS) break;
    }
    return out;
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    const data = asRecord(await this.request("/pulls", "POST", { title: pr.title, head: pr.source, base: pr.target, body: pr.description }));
    const id = String(data.number);
    const ref: PullRequestRef = { id, url: String(data.html_url) };
    if (pr.reviewerIds.length > 0) {
      try {
        await this.request(`/pulls/${id}/requested_reviewers`, "POST", { reviewers: pr.reviewerIds });
      } catch (err) {
        ref.warnings = [`pull request created, but reviewers could not be requested: ${err instanceof Error ? err.message : String(err)}`];
      }
    }
    return ref;
  }

  async pullRequestStatus(id: string): Promise<PullRequestStatus> {
    const data = asRecord(await this.request(`/pulls/${encodeURIComponent(id)}`));
    if (data.merged_at || data.merged === true) return "merged";
    return data.state === "closed" ? "closed" : "open";
  }
}

class AzureDevOpsProvider implements RepoProvider {
  constructor(
    readonly ref: RepoRef,
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  private get project(): string {
    return this.ref.project ?? "";
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  private get repoApi(): string {
    return `${this.ref.apiBase}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.ref.repo)}`;
  }

  /** The identities API lives on the vssps host. */
  private get identityBase(): string {
    const host = hostOf(this.ref.apiBase) ?? "";
    return host === "dev.azure.com"
      ? `https://vssps.dev.azure.com/${encodeURIComponent(this.ref.owner)}`
      : `https://${host.replace(/\.visualstudio\.com$/, "")}.vssps.visualstudio.com`;
  }

  /**
   * Reviewers are the members of the project's teams, matched on part of the name or login, ignoring
   * case and accents ("joao" finds "João"). The identities API only matches a full name or e-mail,
   * so it is the fallback for people outside the teams.
   */
  async searchReviewers(query: string): Promise<Reviewer[]> {
    const teams = asRecord(await call(this.fetchImpl, this.token, `${this.ref.apiBase}/_apis/projects/${encodeURIComponent(this.ref.project ?? "")}/teams?api-version=7.1`, { headers: this.headers }));
    const people = new Map<string, Reviewer>();
    for (const t of Array.isArray(teams.value) ? teams.value : []) {
      const teamId = asRecord(t).id;
      if (typeof teamId !== "string") continue;
      const members = asRecord(await call(this.fetchImpl, this.token,
        `${this.ref.apiBase}/_apis/projects/${encodeURIComponent(this.ref.project ?? "")}/teams/${encodeURIComponent(teamId)}/members?api-version=7.1`, { headers: this.headers }));
      for (const m of Array.isArray(members.value) ? members.value : []) {
        const i = asRecord(asRecord(m).identity);
        if (typeof i.id !== "string" || !i.id || people.has(i.id)) continue;
        const uniqueName = typeof i.uniqueName === "string" ? i.uniqueName : "";
        people.set(i.id, { id: i.id, displayName: typeof i.displayName === "string" && i.displayName ? i.displayName : uniqueName, uniqueName });
      }
    }
    const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const q = fold(query.trim());
    const matches = [...people.values()].filter((r) => fold(r.displayName).includes(q) || fold(r.uniqueName).includes(q));
    if (matches.length > 0) return matches.slice(0, MAX_REVIEWERS);
    return this.searchIdentities(query);
  }

  private async searchIdentities(query: string): Promise<Reviewer[]> {
    const url = `${this.identityBase}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(query)}&queryMembership=None&api-version=7.1`;
    const data = asRecord(await call(this.fetchImpl, this.token, url, { headers: this.headers }));
    const out: Reviewer[] = [];
    for (const item of Array.isArray(data.value) ? data.value : []) {
      const i = asRecord(item);
      if (typeof i.id !== "string" || !i.id) continue;
      const props = asRecord(i.properties);
      const prop = (key: string) => {
        const v = asRecord(props[key]).$value;
        return typeof v === "string" ? v : "";
      };
      const uniqueName = prop("Mail") || prop("Account");
      const displayName = typeof i.providerDisplayName === "string" && i.providerDisplayName ? i.providerDisplayName : uniqueName;
      out.push({ id: i.id, displayName, uniqueName });
      if (out.length >= MAX_REVIEWERS) break;
    }
    return out;
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    const data = asRecord(
      await call(this.fetchImpl, this.token, `${this.repoApi}/pullrequests?api-version=7.1`, {
        method: "POST",
        headers: this.headers,
        body: {
          sourceRefName: `refs/heads/${pr.source}`,
          targetRefName: `refs/heads/${pr.target}`,
          title: pr.title,
          description: pr.description,
          reviewers: pr.reviewerIds.map((id) => ({ id })),
        },
      }),
    );
    const id = String(data.pullRequestId);
    return { id, url: `${this.ref.apiBase}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(this.ref.repo)}/pullrequest/${id}` };
  }

  async pullRequestStatus(id: string): Promise<PullRequestStatus> {
    const data = asRecord(await call(this.fetchImpl, this.token, `${this.repoApi}/pullrequests/${encodeURIComponent(id)}?api-version=7.1`, { headers: this.headers }));
    if (data.status === "completed") return "merged";
    return data.status === "abandoned" ? "closed" : "open";
  }
}
