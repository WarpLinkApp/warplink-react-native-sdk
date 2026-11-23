// Babel config for jest only. The build (bob) does not read this file.
const commonjs = '@babel/plugin-transform-modules-commonjs';

module.exports = {
  babelrc: false,
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
    '@babel/preset-typescript',
  ],
  overrides: [
    // A test file declares its mock constants above its imports, and its
    // jest.mock factories read them. Babel hoists imports above those
    // constants, so a test file loads its imports on first use instead.
    { test: /__tests__/, plugins: [[commonjs, { lazy: () => true }]] },
    { exclude: /__tests__/, plugins: [commonjs] },
  ],
};
