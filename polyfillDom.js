/**
 * Polyfill DOM APIs required by modern PDF/worker libraries in Node.js environments (Vercel, AWS Lambda, Node < 22)
 */

if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    constructor(init) {
      this.a = 1; this.b = 0;
      this.c = 0; this.d = 1;
      this.e = 0; this.f = 0;
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.is2D = true;
      this.isIdentity = true;

      if (Array.isArray(init)) {
        if (init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
          this.m11 = this.a; this.m12 = this.b;
          this.m21 = this.c; this.m22 = this.d;
          this.m41 = this.e; this.m42 = this.f;
        } else if (init.length === 16) {
          this.m11 = init[0]; this.m12 = init[1]; this.m13 = init[2]; this.m14 = init[3];
          this.m21 = init[4]; this.m22 = init[5]; this.m23 = init[6]; this.m24 = init[7];
          this.m31 = init[8]; this.m32 = init[9]; this.m33 = init[10]; this.m34 = init[11];
          this.m41 = init[12]; this.m42 = init[13]; this.m43 = init[14]; this.m44 = init[15];
          this.a = this.m11; this.b = this.m12;
          this.c = this.m21; this.d = this.m22;
          this.e = this.m41; this.f = this.m42;
          this.is2D = false;
        }
      }
    }

    translateSelf(tx = 0, ty = 0, tz = 0) {
      this.e += this.a * tx + this.c * ty;
      this.f += this.b * tx + this.d * ty;
      this.m41 = this.e;
      this.m42 = this.f;
      return this;
    }

    scaleSelf(sx = 1, sy = sx, sz = 1) {
      this.a *= sx; this.b *= sx;
      this.c *= sy; this.d *= sy;
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      return this;
    }

    multiplySelf(other) {
      if (!other) return this;
      const a = this.a * (other.a ?? other.m11 ?? 1) + this.c * (other.b ?? other.m12 ?? 0);
      const b = this.b * (other.a ?? other.m11 ?? 1) + this.d * (other.b ?? other.m12 ?? 0);
      const c = this.a * (other.c ?? other.m21 ?? 0) + this.c * (other.d ?? other.m22 ?? 1);
      const d = this.b * (other.c ?? other.m21 ?? 0) + this.d * (other.d ?? other.m22 ?? 1);
      const e = this.a * (other.e ?? other.m41 ?? 0) + this.c * (other.f ?? other.m42 ?? 0) + this.e;
      const f = this.b * (other.e ?? other.m41 ?? 0) + this.d * (other.f ?? other.m42 ?? 0) + this.f;
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
      this.m11 = a; this.m12 = b; this.m21 = c; this.m22 = d; this.m41 = e; this.m42 = f;
      return this;
    }
  }

  globalThis.DOMMatrix = DOMMatrix;
  global.DOMMatrix = DOMMatrix;
}

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
  global.ImageData = globalThis.ImageData;
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    constructor() {}
  };
  global.Path2D = globalThis.Path2D;
}

module.exports = {
  DOMMatrix: globalThis.DOMMatrix,
  ImageData: globalThis.ImageData,
  Path2D: globalThis.Path2D
};
