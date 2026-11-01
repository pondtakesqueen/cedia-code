import { describe, expect, test } from 'bun:test';
import { classifyToolError } from '../src/core/trust/tool-errors.ts';

describe('classifyToolError', () => {
  test('none when not an error', () => {
    expect(classifyToolError({ text: 'ok', isError: false })).toBe('none');
  });

  test('none when denied', () => {
    expect(classifyToolError({ text: 'denied', isError: true }, 'denied')).toBe('none');
  });

  test('none when not_started', () => {
    expect(classifyToolError({ text: 'not run', isError: true }, 'not_started')).toBe('none');
  });

  test('timeout', () => {
    expect(classifyToolError({ text: 'command timed out after 30s', isError: true })).toBe('Timeout');
  });

  test('invalid arguments', () => {
    expect(classifyToolError({ text: 'Error: unknown flag --foo\nusage: cmd [options]', isError: true })).toBe('InvalidArguments');
  });

  test('unexpected environment', () => {
    expect(classifyToolError({ text: 'bash: rg: command not found', isError: true })).toBe('UnexpectedEnvironment');
  });

  test('provider error', () => {
    expect(classifyToolError({ text: 'connection refused: ECONNREFUSED', isError: true })).toBe('ProviderError');
  });

  test('user aborted', () => {
    expect(classifyToolError({ text: 'aborted by user', isError: true }, 'interrupted_safe')).toBe('UserAborted');
  });

  test('default to unexpected environment for unrecognized failure', () => {
    expect(classifyToolError({ text: 'something went wrong', isError: true })).toBe('UnexpectedEnvironment');
  });

  // A shell command that ran and exited nonzero reported its own result (a failing test, grep with no match, a type
  // error): that is the model's work, not a tool failure.
  test('a command that ran and exited nonzero is not a tool error', () => {
    expect(classifyToolError({ text: '(no output)\n[exit 1]', isError: true, exitCode: 1 })).toBe('none');
    expect(classifyToolError({ text: 'Expected: 3\nReceived: 2\n 1 fail\n[exit 1]', isError: true, exitCode: 1 })).toBe('none');
    expect(classifyToolError({ text: 'src/a.ts:512:3 - error TS2322\n[exit 2]', isError: true, exitCode: 2 })).toBe('none');
  });

  test('a shell command cut off at its timeout, stopped, or not found', () => {
    expect(classifyToolError({ text: 'x\n[exit 137, timed out after 120000 ms]', isError: true, exitCode: 137 })).toBe('Timeout');
    expect(classifyToolError({ text: 'x\n[exit 137, aborted]', isError: true, exitCode: 137 })).toBe('UserAborted');
    expect(classifyToolError({ text: 'bash: rg: command not found\n[exit 127]', isError: true, exitCode: 127 })).toBe('UnexpectedEnvironment');
  });

  test('a number that starts with 5 is not a provider error', () => {
    expect(classifyToolError({ text: 'file.ts line 512: bad edit', isError: true })).toBe('UnexpectedEnvironment');
    expect(classifyToolError({ text: 'HTTP 503 Service Unavailable', isError: true })).toBe('ProviderError');
  });
});
