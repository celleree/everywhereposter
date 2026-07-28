const canvasPath = require.resolve('canvas');

require.cache[canvasPath] = {
  id: canvasPath,
  filename: canvasPath,
  loaded: true,
  exports: null,
  children: [],
  paths: [],
};

module.exports = require('jest-environment-jsdom').TestEnvironment;
