const canvasPath = require.resolve('canvas');

class CanvasStub {
  constructor(width = 300, height = 150) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return null;
  }

  toDataURL() {
    return 'data:image/png;base64,';
  }

  toBuffer() {
    return Buffer.alloc(0);
  }
}

class ImageStub {}
class ImageDataStub {}

require.cache[canvasPath] = {
  id: canvasPath,
  filename: canvasPath,
  loaded: true,
  exports: {
    createCanvas: (width, height) => new CanvasStub(width, height),
    Image: ImageStub,
    ImageData: ImageDataStub,
    loadImage: async () => new ImageStub(),
  },
  children: [],
  paths: [],
};

module.exports = require('jest-environment-jsdom').TestEnvironment;
