/**
 * The host-specific part of working with a repository (ADR 0005). Plain git (fetch, push) is done
 * by the bus for every host; a provider only speaks the host's REST API: pull requests and
 * reviewers. Only the bus uses providers, with the workspace's write credential.
 */

export type ProviderKind = "local" | "github" | "azure-devops";

/** Where a repository lives on its host, parsed from the upstream URL. */
export interface RepoRef {
  provider: Exclude<ProviderKind, "local">;
  /** Base URL of the REST API, e.g. https://api.github.com or https://dev.azure.com/acme. */
  apiBase: string;
  /** GitHub: owner. Azure DevOps: organization. */
  owner: string;
  /** Azure DevOps only: project. */
  project?: string;
  repo: string;
}

export interface Reviewer {
  /** Provider id passed back to createPullRequest (GitHub: login; Azure DevOps: identity id). */
  id: string;
  displayName: string;
  /** Login or e-mail shown next to the name. */
  uniqueName: string;
}

export interface NewPullRequest {
  /** Branch already pushed to the host, without refs/heads/. */
  source: string;
  target: string;
  title: string;
  description: string;
  reviewerIds: string[];
}

export interface PullRequestRef {
  id: string;
  url: string;
  /** Non-fatal problems, e.g. reviewers that could not be added to a pull request that was created. */
  warnings?: string[];
}

export type PullRequestStatus = "open" | "merged" | "closed";

export interface MergeResult {
  /** The commit now at the head of the target branch. */
  mergeCommit: string;
}

export interface RepoProvider {
  readonly ref: RepoRef;
  /** People who can review, matching a name, login or e-mail. */
  searchReviewers(query: string): Promise<Reviewer[]>;
  createPullRequest(pr: NewPullRequest): Promise<PullRequestRef>;
  pullRequestStatus(id: string): Promise<PullRequestStatus>;
  /** Replaces the title and description of an open pull request. */
  updatePullRequest(id: string, pr: { title: string; description: string }): Promise<void>;
  /**
   * Merges an open pull request on the host, only if its source branch is still at `headCommit`
   * (so nothing unseen gets merged), keeping the branch's commits as they are (rebase or fast
   * forward), then deletes the source branch. Throws ProviderError when the host refuses: conflicts,
   * branch policies, a moved branch.
   */
  mergePullRequest(id: string, opts: { headCommit: string; message: string }): Promise<MergeResult>;
  /** Closes (GitHub) or abandons (Azure DevOps) a pull request without merging. */
  closePullRequest(id: string): Promise<void>;
}

/** Raised for host API errors, with a message safe to show (never the token). */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
