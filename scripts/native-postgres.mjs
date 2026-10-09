/** Disposable PostgreSQL 17 test cluster. Never accepts an external database URL. */
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function nativeDatabase({ docker = false } = {}) {
  if (docker) return containerDatabase();
  const bin = process.env.PG_BIN || "/usr/lib/postgresql/17/bin";
  const binary = (name) => join(bin, name);
  const directory = await mkdtemp(join(tmpdir(), "catalog-pg-"));
  await chmod(directory, 0o700);
  const data = join(directory, "data");
  // Do not inherit libpq connection settings, credentials, or psql startup files.
  const env = { PATH: process.env.PATH || "/usr/bin:/bin", HOME: directory, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  function run(command, args, input = "") {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.on("error", reject);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command}: ${stderr || stdout}`)));
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  let running = false;
  async function close() {
    try {
      if (running) await run(binary("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    } finally {
      running = false;
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    const version = (await run(binary("postgres"), ["--version"])).trim();
    if (!/\b17(?:\.|\s)/.test(version)) throw new Error(`PostgreSQL 17 is required; found ${version}`);
    await run(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8", "--username=catalog_test_admin"]);
    await run(binary("pg_ctl"), ["-D", data, "-l", join(directory, "server.log"), "-o", `-F -c listen_addresses='' -c unix_socket_permissions=0700 -k ${directory} -p 55432`, "-w", "start"]);
    running = true;
    const args = ["--no-psqlrc", "--no-password", "-h", directory, "-p", "55432", "-U", "catalog_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"];
    const exec = (sql) => run(binary("psql"), args, sql);
    const isolated = await exec("select current_setting('server_version_num')::int between 170000 and 179999 and current_setting('listen_addresses') = '' and current_setting('unix_socket_permissions') = '0700';");
    if (isolated.trim() !== "t") throw new Error("Native PostgreSQL isolation/version verification failed");
    console.log(`Native catalog rehearsal: ${version}; private Unix socket, TCP disabled`);
    return { exec, close };
  } catch (error) {
    await close();
    throw new Error(`Native PostgreSQL 17 rehearsal did not complete: ${error.message}. Use existing PG17 binaries via PG_BIN; no external database or fallback is allowed.`);
  }
}

/** Official PostgreSQL image, with no network, published ports or host mounts. */
async function containerDatabase() {
  const name = `catalog-pg-${randomUUID()}`;
  const env = { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  function run(args, input = "") {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.on("error", reject);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`docker ${args[0]}: ${stderr || stdout}`)));
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  let created = false;
  const close = async () => {
    if (created) { await run(["rm", "--force", "--volumes", name]); created = false; }
  };
  try {
    await run(["pull", "postgres:17"]);
    const digests = JSON.parse(await run(["image", "inspect", "postgres:17", "--format", "{{json .RepoDigests}}"]));
    const digest = digests.find((value) => /^(?:docker\.io\/library\/)?postgres@sha256:[a-f0-9]{64}$/.test(value));
    if (!digest) throw new Error("Official postgres:17 digest was not resolved");
    // Use the resolved digest so a moving tag cannot change this rehearsal.
    await run(["create", "--name", name, "--network", "none",
      "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m",
      "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_USER=catalog_test_admin", "--env", "POSTGRES_DB=postgres",
      digest, "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700"]);
    created = true;
    const isolation = JSON.parse(await run(["inspect", name, "--format", "{{json .HostConfig}}"]));
    if (isolation.NetworkMode !== "none" || Object.keys(isolation.PortBindings || {}).length || (isolation.Binds || []).length) throw new Error("Container isolation verification failed");
    await run(["start", name]);
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      ready = await run(["exec", "--user", "postgres", name, "sh", "-c", 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -h /var/run/postgresql -U catalog_test_admin -d postgres']).then(() => true, () => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Isolated PostgreSQL container did not become ready within 30 seconds");
    const exec = (sql) => run(["exec", "--user", "postgres", "-i", name, "psql", "--no-psqlrc", "--no-password", "-h", "/var/run/postgresql", "-U", "catalog_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], sql);
    const isolated = await exec("select current_setting('server_version_num')::int between 170000 and 179999 and current_setting('listen_addresses') = '' and current_setting('unix_socket_permissions') = '0700';");
    if (isolated.trim() !== "t") throw new Error("Container PostgreSQL isolation/version verification failed");
    const version = (await exec("select version();")).trim();
    console.log(`Native catalog rehearsal: ${version}; official image ${digest}; network none, private socket, TCP disabled`);
    return { exec, close };
  } catch (error) {
    await close();
    throw new Error(`Isolated PostgreSQL 17 container rehearsal did not complete: ${error.message}. No external database or fallback is allowed.`);
  }
}
