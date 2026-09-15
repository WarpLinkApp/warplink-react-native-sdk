/**
 * Holds a promise open until the test settles it.
 *
 * Lives outside `src/` deliberately: `src` ships in the npm package (see
 * `"files"` in `package.json`), and this helper has no reason to be part of
 * the published bridge. Shared by every test that needs to control exactly
 * when a native resolve answers.
 */
export function held<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  const handle = {} as {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  };
  handle.promise = new Promise<T>((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });
  return handle;
}
