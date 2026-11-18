import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./coupon-expiry-reminders.ts", import.meta.url).pathname;

/**
 * Runs the public CLI. The database URL points at a closed loopback port, so no
 * database is reachable and no push can be sent whatever the arguments are.
 */
function cli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/none",
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("rejects any argument after the command before connecting, even with sending enabled", () => {
  for (const args of [["run", "--dry-run"], ["run", "extra"], ["report", "--bogus"]]) {
    const result = cli(args, { COUPON_EXPIRY_REMINDERS_SEND: "true" });
    assert.equal(result.status, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Usage: DATABASE_URL=... coupon-expiry-reminders <run|report>\n");
  }
});

test("a bare supported command still passes argument validation and goes on to connect", () => {
  const result = cli(["report"]);
  assert.notEqual(result.status, 2);
  assert.ok(!result.stderr.includes("Usage:"));
});
