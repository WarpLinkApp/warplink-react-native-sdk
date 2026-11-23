import { createElement, type ComponentType, type ReactElement } from 'react';
import {
  Platform,
  requireNativeComponent,
  type ColorValue,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { WarpLinkError } from '../types';
import { handlePasteEvent } from './paste-event';
import { pasteControlSupported } from './paste-support';
import type { TetherReadResult } from './tether-types';

export type PasteButtonCornerStyle =
  | 'dynamic'
  | 'fixed'
  | 'small'
  | 'medium'
  | 'large'
  | 'capsule';

export type PasteButtonDisplayMode = 'iconAndLabel' | 'iconOnly' | 'labelOnly';

export interface WarpLinkPasteButtonProps {
  /** Called with the outcome after the person taps the button. */
  onResult?: (result: TetherReadResult) => void;
  /** Called when the read or the request failed. Never blocks onboarding. */
  onError?: (error: WarpLinkError) => void;
  /** Layout. The default size is 160 by 44 points. */
  style?: StyleProp<ViewStyle>;
  baseBackgroundColor?: ColorValue;
  baseForegroundColor?: ColorValue;
  cornerStyle?: PasteButtonCornerStyle;
  displayMode?: PasteButtonDisplayMode;
}

interface NativePasteButtonProps {
  style?: StyleProp<ViewStyle>;
  baseBackgroundColor?: ColorValue;
  baseForegroundColor?: ColorValue;
  cornerStyle?: PasteButtonCornerStyle;
  displayMode?: PasteButtonDisplayMode;
  onTether: (event: NativeSyntheticEvent<unknown>) => void;
}

const DEFAULT_STYLE: ViewStyle = { width: 160, height: 44 };

let nativeButton: ComponentType<NativePasteButtonProps> | null = null;

function NativeButton(): ComponentType<NativePasteButtonProps> {
  nativeButton ??=
    requireNativeComponent<NativePasteButtonProps>('WarpLinkPasteButton');
  return nativeButton;
}

/**
 * The system paste button that reads a Tether code. It is the only way the
 * default `'pasteButton'` mode reads the clipboard: the person taps it, so iOS
 * shows no paste alert. The native SDK redeems the code. This component only
 * reports the outcome.
 *
 * Renders nothing on Android, where no clipboard is read, and on iOS below 16.
 *
 * @example
 * ```tsx
 * <WarpLinkPasteButton onResult={(r) => r.kind === 'matched' && open(r.link)} />
 * ```
 */
export function WarpLinkPasteButton({
  onResult,
  onError,
  style,
  ...appearance
}: WarpLinkPasteButtonProps): ReactElement | null {
  if (!pasteControlSupported(Platform.OS, Platform.Version)) {
    return null;
  }
  return createElement(NativeButton(), {
    ...appearance,
    style: [DEFAULT_STYLE, style],
    onTether: (event: NativeSyntheticEvent<unknown>) =>
      handlePasteEvent(event.nativeEvent, { onResult, onError }),
  });
}
