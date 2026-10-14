import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { stagingPath, stagingRoot } from "./git.js";
import type { AgentRow, Store } from "./store.js";

/**
 * Git smart HTTP for staging remotes, via `git http-backend`. Agents authenticate with HTTP basic
 * auth (any user name, agent token as password) and only reach repos of their own workspace.
 * The pre-receive hook installed in each staging repo limits pushes to thread branches.
 */
export async function registerGitHttp(app: FastifyInstance, store: Store): Promise<void> {
  await app.register(async (scope) => {
    // Hand git's request bodies (pack data, possibly gzip) to the backend untouched.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

    const agentOf = async (req: FastifyRequest): Promise<AgentRow | null> => {
      const h = req.headers.authorization;
      if (!h?.startsWith("Basic ")) return null;
      const decoded = Buffer.from(h.slice(6), "base64").toString();
      const token = decoded.slice(decoded.indexOf(":") + 1);
      return token ? store.agentByToken(token) : null;
    };

    scope.all<{ Params: { ws: string; repo: string; "*": string } }>("/git/:ws/:repo/*", async (req, reply) => {
      const agent = await agentOf(req);
      if (!agent) return reply.code(401).header("www-authenticate", 'Basic realm="forgehall"').send();
      const { ws, repo } = req.params;
      const repoId = repo.replace(/\.git$/, "");
      if (agent.workspace_id !== ws) return reply.code(403).send({ error: "repository belongs to another workspace" });
      try {
        await access(stagingPath(ws, repoId));
      } catch {
        return reply.code(404).send({ error: `no staging remote for ${ws}/${repoId}` });
      }

      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
      const child = spawn("git", ["http-backend"], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: stagingRoot(ws),
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: `/${repoId}.git/${req.params["*"]}`,
          REMOTE_USER: agent.id,
          REMOTE_ADDR: req.ip,
          REQUEST_METHOD: req.method,
          QUERY_STRING: query,
          CONTENT_TYPE: req.headers["content-type"] ?? "",
          HTTP_CONTENT_ENCODING: (req.headers["content-encoding"] as string | undefined) ?? "",
          GIT_PROTOCOL: (req.headers["git-protocol"] as string | undefined) ?? "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const body = req.body as NodeJS.ReadableStream | undefined;
      if (body && typeof body.pipe === "function") body.pipe(child.stdin);
      else child.stdin.end();
      child.stderr.on("data", (d: Buffer) => req.log.warn({ git: d.toString().trim() }, "git http-backend"));

      reply.hijack();
      const res = reply.raw;
      // CGI response: headers, blank line, body.
      let head = Buffer.alloc(0);
      let headersDone = false;
      child.stdout.on("data", (chunk: Buffer) => {
        if (headersDone) return void res.write(chunk);
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        headersDone = true;
        let status = 200;
        for (const line of head.subarray(0, end).toString().split("\r\n")) {
          const i = line.indexOf(":");
          const k = line.slice(0, i).trim();
          const v = line.slice(i + 1).trim();
          if (k.toLowerCase() === "status") status = Number(v.split(" ")[0]);
          else res.setHeader(k, v);
        }
        res.writeHead(status);
        res.write(head.subarray(end + 4));
      });
      child.on("close", () => {
        if (!headersDone) res.writeHead(500);
        res.end();
      });
    });
  });
}
