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
    expect(classifyToolError({ text: 'command timed out after 30s', isError: true, exitCode: 124 })).toBe('Timeout');
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
});
