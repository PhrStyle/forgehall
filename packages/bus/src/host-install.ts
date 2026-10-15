import { execFile } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** This CLI's entry point, so installed commands and services run the same build. */
const cliPath = () => fileURLToPath(new URL("./cli.js", import.meta.url));

/** Installs `fh` as a small wrapper in ~/.local/bin. Returns its path and whether that directory is on PATH. */
export async function installFhCommand(): Promise<{ path: string; onPath: boolean }> {
  const dir = join(homedir(), ".local", "bin");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "fh");
  await writeFile(path, `#!/bin/sh\n# Installed by fh setup: the Forgehall CLI from this checkout.\nexec "${process.execPath}" "${cliPath()}" "$@"\n`);
  await chmod(path, 0o755);
  return { path, onPath: (process.env.PATH ?? "").split(":").includes(dir) };
}

const UNIT = "forgehall-supervisor.service";
const unitPath = () => join(homedir(), ".config", "systemd", "user", UNIT);

/** Variables the supervisor needs to reach Docker and Postgres the way this shell does. */
const PASS_ENV = ["PATH", "DOCKER_HOST", "DOCKER_CONTEXT", "DATABASE_URL", "FORGEHALL_HOME", "FORGEHALL_BILLING", "FORGEHALL_RUNNER_IMAGE"];

/**
 * Installs the supervisor as a systemd user service: it starts with your session, restarts if it
 * stops, and brings agents back after a reboot. Linux with systemd only.
 */
export async function installSupervisorService(): Promise<string> {
  const env = PASS_ENV.filter((k) => process.env[k]).map((k) => `Environment=${k}=${process.env[k]}`).join("\n");
  const unit = `# Installed by fh supervise --install
[Unit]
Description=Forgehall supervisor (starts and stops agent containers)
After=default.target docker.service

[Service]
ExecStart="${process.execPath}" "${cliPath()}" supervise
Restart=always
RestartSec=5
${env}

[Install]
WantedBy=default.target
`;
  await mkdir(join(homedir(), ".config", "systemd", "user"), { recursive: true });
  await writeFile(unitPath(), unit);
  await exec("systemctl", ["--user", "daemon-reload"]);
  await exec("systemctl", ["--user", "enable", "--now", UNIT]);
  return unitPath();
}

export async function uninstallSupervisorService(): Promise<void> {
  await exec("systemctl", ["--user", "disable", "--now", UNIT]).catch(() => {});
  await rm(unitPath(), { force: true });
  await exec("systemctl", ["--user", "daemon-reload"]).catch(() => {});
}
