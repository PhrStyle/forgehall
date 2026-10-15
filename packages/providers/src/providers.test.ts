import { describe, expect, it } from "vitest";
import { ProviderError, createProvider, detectProvider, gitAuthHeader, parseRepoUrl, stripCredentials, type FetchLike, type RepoRef } from "./index.js";

const TOKEN = "s3cr3t-token-value";

type Call = { url: string; method?: string; headers?: Record<string, string>; body?: string };

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses.shift() ?? { status: 500, body: "no response queued" };
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(text), text: async () => text };
  };
  return { calls, fetchImpl };
}

const ghRef: RepoRef = { provider: "github", apiBase: "https://api.github.com", owner: "acme", repo: "checkout-app" };
const azRef: RepoRef = { provider: "azure-devops", apiBase: "https://dev.azure.com/acme", owner: "acme", project: "Shop Floor", repo: "checkout-app" };
const vsRef: RepoRef = { provider: "azure-devops", apiBase: "https://acme.visualstudio.com", owner: "acme", project: "Shop", repo: "checkout-app" };

describe("detectProvider / parseRepoUrl", () => {
  it("detects hosts", () => {
    expect(detectProvider("https://github.com/acme/checkout-app")).toBe("github");
    expect(detectProvider("git@github.com:acme/checkout-app.git")).toBe("github");
    expect(detectProvider("https://dev.azure.com/acme/Shop/_git/checkout")).toBe("azure-devops");
    expect(detectProvider("https://acme.visualstudio.com/Shop/_git/checkout")).toBe("azure-devops");
    expect(detectProvider("/srv/git/checkout.git")).toBe("local");
    expect(detectProvider("file:///srv/git/checkout.git")).toBe("local");
    expect(detectProvider("https://gitlab.com/acme/checkout")).toBe("local");
  });

  it("parses GitHub URLs", () => {
    for (const u of ["https://github.com/acme/checkout-app", "https://github.com/acme/checkout-app.git", "https://github.com/acme/checkout-app/", "git@github.com:acme/checkout-app.git"]) {
      expect(parseRepoUrl(u)).toEqual(ghRef);
    }
  });

  it("parses Azure DevOps URLs", () => {
    const expected = { provider: "azure-devops", apiBase: "https://dev.azure.com/acme", owner: "acme", project: "Shop", repo: "checkout" };
    expect(parseRepoUrl("https://dev.azure.com/acme/Shop/_git/checkout")).toEqual(expected);
    expect(parseRepoUrl("https://acme@dev.azure.com/acme/Shop/_git/checkout")).toEqual(expected);
    expect(parseRepoUrl("https://dev.azure.com/acme/Shop%20Floor/_git/check%20out").project).toBe("Shop Floor");
    expect(parseRepoUrl("https://dev.azure.com/acme/Shop%20Floor/_git/check%20out").repo).toBe("check out");
  });

  it("parses the short Azure DevOps form where the project is named like the repository", () => {
    expect(parseRepoUrl("https://dev.azure.com/acme/_git/checkout")).toEqual({
      provider: "azure-devops", apiBase: "https://dev.azure.com/acme", owner: "acme", project: "checkout", repo: "checkout",
    });
  });

  it("parses visualstudio.com URLs", () => {
    const expected = { provider: "azure-devops", apiBase: "https://acme.visualstudio.com", owner: "acme", project: "Shop", repo: "checkout" };
    expect(parseRepoUrl("https://acme.visualstudio.com/Shop/_git/checkout")).toEqual(expected);
    expect(parseRepoUrl("https://acme.visualstudio.com/DefaultCollection/Shop/_git/checkout")).toEqual(expected);
  });

  it("rejects local and malformed URLs", () => {
    expect(() => parseRepoUrl("/srv/git/checkout.git")).toThrow(ProviderError);
    expect(() => parseRepoUrl("file:///srv/git/x")).toThrow(ProviderError);
    expect(() => parseRepoUrl("https://github.com/acme")).toThrow(ProviderError);
    expect(() => parseRepoUrl("https://dev.azure.com/acme/Shop")).toThrow(ProviderError);
  });
});

describe("credentials helpers", () => {
  it("strips credentials", () => {
    expect(stripCredentials("https://user:pw@github.com/a/b.git")).toBe("https://github.com/a/b.git");
    expect(stripCredentials("https://acme@dev.azure.com/acme/S/_git/r")).toBe("https://dev.azure.com/acme/S/_git/r");
    expect(stripCredentials("https://github.com/a/b")).toBe("https://github.com/a/b");
  });

  it("builds git auth headers", () => {
    expect(gitAuthHeader("github", "tok")).toBe(`Authorization: Basic ${Buffer.from("x-access-token:tok").toString("base64")}`);
    expect(gitAuthHeader("azure-devops", "tok")).toBe(`Authorization: Basic ${Buffer.from(":tok").toString("base64")}`);
  });
});

describe("GitHub provider", () => {
  const pr = { source: "fh/t1", target: "main", title: "T", description: "D", reviewerIds: [] as string[] };

  it("creates a pull request without reviewers", async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 201, body: { number: 7, html_url: "https://github.com/acme/checkout-app/pull/7" } }]);
    const res = await createProvider(ghRef, TOKEN, fetchImpl).createPullRequest(pr);
    expect(res).toEqual({ id: "7", url: "https://github.com/acme/checkout-app/pull/7" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/checkout-app/pulls");
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ title: "T", head: "fh/t1", base: "main", body: "D" });
    expect(calls[0]!.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "forgehall" });
  });

  it("requests reviewers, and reports a failure as a warning", async () => {
    const ok = fakeFetch([{ status: 201, body: { number: 7, html_url: "u" } }, { status: 201, body: {} }]);
    const res = await createProvider(ghRef, TOKEN, ok.fetchImpl).createPullRequest({ ...pr, reviewerIds: ["ana"] });
    expect(res.warnings).toBeUndefined();
    expect(ok.calls[1]!.url).toBe("https://api.github.com/repos/acme/checkout-app/pulls/7/requested_reviewers");
    expect(JSON.parse(ok.calls[1]!.body!)).toEqual({ reviewers: ["ana"] });

    const bad = fakeFetch([{ status: 201, body: { number: 8, html_url: "u8" } }, { status: 422, body: { message: "not a collaborator" } }]);
    const res2 = await createProvider(ghRef, TOKEN, bad.fetchImpl).createPullRequest({ ...pr, reviewerIds: ["zed"] });
    expect(res2.id).toBe("8");
    expect(res2.warnings?.[0]).toContain("422");
  });

  it("maps status", async () => {
    for (const [body, want] of [
      [{ state: "closed", merged_at: "2026-01-01" }, "merged"],
      [{ state: "closed", merged_at: null }, "closed"],
      [{ state: "open" }, "open"],
    ] as const) {
      const { calls, fetchImpl } = fakeFetch([{ status: 200, body }]);
      expect(await createProvider(ghRef, TOKEN, fetchImpl).pullRequestStatus("7")).toBe(want);
      expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/checkout-app/pulls/7");
    }
  });

  it("filters reviewers", async () => {
    const people = [{ login: "ana-dev", name: "Ana Souza" }, { login: "bob", name: null }, { login: "carol", name: "Carolina Ana" }];
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: people }]);
    const found = await createProvider(ghRef, TOKEN, fetchImpl).searchReviewers("ANA");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/checkout-app/collaborators?per_page=100");
    expect(found).toEqual([
      { id: "ana-dev", displayName: "Ana Souza", uniqueName: "ana-dev" },
      { id: "carol", displayName: "Carolina Ana", uniqueName: "carol" },
    ]);
  });

  it("caps reviewers at 20", async () => {
    const people = Array.from({ length: 50 }, (_, i) => ({ login: `u${i}` }));
    const { fetchImpl } = fakeFetch([{ status: 200, body: people }]);
    expect(await createProvider(ghRef, TOKEN, fetchImpl).searchReviewers("")).toHaveLength(20);
  });
});

describe("Azure DevOps provider", () => {
  const pr = { source: "fh/t1", target: "main", title: "T", description: "D", reviewerIds: ["id-1"] };

  it("creates a pull request", async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 201, body: { pullRequestId: 42 } }]);
    const res = await createProvider(azRef, TOKEN, fetchImpl).createPullRequest(pr);
    expect(res).toEqual({ id: "42", url: "https://dev.azure.com/acme/Shop%20Floor/_git/checkout-app/pullrequest/42" });
    expect(calls[0]!.url).toBe("https://dev.azure.com/acme/Shop%20Floor/_apis/git/repositories/checkout-app/pullrequests?api-version=7.1");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      sourceRefName: "refs/heads/fh/t1",
      targetRefName: "refs/heads/main",
      title: "T",
      description: "D",
      reviewers: [{ id: "id-1" }],
    });
    expect(calls[0]!.headers).toMatchObject({ Authorization: `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`, "Content-Type": "application/json" });
  });

  it("maps status", async () => {
    for (const [status, want] of [["completed", "merged"], ["abandoned", "closed"], ["active", "open"]] as const) {
      const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { status } }]);
      expect(await createProvider(azRef, TOKEN, fetchImpl).pullRequestStatus("42")).toBe(want);
      expect(calls[0]!.url).toBe("https://dev.azure.com/acme/Shop%20Floor/_apis/git/repositories/checkout-app/pullrequests/42?api-version=7.1");
    }
  });

  it("searches identities on the vssps host", async () => {
    const body = {
      value: [
        { id: "a", providerDisplayName: "Ana", properties: { Mail: { $value: "ana@acme.test" }, Account: { $value: "ana@acme" } } },
        { id: "b", providerDisplayName: "Bob", properties: { Account: { $value: "bob@acme" } } },
        { providerDisplayName: "No id" },
      ],
    };
    const dev = fakeFetch([{ status: 200, body }]);
    const found = await createProvider(azRef, TOKEN, dev.fetchImpl).searchReviewers("an a");
    expect(dev.calls[0]!.url).toBe("https://vssps.dev.azure.com/acme/_apis/identities?searchFilter=General&filterValue=an%20a&queryMembership=None&api-version=7.1");
    expect(found).toEqual([
      { id: "a", displayName: "Ana", uniqueName: "ana@acme.test" },
      { id: "b", displayName: "Bob", uniqueName: "bob@acme" },
    ]);

    const vs = fakeFetch([{ status: 200, body: { value: [] } }]);
    await createProvider(vsRef, TOKEN, vs.fetchImpl).searchReviewers("x");
    expect(vs.calls[0]!.url).toBe("https://acme.vssps.visualstudio.com/_apis/identities?searchFilter=General&filterValue=x&queryMembership=None&api-version=7.1");
  });
});

describe("errors", () => {
  async function failure(ref: RepoRef, status: number, body: unknown): Promise<ProviderError> {
    const { fetchImpl } = fakeFetch([{ status, body }]);
    try {
      await createProvider(ref, TOKEN, fetchImpl).pullRequestStatus("1");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      return err as ProviderError;
    }
    throw new Error("expected a ProviderError");
  }

  it("maps 401/403 to a credential error", async () => {
    const e = await failure(ghRef, 401, { message: "Bad credentials" });
    expect(e.message).toContain("api.github.com refused the credential (HTTP 401)");
    expect(e.message).toContain("scopes");
    expect((await failure(azRef, 403, "x")).message).toContain("HTTP 403");
  });

  it("maps 404 and other statuses", async () => {
    expect((await failure(ghRef, 404, {})).message).toBe("repository or pull request not found on api.github.com");
    const e = await failure(ghRef, 500, "boom ".repeat(100));
    expect(e.message).toContain("api.github.com API error HTTP 500: boom");
    expect(e.message.length).toBeLessThan(300);
  });

  it("treats a non-JSON 2xx as an auth error", async () => {
    const e = await failure(azRef, 203, "<html>Sign in</html>");
    expect(e.status).toBe(401);
    expect(e.message).toContain("refused the credential");
  });

  it("never leaks the token", async () => {
    const messages = [
      (await failure(ghRef, 401, `echo ${TOKEN}`)).message,
      (await failure(ghRef, 500, `echo ${TOKEN}`)).message,
      (await failure(azRef, 203, `<html>${TOKEN}</html>`)).message,
    ];
    const net: FetchLike = async () => {
      throw new Error(`connect failed for ${TOKEN}`);
    };
    messages.push(await createProvider(ghRef, TOKEN, net).pullRequestStatus("1").catch((e: Error) => e.message));
    for (const m of messages) {
      expect(m).not.toContain(TOKEN);
      expect(m).not.toContain(Buffer.from(`:${TOKEN}`).toString("base64"));
    }
  });
});
