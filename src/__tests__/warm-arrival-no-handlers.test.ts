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

const URL_A = 'https://aplnk.to/no-handlers-a';

const flushPromises = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('a native event that arrives while no url handler is registered', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockResolvedValue(true);
    mockHandleDeepLink.mockResolvedValue(null);
  });

  it('is dropped before it is classified, stamped or resolved', async () => {
    dispatchNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockIsWarpLinkUrl).not.toHaveBeenCalled();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
  });

  it('resolves the same url once a handler is registered', async () => {
    dispatchNativeEvent({ url: URL_A });
    await flushPromises();

    const handler: UrlHandler = jest.fn();
    addUrlHandler(handler);
    dispatchNativeEvent({ url: URL_A });
    await flushPromises();
    removeUrlHandler(handler);

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(mockHandleDeepLink).toHaveBeenCalledWith(URL_A);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
