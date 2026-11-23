const mockIsWarpLinkUrl = jest.fn();
const mockHandleDeepLink = jest.fn();

jest.mock('../NativeWarpLink', () => ({
  __esModule: true,
  DEEP_LINK_EVENT: 'onWarpLinkDeepLink',
  default: {
    isWarpLinkUrl: mockIsWarpLinkUrl,
    handleDeepLink: mockHandleDeepLink,
  },
}));

import { dispatchNativeEvent } from '../automatic/warm-arrivals';
import {
  addUrlHandler,
  removeUrlHandler,
  type UrlHandler,
} from '../automatic/url-handlers';
import { settleEventLoop, waitFor } from '../../test-utils/wait-for';

const URL_A = 'https://aplnk.to/no-handlers-a';

describe('a native event that arrives while no url handler is registered', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockResolvedValue(true);
    mockHandleDeepLink.mockResolvedValue(null);
  });

  it('is dropped before it is classified, stamped or resolved', async () => {
    dispatchNativeEvent({ url: URL_A });
    // Absence check: a dropped event leaves nothing to wait on.
    await settleEventLoop();

    expect(mockIsWarpLinkUrl).not.toHaveBeenCalled();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
  });

  it('resolves the same url once a handler is registered', async () => {
    dispatchNativeEvent({ url: URL_A });
    // Absence check: the first event must be gone before a handler exists, and nothing announces a drop.
    await settleEventLoop();

    const handler: UrlHandler = jest.fn();
    addUrlHandler(handler);
    dispatchNativeEvent({ url: URL_A });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    removeUrlHandler(handler);

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(mockHandleDeepLink).toHaveBeenCalledWith(URL_A);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
