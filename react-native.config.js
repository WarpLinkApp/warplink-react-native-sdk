module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: __dirname + '/warplink-react-native.podspec',
      },
      android: {
        packageImportPath:
          'import app.warplink.reactnative.WarpLinkPackage;',
      },
    },
  },
};
