// eslint-disable-next-line @typescript-eslint/no-var-requires
const CopyPlugin = require('copy-webpack-plugin');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

module.exports = function (options) {
  return {
    ...options,
    plugins: [
      ...options.plugins,
      new CopyPlugin({
        patterns: [
          { from: './config', to: path.join(__dirname, 'dist/config/') },

        ],
      }),
    ],
  };
};
