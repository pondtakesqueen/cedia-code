// `cedia -p`: one run of a thread (core/run/thread.ts), written to stdout as text, json or stream-json.
import { runThread, type ThreadArgs } from '../../core/run/thread.ts';
import type { HeadlessResult } from '../../core/types.ts';
import { encode, type CoreMessage } from '../../protocol/index.ts';

export type HeadlessArgs = ThreadArgs & { outputFormat: 'text' | 'json' | 'stream-json' };

export async function runHeadless({ outputFormat, ...args }: HeadlessArgs, out: (s: string) => void = (s) => process.stdout.write(s)): Promise<HeadlessResult> {
  const say = args.note ?? ((text: string) => void process.stderr.write(text));
  // stream-json writes every message as a line. json writes only the result; text writes the result's words and
  // says the run's summary after them. A suggested next prompt is a line in stream-json and a note otherwise.
  const emit = (m: CoreMessage) => {
    if (outputFormat === 'stream-json') out(encode(m));
    else if (m.type === 'prompt_suggestion') say(`cedia suggestion: ${m.suggestion}\n`);
    else if (m.type === 'result') out(outputFormat === 'json' ? encode(m) : m.result + (m.result.endsWith('\n') ? '' : '\n'));
  };
  return runThread({ ...args, live: outputFormat === 'stream-json', summary: outputFormat === 'text' }, emit);
}
