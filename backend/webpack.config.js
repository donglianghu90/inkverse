// eslint-disable-next-line @typescript-eslint/no-var-requires
const CopyPlugin = require('copy-webpack-plugin');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = function (options) {
  // 过滤掉 NestJS CLI 默认注入的 ForkTsCheckerWebpackPlugin
  const filteredPlugins = options.plugins.filter(
    (p) => !(p instanceof ForkTsCheckerWebpackPlugin),
  );

  return {
    ...options,
    plugins: [
      ...filteredPlugins,
      new CopyPlugin({
        patterns: [
          { from: './config', to: path.join(__dirname, 'dist/config/') },
        ],
      }),
      // 重新注入，限制内存为 4GB，避免复杂 zod schema 类型推断 OOM
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          memoryLimit: 4096,
        },
      }),
    ],
  };
};
