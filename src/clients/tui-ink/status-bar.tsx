import React from 'react';
import { Box, Text } from 'ink';
import { useCediaScreenReader } from './a11y.ts';
import type { ThemeTokens } from './theme-tokens.ts';

/** Money as the TUI shows it everywhere: cents from a dollar up, a tenth of a cent below. */
export const usd = (n: number): string => `$${n.toFixed(n >= 1 ? 2 : 3)}`;
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`);

/** Eight cells of context use: ▰ for each eighth used. */
export function meter(pct: number): { used: string; free: string } {
  const on = Math.max(pct > 0 ? 1 : 0, Math.min(8, Math.round((pct / 100) * 8)));
  return { used: '▰'.repeat(on), free: '▱'.repeat(8 - on) };
}

// The one line under the prompt. Left: the permission mode as a chip, the model and effort, or what the running
// turn is doing and how to stop it. Right: how full the context is, and the spend.
export function StatusBar(props: {
  T: ThemeTokens;
  mode: string;
  modeColor: string;
  model: string;
  effort?: string;
  images?: number;
  tokens?: number;
  windowSize?: number;
  // The context size a long session hands off at, when it does.
  handoffAt?: number;
  spend?: number;
  vimMode?: string;
  activity?: string;
  running?: boolean;
  elapsedMs?: number;
  spinner?: string;
  // About how many tokens the model has sent this turn.
  streamedTokens?: number;
  // A passing word that takes the left side, such as "Press Ctrl+C again to exit".
  hint?: string;
}): React.ReactElement {
  const { T, mode, modeColor, model, effort, images, tokens, windowSize, handoffAt, spend, vimMode, activity, running, elapsedMs, spinner, streamedTokens, hint } = props;
  const screenReader = useCediaScreenReader();
  const pct = tokens !== undefined && windowSize ? Math.min(99, Math.round((tokens / windowSize) * 100)) : undefined;
  const money = typeof spend === 'number' ? usd(spend) : '';
  const vim = vimMode && vimMode !== 'insert' ? vimMode : '';
  if (screenReader) {
    const parts = [
      hint ?? '',
      running && activity ? `${activity}, esc stops` : `mode ${mode}`,
      model,
      effort ? `effort ${effort}` : '',
      vim ? `vim ${vim}` : '',
      pct !== undefined ? `context ${pct}%` : '',
      money,
    ].filter(Boolean);
    return <Text>{parts.join(' · ')}</Text>;
  }
  const m = pct !== undefined ? meter(pct) : undefined;
  const meterColor = pct !== undefined && pct >= 95 ? T.error : pct !== undefined && pct >= 80 ? T.accent : T.primary;
  return (
    <Box justifyContent="space-between" paddingX={2}>
      {hint ? (
        <Text wrap="truncate" color={T.textMuted}>{hint}</Text>
      ) : running && activity ? (
        <Text wrap="truncate">
          {/* The mode stays in sight while a turn runs: it is what the turn's calls are held to. */}
          <Text backgroundColor={modeColor} color={T.background} bold>{` ${mode} `}</Text>
          <Text color={T.accent}> {spinner ?? '●'} </Text>
          <Text color={T.textMuted}>{activity}</Text>
          <Text color={T.textMuted}>{elapsedMs !== undefined && elapsedMs >= 1000 ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ''}{streamedTokens ? ` · ↓ ${fmt(streamedTokens)} tok` : ''} · </Text>
          <Text color={T.textFaint}>esc to stop</Text>
        </Text>
      ) : (
        <Text wrap="truncate">
          <Text backgroundColor={modeColor} color={T.background} bold>{` ${mode} `}</Text>
          <Text color={T.textMuted}> {model}</Text>
          {effort ? <Text color={T.accent}> ◐ {effort}</Text> : null}
          {vim ? <Text color={T.accent}> vim:{vim}</Text> : null}
          {images ? <Text color={T.textMuted}> · {images} image{images === 1 ? '' : 's'}</Text> : null}
        </Text>
      )}
      {/* The right side keeps its cells and a gap; the left gives way (truncates) on a narrow terminal. */}
      <Box flexShrink={0} marginLeft={2}>
      <Text wrap="truncate">
        {m ? (
          <>
            <Text color={meterColor}>{m.used}</Text>
            <Text color={T.textFaint}>{m.free}</Text>
            <Text color={T.textMuted}> {pct}%</Text>
          </>
        ) : null}
        {tokens ? <Text color={T.textMuted}>{m ? ' · ' : ''}{fmt(tokens)}</Text> : null}
        {/* Near the handoff point the bar says where it is: the session goes on in a new one there. */}
        {tokens && handoffAt && tokens >= handoffAt * 0.8 ? <Text color={T.accent}> · handoff at {fmt(handoffAt)}</Text> : null}
        {money ? <Text color={T.textMuted}>{m || tokens ? ' · ' : ''}{money}</Text> : null}
      </Text>
      </Box>
    </Box>
  );
}
