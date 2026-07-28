const Module = require('module');

const originalLoad = Module._load;
Module._load = function loadWithoutNativeCanvas(request, parent, isMain) {
  if (request === 'canvas') {
    return null;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const JsdomEnvironment = require('jest-environment-jsdom').TestEnvironment;
Module._load = originalLoad;

module.exports = JsdomEnvironment;
