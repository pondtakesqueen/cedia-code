# Security

## Reporting a vulnerability

Please report a security problem privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for it.

Say what is affected, how to reproduce it, and what an attacker gains. You will get an answer within a week, and
the fix is listed under "Security:" in `CHANGELOG.md`.

## Scope

- The trust layer: permission modes, the OS sandbox (`src/core/safety/`), secrets handling, and anything that lets
  a tool reach outside the working directory or the allowed hosts.
- Anything that reads input from outside the process: `cedia daemon`, plugins and marketplaces, MCP servers, hooks.
- Provider credentials (`src/core/providers/`): a key that is logged, sent to the wrong host, or written to a session.

A prompt injection that only gets the model to say something is not a vulnerability by itself; one that gets a tool
to run, write or send something the permission mode should have stopped is.
