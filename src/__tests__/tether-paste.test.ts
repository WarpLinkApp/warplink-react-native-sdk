const mockPlatform: { OS: string; Version: string | number } = { OS: 'ios', Version: '17.4' };
const mockNativeButton = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { WarpLinkModule: {} },
  NativeEventEmitter: jest.fn(),
  requireNativeComponent: jest.fn(() => mockNativeButton),
  Platform: {
    get OS() {
      return mockPlatform.OS;
    },
    get Version() {
      return mockPlatform.Version;
    },
    select: jest.fn(() => ''),
  },
}));

import { requireNativeComponent } from 'react-native';
import { ErrorCodes, WarpLinkError } from '../types';
import { handlePasteEvent } from '../tether/paste-event';
import { pasteControlSupported } from '../tether/paste-support';
import { WarpLinkPasteButton } from '../tether/WarpLinkPasteButton';
import { nativeMatch } from '../../test-utils/referral-native';

interface NativeProps {
  cornerStyle?: string;
  style: unknown[];
  onTether: (event: { nativeEvent: unknown }) => void;
}

function propsOf(element: ReturnType<typeof WarpLinkPasteButton>): NativeProps {
  return (element as unknown as { props: NativeProps }).props;
}

describe('Paste button events', () => {
  it('WL-S54 hands the host only the decoded outcome', () => {
    const onResult = jest.fn();

    handlePasteEvent({ result: { kind: 'matched', link: nativeMatch() } }, { onResult });

    expect(onResult).toHaveBeenCalledTimes(1);
    const result = onResult.mock.calls[0]?.[0];
    expect(result.kind).toBe('matched');
    expect(Object.keys(result).sort()).toEqual(['kind', 'link']);
  });

  it('WL-S60 an error event reaches onError and never onResult', () => {
    const onResult = jest.fn();
    const onError = jest.fn();

    handlePasteEvent(
      { error: { code: 'E_NETWORK_ERROR', message: 'offline' } },
      { onResult, onError }
    );

    expect(onResult).not.toHaveBeenCalled();
    const error = onError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(WarpLinkError);
    expect(error.code).toBe(ErrorCodes.E_NETWORK_ERROR);
  });

  it('WL-S60 an unreadable body is an unusable result, not a throw', () => {
    const onResult = jest.fn();

    expect(() => handlePasteEvent(undefined, { onResult })).not.toThrow();
    handlePasteEvent({ result: 'garbage' }, { onResult });

    expect(onResult).toHaveBeenNthCalledWith(1, { kind: 'unusable' });
    expect(onResult).toHaveBeenNthCalledWith(2, { kind: 'unusable' });
  });

  it('works with no handlers set', () => {
    expect(() => handlePasteEvent({ result: { kind: 'test' } }, {})).not.toThrow();
    expect(() => handlePasteEvent({ error: {} }, {})).not.toThrow();
  });
});

describe('Paste button support', () => {
  it('is supported only on iOS 16 and newer', () => {
    expect(pasteControlSupported('ios', '16.0')).toBe(true);
    expect(pasteControlSupported('ios', '17.4')).toBe(true);
    expect(pasteControlSupported('ios', '15.8')).toBe(false);
    expect(pasteControlSupported('ios', 'x')).toBe(false);
    expect(pasteControlSupported('android', 34)).toBe(false);
  });

  it('renders nothing on Android, where no clipboard is read', () => {
    mockPlatform.OS = 'android';
    mockPlatform.Version = 34;

    expect(WarpLinkPasteButton({})).toBeNull();
  });

  it('renders the native control on iOS 16 and newer', () => {
    mockPlatform.OS = 'ios';
    mockPlatform.Version = '17.4';

    const element = WarpLinkPasteButton({ cornerStyle: 'capsule' });

    expect(requireNativeComponent).toHaveBeenCalledWith('WarpLinkPasteButton');
    expect(element?.type).toBe(mockNativeButton);
    expect(propsOf(element).cornerStyle).toBe('capsule');
    expect(propsOf(element).style[0]).toEqual({ width: 160, height: 44 });
  });

  it('passes the native event body through the handler', () => {
    mockPlatform.OS = 'ios';
    mockPlatform.Version = '17.4';
    const onResult = jest.fn();

    const element = WarpLinkPasteButton({ onResult });
    propsOf(element).onTether({ nativeEvent: { result: { kind: 'noCode', reason: 'clipboard_empty' } } });

    expect(onResult).toHaveBeenCalledWith({ kind: 'noCode', reason: 'clipboard_empty' });
  });
});
