module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: __dirname + '/warplink-react-native.podspec',
      },
      android: {
        sourceDir: __dirname + '/android',
        packageImportPath:
          'import app.warplink.reactnative.WarpLinkPackage;',
      },
    },
  },
};
