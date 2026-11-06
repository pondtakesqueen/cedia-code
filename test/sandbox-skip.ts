// Whether this machine can run a sandboxed test: bwrap (Linux) or sandbox-exec (macOS). CI sets
// CEDIA_REQUIRE_SANDBOX=1 so a missing sandbox fails there instead of skipping. Use as test.skipIf(noSandbox).
export const noSandbox = !process.env.CEDIA_REQUIRE_SANDBOX && !Bun.which('bwrap') && process.platform !== 'darwin';
